import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import '../domain/assistant_ports.dart';

/// IA en linea con los mismos proveedores y nombres de variable que
/// `infra/.env` del generador, para copiar y pegar la configuracion.
///
/// Las claves viven en el almacenamiento seguro del telefono o, si se compilo
/// con `ai.env`, dentro del APK. Nunca se envian al backend Spring: la app
/// habla directamente con el proveedor, igual que hace el servidor del generador.
class AiProvider {
  final String id, keyName, baseUrl, defaultModel;
  final bool text, speech, anthropic;
  const AiProvider(
    this.id,
    this.keyName,
    this.baseUrl,
    this.defaultModel, {
    this.text = true,
    this.speech = false,
    this.anthropic = false,
  });

  static const all = [
    AiProvider(
      'gemini',
      'GEMINI_API_KEY',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'gemini-3.6-flash',
    ),
    AiProvider(
      'openrouter',
      'OPENROUTER_API_KEY',
      'https://openrouter.ai/api/v1',
      'anthropic/claude-sonnet-4.5',
    ),
    AiProvider(
      'groq',
      'GROQ_API_KEY',
      'https://api.groq.com/openai/v1',
      'openai/gpt-oss-120b',
      speech: true,
    ),
    AiProvider(
      'anthropic',
      'ANTHROPIC_API_KEY',
      'https://api.anthropic.com/v1',
      'claude-sonnet-4-5',
      anthropic: true,
    ),
    AiProvider(
      'mistral',
      'MISTRAL_API_KEY',
      'https://api.mistral.ai/v1',
      'mistral-small-latest',
      speech: true,
    ),
    AiProvider(
      'zai',
      'ZAI_API_KEY',
      'https://api.z.ai/api/paas/v4',
      'glm-4.7-flash',
    ),
    AiProvider(
      'moonshot',
      'MOONSHOT_API_KEY',
      'https://api.moonshot.ai/v1',
      'kimi-k2.6',
    ),
    AiProvider(
      'sambanova',
      'SAMBANOVA_API_KEY',
      'https://api.sambanova.ai/v1',
      'Meta-Llama-3.3-70B-Instruct',
    ),
  ];
  static const speechModels = {
    'groq': 'whisper-large-v3-turbo',
    'mistral': 'voxtral-mini-latest',
  };
  static AiProvider? byId(String id) =>
      all.where((p) => p.id == id).firstOrNull;
  static List<AiProvider> get forText => all.where((p) => p.text).toList();
  static List<AiProvider> get forSpeech => all.where((p) => p.speech).toList();
  String get defaultSpeechModel => speechModels[id] ?? '';
}

/// Configuracion editable: proveedor y modelo de texto, de voz y las claves.
///
/// Los valores compilados con `--dart-define-from-file=ai.env` son el punto de
/// partida; lo que se guarda desde la app los sustituye.
class RemoteAiSettings {
  static const storageKey = 'remote-ai-settings';
  static const keys = [
    'AI_LLM_PROVIDER',
    'AI_LLM_MODEL',
    'AI_SPEECH_PROVIDER',
    'AI_SPEECH_MODEL',
    'GEMINI_API_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'ANTHROPIC_API_KEY',
    'MISTRAL_API_KEY',
    'ZAI_API_KEY',
    'MOONSHOT_API_KEY',
    'SAMBANOVA_API_KEY',
  ];

  /// `String.fromEnvironment` exige nombres literales: no se puede iterar `keys`.
  static const built = {
    'AI_LLM_PROVIDER': String.fromEnvironment('AI_LLM_PROVIDER'),
    'AI_LLM_MODEL': String.fromEnvironment('AI_LLM_MODEL'),
    'AI_SPEECH_PROVIDER': String.fromEnvironment('AI_SPEECH_PROVIDER'),
    'AI_SPEECH_MODEL': String.fromEnvironment('AI_SPEECH_MODEL'),
    'GEMINI_API_KEY': String.fromEnvironment('GEMINI_API_KEY'),
    'OPENROUTER_API_KEY': String.fromEnvironment('OPENROUTER_API_KEY'),
    'GROQ_API_KEY': String.fromEnvironment('GROQ_API_KEY'),
    'ANTHROPIC_API_KEY': String.fromEnvironment('ANTHROPIC_API_KEY'),
    'MISTRAL_API_KEY': String.fromEnvironment('MISTRAL_API_KEY'),
    'ZAI_API_KEY': String.fromEnvironment('ZAI_API_KEY'),
    'MOONSHOT_API_KEY': String.fromEnvironment('MOONSHOT_API_KEY'),
    'SAMBANOVA_API_KEY': String.fromEnvironment('SAMBANOVA_API_KEY'),
  };

