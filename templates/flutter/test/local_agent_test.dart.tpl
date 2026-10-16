import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import '../lib/data/local_agent.dart';
import '../lib/data/model_library.dart';
import '../lib/domain/schema.dart';
import '../lib/domain/assistant_prompt.dart';
import '../lib/data/isolated_text_engine.dart';
import '../lib/domain/proposal.dart';

Future<LocalTextEngine> blockingWorker(List<String> args) async {
  // Deliberately synchronous: simulates native initialization on Android.
  sleep(const Duration(milliseconds: 250));
  return FakeEngine(args.single);
}

class FakeEngine implements LocalTextEngine {
  String output;
  String? system, context;
  bool closed = false;
  FakeEngine(this.output);
  @override
  Stream<String> generate(String s, String c) async* {
    system = s;
    context = c;
    yield output;
  }

  @override
  Future<void> stop() async {}
  @override
  Future<void> close() async {
    closed = true;
  }
}

void main() {
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
  final library = ModelLibrary(Directory('unused-test-models'));
  library.models.add(
    const LocalModelFile(
      '11111111-1111-4111-8111-111111111111',
      'test',
      ModelRuntime.litertlm,
      100,
    ),
  );
  library.textId = library.models.first.id;
  final resource = schema.resources.first;

  test(
    'aplica prompt comun y valida CREATE sin ejecutar llamadas ni persistir datos',
    () async {
      final engine = FakeEngine(
        '{"action":"CREATE","resource":"clientes","data":{"nombre":"Ana"}}',
      );
      final agent = LocalAgent(library, factory: (_, _) async => engine);
      final proposal = await agent.propose('Crea a Ana', schema, resource, []);
      expect(proposal.data!['nombre'], 'Ana');
      expect(proposal.data!['id'], isNotEmpty);
      expect(engine.system, managementSystemPrompt);
      expect(jsonDecode(engine.context!)['instruction'], 'Crea a Ana');
      expect(engine.closed, isTrue);
    },
  );
  test(
    'rechaza campo inventado y libera el motor aunque falle la validacion',
    () async {
      final engine = FakeEngine(
        '{"action":"CREATE","resource":"clientes","data":{"nombre":"Ana","admin":true}}',
      );
      final agent = LocalAgent(library, factory: (_, _) async => engine);
      await expectLater(
        agent.propose('Crea Ana', schema, resource, []),
        throwsFormatException,
      );
      expect(engine.closed, isTrue);
    },
  );
  test(
    'rechaza DELETE de clave ausente y pregunta sin generar cambios',
    () async {
      for (final output in [
        '{"action":"DELETE","resource":"clientes","id":"inventado"}',
        '{"question":"¿Cual cliente?"}',
      ]) {
        final engine = FakeEngine(output);
        final agent = LocalAgent(library, factory: (_, _) async => engine);
        await expectLater(
          agent.propose('Borra Ana', schema, resource, []),
          throwsFormatException,
        );
        expect(engine.closed, isTrue);
      }
    },
  );
  test('cancelar durante carga descarta resultado y libera el motor', () async {
    final load = Completer<LocalTextEngine>();
    final engine = FakeEngine('{"action":"LIST","resource":"clientes"}');
    final agent = LocalAgent(library, factory: (_, _) => load.future);
    final pending = agent.propose('lista', schema, resource, []);
    final check = expectLater(pending, throwsStateError);
    await agent.stop();
    load.complete(engine);
    await check;
    await agent.close();
    expect(engine.closed, isTrue);
  });
  test(
    'carga nativa aislada no bloquea temporizadores de la interfaz',
    () async {
      var loaded = false;
      final opening = IsolatedTextEngine.open(blockingWorker, ['ok']).then((
        engine,
      ) {
        loaded = true;
        return engine;
      });
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(loaded, isFalse);
      final engine = await opening;
      expect(await engine.generate('system', 'context').join(), 'ok');
      await engine.stop();
      await engine.close();
    },
  );
  test('limite incluye carga y libera un motor que llega tarde', () async {
    final load = Completer<LocalTextEngine>();
    final engine = FakeEngine('{"action":"LIST","resource":"clientes"}');
    final agent = LocalAgent(
      library,
      factory: (_, _) => load.future,
      requestTimeout: const Duration(milliseconds: 20),
    );
    await expectLater(
      agent.propose('lista', schema, resource, []),
      throwsA(
        isA<StateError>().having(
          (e) => e.message,
          'mensaje',
          contains('Tiempo agotado'),
        ),
      ),
    );
    expect(agent.processing, isTrue);
    await expectLater(
      agent.propose('lista', schema, resource, []),
      throwsStateError,
    );
    load.complete(engine);
    await agent.close();
    expect(engine.closed, isTrue);
    expect(agent.processing, isFalse);
  });
  test('alta con PK numerica deja nombre y telefono opcionales en null', () {
    final optional = AppSchema({
      'resources': [
        {
          'className': 'Cliente',
          'path': '/api/clientes',
          'primaryKey': 'id',
          'fields': [
            {
              'name': 'id',
              'javaType': 'Integer',
              'nullable': false,
              'primaryKey': true,
            },
            {'name': 'nombre', 'javaType': 'String', 'nullable': true},
            {'name': 'telefono', 'javaType': 'String', 'nullable': true},
          ],
        },
      ],
    });
    final proposal = Proposal.parse(
      '{"action":"CREATE","resource":"clientes","data":{"id":1}}',
      optional,
    );
    expect(proposal.data, {'id': 1, 'nombre': null, 'telefono': null});
    expect(
      () => Proposal.parse(
        '{"action":"CREATE","resource":"clientes","data":{}}',
        optional,
      ),
      throwsFormatException,
    );
  });
  test(
    'vocabulario de voz acotado sin registros ni instrucciones del usuario',
    () {
      expect(transcriptionVocabulary(resource), 'Cliente, id, nombre');
      expect(
        () => managementContext('a' * 2001, resource, []),
        throwsFormatException,
      );
    },
  );
  test('UPDATE parcial conserva la clave y los campos no mencionados', () async {
    const id = '22222222-2222-4222-8222-222222222222';
    final engine = FakeEngine(
      '{"action":"UPDATE","resource":"clientes","id":"$id","data":{"nombre":"Nueva"}}',
    );
    final agent = LocalAgent(library, factory: (_, _) async => engine);
    final original = <String, dynamic>{'id': id, 'nombre': 'Ana'};
    final result = await agent.propose(
      'Cambia el nombre a Nueva',
      schema,
      resource,
      [original],
    );
    expect(result.data, {'id': id, 'nombre': 'Nueva'});
    expect(original['nombre'], 'Ana');
    expect(engine.closed, isTrue);
  });
  test(
    'UPDATE no completa una clave inexistente ni permite cambiar la PK',
    () async {
      const id = '22222222-2222-4222-8222-222222222222';
      const other = '33333333-3333-4333-8333-333333333333';
      for (final output in [
        '{"action":"UPDATE","resource":"clientes","id":"$other","data":{"nombre":"Nueva"}}',
        '{"action":"UPDATE","resource":"clientes","id":"$id","data":{"id":"$other","nombre":"Nueva"}}',
      ]) {
        final agent = LocalAgent(
          library,
          factory: (_, _) async => FakeEngine(output),
        );
        await expectLater(
          agent.propose('Cambia nombre', schema, resource, [
            {'id': id, 'nombre': 'Ana'},
          ]),
          throwsFormatException,
        );
      }
    },
  );
  test('UPDATE parcial distingue omitir un campo de vaciarlo explicitamente', () {
    final s = AppSchema({
      'resources': [
        {
          'className': 'Cliente',
          'path': '/api/clientes',
          'primaryKey': 'id',
          'fields': [
            {
              'name': 'id',
              'javaType': 'Integer',
              'nullable': false,
              'primaryKey': true,
            },
            {'name': 'nombre', 'javaType': 'String', 'nullable': true},
            {'name': 'telefono', 'javaType': 'String', 'nullable': true},
          ],
        },
      ],
    });
    final rows = [
      {'id': 1, 'nombre': 'Ana', 'telefono': '70000000'},
    ];
    final p = Proposal.parse(
      '{"action":"UPDATE","resource":"clientes","id":1,"data":{"telefono":null}}',
      s,
      records: rows,
    );
    expect(p.data, {'id': 1, 'nombre': 'Ana', 'telefono': null});
    expect(rows.single['telefono'], '70000000');
  });
}
