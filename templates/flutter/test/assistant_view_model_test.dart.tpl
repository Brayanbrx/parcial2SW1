import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import '../lib/data/api.dart';
import '../lib/data/assistant_runtime.dart';
import '../lib/data/repository.dart';
import '../lib/ui/app_model.dart';
import '../lib/ui/assistant_view_model.dart';
import 'support/assistant_test_support.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Repository repository;
  late AppModel app;
  late AssistantViewModel vm;
  late ScriptedEngine engine;
  setUp(() async {
    repository = await assistantRepository();
    app = AppModel(
      repository.schema,
      repository.remote as ApiClient,
      SessionStore(),
    )..repository = repository;
    final library = assistantLibrary();
    engine = ScriptedEngine([
      toolReply('get_record', {'resource': 'clientes', 'id': 1}),
      toolReply('prepare_change', {
        'resource': 'clientes',
        'action': 'UPDATE',
        'id': 1,
        'data': {'telefono': '77712345'},
      }),
    ]);
    vm = AssistantViewModel(
      app,
      library,
      runtime: AssistantRuntime(library, factory: (_, _) async => engine),
    );
  });
  tearDown(() async {
    await vm.close();
    vm.dispose();
    app.repository = null;
    app.dispose();
    await repository.local.close();
  });
  test(
    'only explicit confirmation writes; duplicate confirmation creates one outbox entry',
    () async {
      await vm.send('Cambia telefono de Ana Perez a 77712345');
      expect(vm.draft, isNotNull);
      expect(await repository.local.queue(), isEmpty);
      await Future.wait([vm.confirm(), vm.confirm()]);
      expect(vm.draft, isNull);
      expect(await repository.local.queue(), hasLength(1));
      final receipts = app.assistantSession.facts['confirmedChanges'];
      expect(receipts, hasLength(1));
      expect(
        receipts.single['request'],
        'Cambia telefono de Ana Perez a 77712345',
      );
      expect(receipts.single['data']['telefono'], '77712345');
      expect(receipts.single['status'], 'saved_locally');
      expect(app.assistantSession.evidence, isEmpty);
      expect(
        (await repository.local.rows('clientes')).first['telefono'],
        '77712345',
      );
    },
  );
  test(
    'concurrent edits invalidate draft at confirmation without overwriting',
    () async {
      await vm.send('Cambia telefono de Ana Perez a 77712345');
      await repository.save(repository.schema.resources.first, {
        'id': 1,
        'nombre': 'Ana Perez',
        'telefono': '999',
        'saldo': 0.1,
      }, create: false);
      await vm.confirm();
      expect(vm.draft, isNull);
      expect(vm.status, contains('cambio'));
      expect(
        (await repository.local.rows('clientes')).first['telefono'],
        '999',
      );
    },
  );
  test(
    'discard does not write and preserves conversation for correction',
    () async {
      await vm.send('Cambia telefono de Ana Perez a 77712345');
      vm.discard();
      expect(vm.draft, isNull);
      expect(await repository.local.queue(), isEmpty);
      expect(app.assistantSession.messages.last['text'], contains('Descarto'));
    },
  );
  test(
    'switching local to remote clears previous conversation before transmission',
    () async {
      app.assistantSession.mode = 'local';
      app.assistantSession.add('user', 'SECRETO_LOCAL');
      vm.library.textMode = 'remote';
      vm.library.remote.set('AI_LLM_PROVIDER', 'groq');
      vm.library.remote.set('AI_LLM_MODEL', 'test');
      vm.library.remote.set('GROQ_API_KEY', 'test');
      await vm.send('Cambia telefono');
      expect(jsonEncode(engine.contexts), isNot(contains('SECRETO_LOCAL')));
    },
  );
  test('new conversation clears memory and pending draft', () async {
    await vm.send('Cambia telefono');
    await vm.reset();
    expect(app.assistantSession.messages, isEmpty);
    expect(vm.draft, isNull);
    expect(engine.closes, 1);
  });
}
