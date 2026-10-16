import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/data/api.dart';
import '../lib/data/local_speech.dart';
import '../lib/data/repository.dart';
import '../lib/ui/app_model.dart';
import '../lib/ui/assistant_screen.dart';
import 'support/assistant_test_support.dart';

class SilentSpeech implements LocalSpeech {
  @override
  bool get recording => false;
  @override
  bool get transcribing => false;
  @override
  bool get capturing => false;
  @override
  Future<void> close() async {}
  @override
  Future<void> cancel() async {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// The widget test checks rendering and dispatch. SQLite transactions and stale
// drafts are exercised separately in assistant_view_model_test.dart.
class PreviewAppModel extends AppModel {
  int confirmations = 0;
  PreviewAppModel(Repository repo)
    : super(repo.schema, repo.remote as ApiClient, SessionStore()) {
    repository = repo;
  }
  @override
  Future<void> commitAssistantChange(
    Repository expectedRepository,
    Map<String, dynamic> draft,
  ) async {
    confirmations++;
    assistantSession.pendingDraft = null;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Repository repository;
  late PreviewAppModel app;
  setUp(() async {
    repository = await assistantRepository();
    app = PreviewAppModel(repository);
  });
  tearDown(() async {
    app.repository = null;
    app.dispose();
    await repository.local.close();
  });

  testWidgets(
    'large text at 320px shows readable diff and requires explicit confirmation',
    (tester) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final row = {
        'id': 1,
        'nombre': 'Ana Perez',
        'telefono': '111',
        'saldo': 0.1,
      };
      app.assistantSession.add('user', 'Cambia el telefono de Ana Perez');
      app.assistantSession.add(
        'assistant',
        'Revisa el cambio antes de guardarlo.',
      );
      app.assistantSession.pendingDraft = {
        'draftId': 'test',
        'expected': row,
        'proposal': {
          'action': 'UPDATE',
          'resource': 'clientes',
          'id': 1,
          'data': {...row, 'telefono': '77712345'},
        },
      };
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: Scaffold(
            body: AssistantScreen(
              app,
              simpleBuilder: () => const Text('sencillo'),
              openLibrary: () async => assistantLibrary(),
              createSpeech: (_) => SilentSpeech(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(
        find.text('telefono: 111 → 77712345'),
        250,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('telefono: 111 → 77712345'), findsOneWidget);
      expect(app.confirmations, 0);
      await tester.scrollUntilVisible(
        find.text('Confirmar cambio'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Confirmar cambio'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirmar cambio'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(app.confirmations, 1);
      expect(app.assistantSession.pendingDraft, isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      await app.assistantCleanup;
    },
  );
}