  final Map<String, String> values;
  FlutterSecureStorage? storage;
  RemoteAiSettings([Map<String, String>? initial])
    : values = {
        for (final entry in (initial ?? const <String, String>{}).entries)
          if (keys.contains(entry.key) && entry.value.trim().isNotEmpty)
            entry.key: entry.value.trim(),
      };
  factory RemoteAiSettings.fromBuild() => RemoteAiSettings(built);

  String operator [](String key) => values[key] ?? '';
  void set(String key, String value) {
    if (!keys.contains(key))
      throw FormatException('Variable desconocida: $key');
    final clean = value.trim();
    if (clean.isEmpty) {
      values.remove(key);
    } else {
      values[key] = clean;
    }
  }

  String get textProvider => this['AI_LLM_PROVIDER'];
  String get textModel => this['AI_LLM_MODEL'];
  String get speechProvider => this['AI_SPEECH_PROVIDER'];
  String get speechModel => this['AI_SPEECH_MODEL'];
  AiProvider? get textSpec => AiProvider.byId(textProvider);
  AiProvider? get speechSpec => AiProvider.byId(speechProvider);
  String keyFor(AiProvider provider) => this[provider.keyName];
  bool get textReady {
    final p = textSpec;
    return p != null && p.text && textModel.isNotEmpty && keyFor(p).isNotEmpty;
  }

  bool get speechReady {
    final p = speechSpec;
    return p != null &&
        p.speech &&
        speechModel.isNotEmpty &&
        keyFor(p).isNotEmpty;
  }

  String get textLabel =>
      textReady ? '$textProvider · $textModel' : 'sin configurar';
  String get speechLabel =>
      speechReady ? '$speechProvider · $speechModel' : 'sin configurar';

  /// Lo guardado en el telefono manda sobre lo compilado.
  Future<void> load(FlutterSecureStorage storage) async {
    this.storage = storage;
    final raw = await storage.read(key: storageKey);
    if (raw == null) return;
    final j = jsonDecode(raw);
    if (j is! Map) return;
    for (final entry in j.entries) {
      if (entry.key is String && entry.value is String)
        set(entry.key, entry.value);
    }
  }

  Future<void> save() async {
    final target = storage;
    if (target == null) throw StateError('Sin almacenamiento seguro');
    await target.write(key: storageKey, value: jsonEncode(values));
  }
}

/// JSON es UTF-8 aunque el proveedor no declare charset; `response.body` lo
/// leeria como latin1 y estropearia las tildes.
String _texto(http.Response response) =>
    utf8.decode(response.bodyBytes, allowMalformed: true);

String _detail(String body) {
  try {
    final j = jsonDecode(body);
    final error = j is Map ? j['error'] : null;
    final message = error is Map ? error['message'] : error;
    if (message is String && message.isNotEmpty) return message;
  } catch (_) {}
  return body.length > 200 ? '${body.substring(0, 200)}…' : body;
}

Never _reject(AiProvider p, http.Response response) {
  final code = response.statusCode;
  if (code == 401 || code == 403)
    throw StateError('${p.id}: clave rechazada ($code). Revisa ${p.keyName}.');
  if (code == 402 || code == 429)
    throw StateError('${p.id}: sin cuota o limite alcanzado ($code).');
  throw StateError('${p.id}: error $code. ${_detail(_texto(response))}');
}

/// Motor de texto en linea. Misma interfaz que los motores locales: el agente
/// no distingue de donde sale la propuesta y la valida igual.
class RemoteTextEngine implements LocalTextEngine {
  final RemoteAiSettings settings;
  final http.Client client;
  final Duration timeout;
  RemoteTextEngine(
    this.settings, {
    http.Client? client,
    this.timeout = const Duration(seconds: 90),
  }) : client = client ?? http.Client();

