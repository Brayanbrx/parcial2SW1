import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import '../lib/data/assistant_tools.dart';
import '../lib/data/repository.dart';
import '../lib/domain/assistant_runner.dart';
import '../lib/domain/assistant_session.dart';
import '../lib/domain/schema.dart';
import 'support/assistant_test_support.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Repository repository;
  late AssistantSession session;
  setUp(() async {
    repository = await assistantRepository();
    session = AssistantSession();
  });
  tearDown(() async {
    await repository.local.close();
  });

  AssistantRunner runner(
    ScriptedEngine engine, {
    int maxSteps = 8,
    void Function()? check,
  }) => AssistantRunner(
    complete: (system, context) => engine.generate(system, context).join(),
    tools: LocalAssistantTools(repository, check ?? () {}),
    session: session,
    checkActive: check ?? () {},
    progress: (_) {},
    maxSteps: maxSteps,
  );
  test(
    'search then clarification then short reply then read and draft',
    () async {
      final first = ScriptedEngine([
        toolReply('search_records', {
          'resource': 'clientes',
          'filters': [
            {'field': 'nombre', 'op': 'contains', 'value': 'Ana'},
          ],
        }),
        answerReply('¿Ana Perez o Ana Lopez?', 'question'),
      ]);
      final question = await runner(
        first,
      ).run('Cambia el telefono de Ana a 77712345', 'clientes', 'run1');
      expect(question.kind, 'question');
      expect(question.steps, 2);
      final second = ScriptedEngine([
        toolReply('get_record', {'resource': 'clientes', 'id': 1}),
        toolReply('prepare_change', {
          'resource': 'clientes',
          'action': 'UPDATE',
          'id': 1,
          'data': {'telefono': '77712345'},
        }),
      ]);
      final draft = await runner(second).run('Perez', 'clientes', 'run2');
      expect(draft.kind, 'draft');
      expect(second.contexts.first['pendingInstruction'], contains('77712345'));
      expect(second.contexts.first['pendingQuestion'], contains('Lopez'));
      expect(
        second.contexts.first['previousEvidence']['data']['records'],
        hasLength(2),
      );
      expect(session.pendingDraft!['proposal']['id'], 1);
      expect(await repository.local.queue(), isEmpty);
    },
  );
  test(
    'invalid output is corrected with concrete feedback and bounded repairs',
    () async {
      final engine = ScriptedEngine([
        'no json',
        answerReply('¿Que nombre?', 'question'),
      ]);
      expect(
        (await runner(engine).run('crear', 'clientes', 'repair')).kind,
        'question',
      );
      expect(
        jsonEncode(engine.contexts.last['transcript']),
        contains('invalid_response'),
      );
      final broken = ScriptedEngine(['x', 'x', 'x', 'unused']);
      expect(
        (await runner(broken).run('crear', 'clientes', 'broken')).kind,
        'error',
      );
      expect(broken.contexts, hasLength(3));
    },
  );
  test('repeated equivalent call stops and no write is possible', () async {
    final engine = ScriptedEngine([
      toolReply('get_record', {'resource': 'clientes', 'id': 1}),
      toolReply('get_record', {'id': 1, 'resource': 'clientes'}),
    ]);
    expect(
      (await runner(engine).run('consulta', 'clientes', 'repeat')).kind,
      'limit',
    );
    expect(session.evidence, hasLength(1));
    expect(await repository.local.queue(), isEmpty);
  });
  test('ungrounded answer is repaired using real tool evidence', () async {
    final engine = ScriptedEngine([
      answerReply('No hay informacion sobre cuantos clientes hay.'),
      toolReply('aggregate_records', {
        'resource': 'clientes',
        'operation': 'count',
      }),
      answerReply('Hay 3 clientes.'),
    ]);
    final result = await runner(
      engine,
    ).run('Cuantos clientes hay?', 'clientes', 'grounded');
    expect(result.kind, 'answer');
    expect(result.text, 'Hay 3 clientes.');
    expect(result.steps, 3);
    expect(
      jsonEncode(engine.contexts[1]['transcript']),
      contains('Antes de responder'),
    );
    expect(
      session.messages.any(
        (message) => message['text'].toString().contains('No hay informacion'),
      ),
      isFalse,
    );
    expect(await repository.local.queue(), isEmpty);
  });
  test('budget ends even if every request differs', () async {
    final engine = ScriptedEngine([
      for (var id = 1; id <= 3; id++)
        toolReply('get_record', {'resource': 'clientes', 'id': id}),
    ]);
    final result = await runner(
      engine,
      maxSteps: 2,
    ).run('consulta', 'clientes', 'limit');
    expect(result.kind, 'limit');
    expect(result.steps, 2);
    expect(engine.responses, hasLength(1));
  });
  test(
    'a pure negation terminates without querying or preparing a change',
    () async {
      final engine = ScriptedEngine(['{"version":1,"kind":"no_change"}']);
      final result = await runner(
        engine,
      ).run('No borres a Ana', 'clientes', 'negation');
      expect(result.kind, 'answer');
      expect(
        result.text,
        'De acuerdo. No he preparado ni guardado ningun cambio.',
      );
      expect(result.steps, 1);
      expect(session.evidence, isEmpty);
      expect(session.pendingInstruction, isNull);
      expect(await repository.local.queue(), isEmpty);
    },
  );
  test(
    'immutable key error is shown faithfully without another model interpretation',
    () async {
      final engine = ScriptedEngine([
        toolReply('get_record', {'resource': 'clientes', 'id': 1}),
        toolReply('prepare_change', {
          'resource': 'clientes',
          'action': 'UPDATE',
          'id': 1,
          'data': {'id': 9},
        }),
        answerReply('No existe Ana Perez'),
      ]);
      final result = await runner(
        engine,
      ).run('Cambia id de Ana Perez a 9', 'clientes', 'key');
      expect(result.text, contains('No se puede cambiar la clave primaria id'));
      expect(result.text, contains('El registro existe'));
      expect(result.steps, 2);
      expect(engine.responses, hasLength(1));
      expect(session.pendingDraft, isNull);
      expect(await repository.local.queue(), isEmpty);
    },
  );
  test(
    'session invalidation prevents late model output and tool calls',
    () async {
      final epoch = session.generation;
      var called = 0;
      final task = AssistantRunner(
        complete: (_, _) async {
          session.clear();
          return toolReply('prepare_change', {
            'resource': 'clientes',
            'action': 'CREATE',
            'data': {'id': 8, 'nombre': 'Invalido'},
          });
        },
        tools: LocalAssistantTools(repository, () {
          called++;
        }),
        session: session,
        checkActive: () {
          if (epoch != session.generation) throw StateError('sesion');
        },
        progress: (_) {},
      );
      await expectLater(
        task.run('crea', 'clientes', 'cancel'),
        throwsStateError,
      );
      expect(called, 0);
      expect(session.messages, isEmpty);
      expect(session.pendingDraft, isNull);
    },
  );
  test(
    'a proposal identical to the stored record never becomes a confirmable draft',
    () async {
      final engine = ScriptedEngine([
        toolReply('get_record', {'resource': 'clientes', 'id': 3}),
        toolReply('prepare_change', {
          'resource': 'clientes',
          'action': 'UPDATE',
          'id': 3,
          'data': {'id': 3, 'nombre': 'Luis'},
        }),
      ]);
      final result = await runner(
        engine,
      ).run('Actualiza identificador de Luis', 'clientes', 'noop');
      expect(result.kind, 'answer');
      expect(result.text, contains('no modifica ningun campo'));
      expect(session.pendingDraft, isNull);
      expect(await repository.local.queue(), isEmpty);
    },
  );
  test(
    'continuation restores the original request and only matching committed receipts',
    () async {
      session.pendingInstruction = 'Crea dos clientes: 4 Maria y 5 Pedro';
      session.recordCommitted({
        'draftId': 'saved-4',
        'proposal': {
          'action': 'CREATE',
          'resource': 'clientes',
          'data': {'id': 4, 'nombre': 'Maria'},
        },
      });
      session.pendingInstruction = null;
      for (var i = 0; i < 30; i++) {
        session.add('assistant', 'mensaje $i');
      }
      final engine = ScriptedEngine([
        toolReply('prepare_change', {
          'action': 'CREATE',
          'resource': 'clientes',
          'data': {'id': 5, 'nombre': 'Pedro'},
        }),
      ]);
      final result = await runner(
        engine,
      ).run('Continúa con el otro cliente pendiente', 'clientes', 'continue');
      expect(result.kind, 'draft');
      expect(engine.contexts.first['pendingInstruction'], contains('5 Pedro'));
      expect(
        engine.contexts.first['continuation']['completed'].single['draftId'],
        'saved-4',
      );
      expect(await repository.local.queue(), isEmpty);
      session.pendingInstruction = null;
      session.beginInstruction('No continues');
      expect(session.continuationRequest, isNull);
      expect(session.pendingInstruction, 'No continues');
      session.pendingInstruction = null;
      session.beginInstruction('Busca a Luis');
      expect(session.continuationRequest, isNull);
      expect(session.pendingInstruction, 'Busca a Luis');
      session.clear();
      session.beginInstruction('continua');
      expect(session.continuationRequest, isNull);
    },
  );
  test(
    'application generated UUID remains allowed without a user supplied key',
    () async {
      final schema = AppSchema({
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
      final repo = Repository(repository.local, repository.remote, schema);
      final engine = ScriptedEngine([
        toolReply('prepare_change', {
          'resource': 'clientes',
          'action': 'CREATE',
          'data': {'nombre': 'Elena'},
        }),
      ]);
      final outcome = await AssistantRunner(
        complete: (system, context) => engine.generate(system, context).join(),
        tools: LocalAssistantTools(repo, () {}),
        session: session,
        checkActive: () {},
        progress: (_) {},
      ).run('Crea Elena', 'clientes', 'uuid');
      expect(outcome.kind, 'draft');
      expect(
        outcome.draft!['proposal']['data']['id'],
        matches(RegExp(r'^[0-9a-f-]{36}$')),
      );
      expect(await repository.local.queue(), isEmpty);
    },
  );
  test(
    'invented required create values become an application clarification',
    () async {
      for (final instruction in [
        'Crea Maria sin id numerico',
        'Crea cliente 4 sin nombre',
      ]) {
        session.clear();
        final engine = ScriptedEngine([
          toolReply('prepare_change', {
            'resource': 'clientes',
            'action': 'CREATE',
            'data': {'id': 4, 'nombre': 'Maria'},
          }),
        ]);
        final outcome = await runner(
          engine,
        ).run(instruction, 'clientes', 'missing');
        expect(outcome.kind, 'question');
        expect(
          outcome.text,
          contains(instruction.contains('sin nombre') ? 'nombre' : 'id'),
        );
        expect(session.pendingDraft, isNull);
        expect(await repository.local.queue(), isEmpty);
      }
    },
  );
  test(
    'a resource label cannot supply an explicitly missing name; clarification can',
    () async {
      final engine = ScriptedEngine([
        toolReply('prepare_change', {
          'resource': 'clientes',
          'action': 'CREATE',
          'data': {'id': 4, 'nombre': 'Cliente 4'},
        }),
        toolReply('prepare_change', {
          'resource': 'clientes',
          'action': 'CREATE',
          'data': {'id': 4, 'nombre': 'Elena'},
        }),
      ]);
      final assistant = runner(engine);
      final missing = await assistant.run(
        'Crea cliente 4 sin nombre',
        'clientes',
        'missing-label',
      );
      expect(missing.kind, 'question');
      expect(missing.text, contains('nombre'));
      expect(session.pendingDraft, isNull);
      final clarified = await assistant.run(
        'Su nombre es Elena',
        'clientes',
        'clarified-label',
      );
      expect(clarified.kind, 'draft');
      expect(clarified.draft!['proposal']['data']['nombre'], 'Elena');
      expect(await repository.local.queue(), isEmpty);
    },
  );
  test(
    'validated references survive history eviction but never replace a fresh read',
    () async {
      final first = ScriptedEngine([
        toolReply('search_records', {
          'resource': 'clientes',
          'filters': [
            {'field': 'nombre', 'op': 'contains', 'value': 'Ana'},
          ],
        }),
        answerReply('Dos coincidencias.'),
      ]);
      await runner(first).run('Busca Ana', 'clientes', 'references');
      for (var i = 0; i < 30; i++) {
        session.add('user', 'otro mensaje $i');
      }
      expect(session.recent(1000).toString(), isNot(contains('Busca Ana')));
      final refs = session.facts['lastReferences'];
      expect(refs['records'].map((row) => row['id']).toList(), [1, 2]);
      expect(refs['requiresFreshReadBeforeChange'], true);
      final second = ScriptedEngine([
        toolReply('prepare_change', {
          'resource': 'clientes',
          'id': 2,
          'action': 'UPDATE',
          'data': {'telefono': '888'},
        }),
        toolReply('get_record', {'resource': 'clientes', 'id': 2}),
        toolReply('prepare_change', {
          'resource': 'clientes',
          'id': 2,
          'action': 'UPDATE',
          'data': {'telefono': '999'},
        }),
      ]);
      final result = await runner(
        second,
      ).run('La segunda, telefono 999', 'clientes', 'second');
      expect(
        second.contexts.first['facts']['lastReferences']['records'][1]['id'],
        2,
      );
      expect(result.kind, 'draft');
      expect(result.draft!['expected']['nombre'], 'Ana Lopez');
      expect(result.steps, 3);
      session.clear();
      expect(session.facts, isEmpty);
    },
  );
}
