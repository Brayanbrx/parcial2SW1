import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import '../lib/data/local_agent.dart';
import '../lib/data/model_library.dart';
import '../lib/data/remote_ai.dart';
import '../lib/domain/schema.dart';

void main() {
  test('la configuracion usa los nombres de infra/.env y exige clave', () {
    final settings = RemoteAiSettings({
      'AI_LLM_PROVIDER': 'gemini',
      'AI_LLM_MODEL': 'gemini-3.6-flash',
      'AI_SPEECH_PROVIDER': 'groq',
      'AI_SPEECH_MODEL': 'whisper-large-v3-turbo',
      'IGNORADA': 'x',
    });
    expect(settings.textReady, isFalse);
    expect(settings.speechReady, isFalse);
    expect(settings.values.containsKey('IGNORADA'), isFalse);
    settings.set('GEMINI_API_KEY', ' clave ');
    settings.set('GROQ_API_KEY', 'gsk');
    expect(settings.textReady, isTrue);
    expect(settings.speechReady, isTrue);
    expect(settings.textLabel, 'gemini · gemini-3.6-flash');
    // Gemini no transcribe; un proveedor de texto no vale para voz.
    settings.set('AI_SPEECH_PROVIDER', 'gemini');
    expect(settings.speechReady, isFalse);
    expect(() => settings.set('OTRA', 'x'), throwsFormatException);
  });

  test('el motor en linea pide JSON al endpoint compatible y devuelve el texto', () async {
    http.Request? seen;
    final client = MockClient((request) async {
      seen = request;
      return http.Response(
        jsonEncode({
          'choices': [
            {
              'message': {
                'content':
                    '{"action":"CREATE","resource":"clientes","data":{"nombre":"Ana"}}',
              },
            },
          ],
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final settings = RemoteAiSettings({
      'AI_LLM_PROVIDER': 'groq',
      'AI_LLM_MODEL': 'openai/gpt-oss-120b',
      'GROQ_API_KEY': 'gsk_test',
    });
    final engine = RemoteTextEngine(settings, client: client);
    final out = await engine.generate('SISTEMA', '{"instruction":"crea"}').join();
    expect(out, contains('"action":"CREATE"'));
    expect(seen!.url.toString(), 'https://api.groq.com/openai/v1/chat/completions');
    expect(seen!.headers['authorization'], 'Bearer gsk_test');
    final body = jsonDecode(seen!.body) as Map;
    expect(body['model'], 'openai/gpt-oss-120b');
    expect(body['response_format'], {'type': 'json_object'});
    expect(body['messages'][0], {'role': 'system', 'content': 'SISTEMA'});
    await engine.close();
  });

  test('Anthropic usa su propio protocolo y una clave rechazada se explica', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      expect(request.url.toString(), 'https://api.anthropic.com/v1/messages');
      expect(request.headers['x-api-key'], 'sk-ant');
      expect(request.headers['anthropic-version'], isNotEmpty);
      final body = jsonDecode(request.body) as Map;
      expect(body['system'], 'S');
      return calls == 1
          ? http.Response(
              jsonEncode({
                'content': [
                  {'type': 'text', 'text': '{"question":"¿Cual?"}'},
                ],
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            )
          : http.Response('{"error":{"message":"invalid x-api-key"}}', 401);
    });
    final settings = RemoteAiSettings({
      'AI_LLM_PROVIDER': 'anthropic',
      'AI_LLM_MODEL': 'claude-sonnet-4-5',
      'ANTHROPIC_API_KEY': 'sk-ant',
    });
    final engine = RemoteTextEngine(settings, client: client);
    expect(await engine.complete('S', 'C'), '{"question":"¿Cual?"}');
    await expectLater(
      engine.complete('S', 'C'),
      throwsA(
        isA<StateError>().having(
          (e) => e.message,
          'message',
          contains('ANTHROPIC_API_KEY'),
        ),
      ),
    );
  });

  test('el agente usa el motor en linea cuando el modo de texto es remoto', () async {
    final schema = AppSchema({
      'project': 'test',
      'resources': [
        {
          'className': 'Cliente',
          'path': '/api/clientes',
          'primaryKey': 'id',
          'fields': [
            {
              'name': 'id',
              'javaType': 'UUID',
              'primaryKey': true,
              'nullable': false,
            },
            {'name': 'nombre', 'javaType': 'String', 'nullable': false},
          ],
        },
      ],
    });
    final library = ModelLibrary(Directory('unused-remote-models'));
    expect(library.textReady, isFalse);
    library.textMode = 'remote';
    expect(library.textReady, isFalse);
    library.remote
      ..set('AI_LLM_PROVIDER', 'openrouter')
      ..set('AI_LLM_MODEL', 'anthropic/claude-sonnet-4.5')
      ..set('OPENROUTER_API_KEY', 'or-key');
    expect(library.textReady, isTrue);
    LocalModelFile? received = const LocalModelFile(
      '11111111-1111-4111-8111-111111111111',
      'x',
      ModelRuntime.gguf,
      1,
    );
    final client = MockClient(
      (request) async => http.Response(
        jsonEncode({
          'choices': [
            {
              'message': {
                'content':
                    '```json\n{"action":"CREATE","resource":"clientes","data":{"nombre":"Ana"}}\n```',
              },
            },
          ],
        }),
        200,
      ),
    );
    final agent = LocalAgent(
      library,
      factory: (lib, model) async {
        received = model;
        return RemoteTextEngine(lib.remote, client: client);
      },
    );
    final proposal = await agent.propose(
      'Crea a Ana',
      schema,
      schema.resources.first,
      [],
    );
    // El modo remoto no pasa ningun archivo local al motor.
    expect(received, isNull);
    // Un bloque de codigo alrededor del JSON no invalida la propuesta.
    expect(proposal.data!['nombre'], 'Ana');
  });

  test('la transcripcion en linea envia el audio como multipart', () async {
    final directory = await Directory.systemTemp.createTemp('remote-speech-');
    addTearDown(() => directory.delete(recursive: true));
    final audio = await File(
      '${directory.path}/d.wav',
    ).writeAsBytes(List.filled(4000, 0));
    http.Request? seen;
    final client = MockClient((request) async {
      seen = request;
      return http.Response(jsonEncode({'text': ' Crea Ana '}), 200);
    });
    final settings = RemoteAiSettings({
      'AI_SPEECH_PROVIDER': 'groq',
      'AI_SPEECH_MODEL': 'whisper-large-v3-turbo',
      'GROQ_API_KEY': 'gsk',
    });
    final text = await transcribeRemoteAudio(
      audio.path,
      'es',
      'Cliente, id',
      settings,
      client: client,
    );
    expect(text.trim(), 'Crea Ana');
    expect(
      seen!.url.toString(),
      'https://api.groq.com/openai/v1/audio/transcriptions',
    );
    expect(seen!.headers['content-type'], startsWith('multipart/form-data'));
    final body = seen!.body;
    expect(body, contains('name="model"'));
    expect(body, contains('whisper-large-v3-turbo'));
    expect(body, contains('name="language"'));
    expect(body, contains('filename="dictado.wav"'));
  });
}
