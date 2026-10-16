import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import '../lib/data/assistant_runtime.dart';
import '../lib/domain/assistant_ports.dart';
import '../lib/data/isolated_text_engine.dart';
import 'support/assistant_test_support.dart';

class InvalidOutputEngine implements LocalTextEngine {
  @override
  Stream<String> generate(String system, String context) async* {
    throw const FormatException('Corrige argumentos');
  }

  @override
  Future<void> stop() async {}
  @override
  Future<void> close() async {}
}

Future<LocalTextEngine> invalidWorker(List<String> args) async =>
    InvalidOutputEngine();

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'worker preserves format errors so the orchestrator can repair them',
    () async {
      final worker = await IsolatedTextEngine.open(invalidWorker, []);
      await expectLater(
        worker.generate('s', '{}').join(),
        throwsFormatException,
      );
      await worker.close();
    },
  );
  test('reuses model between passes and messages, closes on release', () async {
    var loads = 0;
    final engine = ScriptedEngine([
      answerReply('uno'),
      answerReply('dos'),
      answerReply('tres'),
    ]);
    final runtime = AssistantRuntime(
      assistantLibrary(),
      factory: (_, _) async {
        loads++;
        return engine;
      },
    );
    await runtime.run((complete) async {
      await complete('s', '{}');
      await complete('s', '{}');
    });
    await runtime.run((complete) => complete('s', '{}'));
    expect(loads, 1);
    expect(engine.closes, 0);
    await runtime.release();
    expect(engine.closes, 1);
    await runtime.close();
  });
  test(
    'cancel while loading returns promptly but keeps lease until native cleanup',
    () async {
      final loading = Completer<LocalTextEngine>();
      final engine = ScriptedEngine([]);
      final runtime = AssistantRuntime(
        assistantLibrary(),
        factory: (_, _) => loading.future,
      );
      final work = runtime.run((complete) => complete('s', '{}'));
      final rejected = expectLater(work, throwsStateError);
      await runtime.cancel();
      await rejected;
      expect(runtime.processing, true);
      await expectLater(runtime.run((_) async => 1), throwsStateError);
      loading.complete(engine);
      await runtime.close();
      expect(engine.closes, 1);
    },
  );
  test('deadline includes loading and does not leak late engines', () async {
    final loading = Completer<LocalTextEngine>();
    final engine = ScriptedEngine([]);
    final runtime = AssistantRuntime(
      assistantLibrary(),
      factory: (_, _) => loading.future,
      requestTimeout: const Duration(milliseconds: 20),
    );
    await expectLater(
      runtime.run((complete) => complete('s', '{}')),
      throwsStateError,
    );
    expect(runtime.processing, true);
    loading.complete(engine);
    await runtime.close();
    expect(engine.closes, 1);
  });
  test('idle timeout unloads model', () async {
    final engine = ScriptedEngine([answerReply('ok')]);
    final runtime = AssistantRuntime(
      assistantLibrary(),
      factory: (_, _) async => engine,
      idleTimeout: const Duration(milliseconds: 10),
    );
    await runtime.run((complete) => complete('s', '{}'));
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(engine.closes, 1);
    await runtime.close();
  });
}