  static Future<RemoteTextEngine> open(RemoteAiSettings settings) async {
    if (!settings.textReady)
      throw StateError(
        'Configura la IA en linea: proveedor, modelo y clave de texto.',
      );
    return RemoteTextEngine(settings);
  }

  @override
  Stream<String> generate(String system, String context) async* {
    yield await complete(system, context);
  }

  Future<String> complete(String system, String context) async {
    final p = settings.textSpec;
    if (p == null || !settings.textReady)
      throw StateError('Configura la IA en linea antes de usarla.');
    final key = settings.keyFor(p);
    final http.Response response;
    if (p.anthropic) {
      response = await client
          .post(
            Uri.parse('${p.baseUrl}/messages'),
            headers: {
              'content-type': 'application/json',
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
            },
            body: jsonEncode({
              'model': settings.textModel,
              'max_tokens': 2048,
              'temperature': 0,
              'system': system,
              'messages': [
                {'role': 'user', 'content': context},
              ],
            }),
          )
          .timeout(timeout);
    } else {
      response = await client
          .post(
            Uri.parse('${p.baseUrl}/chat/completions'),
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer $key',
              if (p.id == 'openrouter')
                'HTTP-Referer': 'https://github.com/plataforma-uml',
              if (p.id == 'openrouter') 'X-Title': 'Plataforma UML',
            },
            body: jsonEncode({
              'model': settings.textModel,
              if (p.id != 'moonshot') 'temperature': 0,
              'max_tokens': 2048,
              'messages': [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': context},
              ],
              'response_format': {'type': 'json_object'},
            }),
          )
          .timeout(timeout);
    }
    if (response.statusCode >= 400) _reject(p, response);
    final body = jsonDecode(_texto(response));
    if (body is Map && body['error'] != null) {
      throw StateError('${p.id}: ${_detail(_texto(response))}');
    }
    final dynamic text = p.anthropic
        ? ((body['content'] as List?) ?? const [])
              .map((c) => c is Map ? (c['text'] ?? '') : '')
              .join()
        : (body['choices'] as List?)?.firstOrNull?['message']?['content'];
    if (text is! String || text.trim().isEmpty)
      throw const FormatException('El proveedor no devolvio texto');
    return text;
  }

  @override
  Future<void> stop() async => client.close();
  @override
  Future<void> close() async => client.close();
}

/// Transcripcion en linea por el endpoint compatible con OpenAI
/// (`/audio/transcriptions`), como hace el servidor del generador con Groq.
Future<String> transcribeRemoteAudio(
  String audioPath,
  String language,
  String vocabulary,
  RemoteAiSettings settings, {
  http.Client? client,
  Duration timeout = const Duration(seconds: 90),
}) async {
  final p = settings.speechSpec;
  if (p == null || !settings.speechReady)
    throw StateError(
      'Configura la voz en linea: proveedor (groq o mistral), modelo y clave.',
    );
  final request =
      http.MultipartRequest(
          'POST',
          Uri.parse('${p.baseUrl}/audio/transcriptions'),
        )
        ..headers['authorization'] = 'Bearer ${settings.keyFor(p)}'
        ..fields['model'] = settings.speechModel
        ..fields['response_format'] = 'json'
        ..files.add(
          await http.MultipartFile.fromPath(
            'file',
            audioPath,
            filename: 'dictado.wav',
          ),
        );
  if (language != 'auto') request.fields['language'] = language;
  if (p.id == 'groq') {
    request.fields['temperature'] = '0';
    if (vocabulary.isNotEmpty) request.fields['prompt'] = vocabulary;
  }
  final own = client ?? http.Client();
  try {
    final response = await http.Response.fromStream(
      await own.send(request).timeout(timeout),
    ).timeout(timeout);
    if (response.statusCode >= 400) _reject(p, response);
    final body = jsonDecode(_texto(response));
    final text = body is Map ? body['text'] : null;
    if (text is! String)
      throw const FormatException('El proveedor no devolvio texto');
    return text;
  } finally {
    if (client == null) own.close();
  }
}
