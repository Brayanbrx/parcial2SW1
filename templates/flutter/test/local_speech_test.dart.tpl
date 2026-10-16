import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:record/record.dart';
import '../lib/data/local_speech.dart';
import '../lib/data/model_library.dart';
import '../lib/domain/schema.dart';

class FakeRecorder implements AudioRecorder {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  String? path;
  bool disposed = false;
  Completer<void>? starting, releaseStart, stopping, releaseStop;
  @override
  Future<bool> hasPermission({bool request = true}) async => true;
  @override
  Future<void> start(RecordConfig config, {required String path}) async {
    expect(config.encoder, AudioEncoder.wav);
    expect(config.sampleRate, 16000);
    expect(config.numChannels, 1);
    this.path = path;
    await File(path).writeAsBytes(List.filled(4000, 0));
    starting?.complete();
    await releaseStart?.future;
  }

  @override
  Future<String?> stop() async {
    stopping?.complete();
    await releaseStop?.future;
    return path;
  }

  @override
  Future<void> cancel() async {}
  @override
  Future<void> dispose() async {
    disposed = true;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory directory;
  late ModelLibrary library;
  final resource = ResourceSpec({
    'className': 'Cliente',
    'path': '/api/clientes',
    'primaryKey': 'id',
    'fields': [
      {
        'name': 'id',
        'javaType': 'String',
        'nullable': false,
        'primaryKey': true,
      },
    ],
  });
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('local-speech-');
    library = ModelLibrary(Directory('${directory.path}/library'));
    final source = await File(
      '${directory.path}/ggml-base-q5_1.bin',
    ).writeAsBytes([...'lmgg'.codeUnits, ...List.filled(32, 0)]);
    await library.select(
      await library.importFile(
        source,
        'Whisper cuantizado',
        ModelRuntime.whisper,
      ),
    );
  });
  tearDown(() async {
    await directory.delete(recursive: true);
  });

  test(
    'cancelar mientras inicia el microfono impide una grabacion tardia',
    () async {
      final recorder = FakeRecorder()
        ..starting = Completer<void>()
        ..releaseStart = Completer<void>();
      final speech = LocalSpeech(
        library,
        recorder: recorder,
        temporaryDirectory: () async => directory,
      );
      final starting = speech.start(() {});
      final rejected = expectLater(starting, throwsStateError);
      await recorder.starting!.future;
      final cancelling = speech.cancel();
      recorder.releaseStart!.complete();
      await rejected;
      await cancelling;
      expect(speech.recording, isFalse);
      expect(await File(recorder.path!).exists(), isFalse);
      await speech.close();
    },
  );

  test(
    'dos paradas simultaneas no transcriben el mismo audio dos veces',
    () async {
      final recorder = FakeRecorder()
        ..stopping = Completer<void>()
        ..releaseStop = Completer<void>();
      var transcriptions = 0;
      final speech = LocalSpeech(
        library,
        recorder: recorder,
        temporaryDirectory: () async => directory,
        transcribe: (_, _) async {
          transcriptions++;
          return 'Ana';
        },
      );
      await speech.start(() {});
      final first = speech.finish(resource);
      await recorder.stopping!.future;
      await expectLater(speech.finish(resource), throwsStateError);
      recorder.releaseStop!.complete();
      expect(await first, 'Ana');
      expect(transcriptions, 1);
      await speech.close();
    },
  );

  test(
    'dictado usa archivo privado elegido, español y devuelve texto sin ejecutar CRUD',
    () async {
      final recorder = FakeRecorder();
      final speech = LocalSpeech(
        library,
        recorder: recorder,
        temporaryDirectory: () async => directory,
        transcribe: (request, modelPath) async {
          expect(modelPath, library.file(library.speech!).path);
          expect(request.language, 'es');
          expect(request.isTranslate, isFalse);
          expect(request.noContext, isTrue);
          expect(request.keepModelLoaded, isFalse);
          expect(request.initialPrompt, 'Cliente, id');
          expect(await File(request.audio).exists(), isTrue);
          return '  Crea Ana  ';
        },
      );
      await speech.start(() {});
      expect(await speech.finish(resource), 'Crea Ana');
      expect(await File(recorder.path!).exists(), isFalse);
      expect(await library.file(library.speech!).exists(), isTrue);
      await speech.close();
      expect(recorder.disposed, isTrue);
    },
  );
  test('cancelar grabacion no llama al transcriptor y elimina audio', () async {
    final recorder = FakeRecorder();
    final speech = LocalSpeech(
      library,
      recorder: recorder,
      temporaryDirectory: () async => directory,
      transcribe: (_, _) async => throw StateError('No debe transcribir'),
    );
    await speech.start(() {});
    await speech.cancel();
    expect(await File(recorder.path!).exists(), isFalse);
    expect(speech.recording, isFalse);
    await speech.close();
  });
  test(
    'cerrar durante inferencia espera al motor antes de eliminar audio y descarta texto',
    () async {
      final recorder = FakeRecorder();
      final entered = Completer<void>(), result = Completer<String>();
      final speech = LocalSpeech(
        library,
        recorder: recorder,
        temporaryDirectory: () async => directory,
        transcribe: (_, _) {
          entered.complete();
          return result.future;
        },
      );
      await speech.start(() {});
      final pending = speech.finish(resource);
      final rejected = expectLater(pending, throwsStateError);
      await entered.future;
      final closing = speech.close();
      expect(await File(recorder.path!).exists(), isTrue);
      result.complete('texto tardio');
      await rejected;
      await closing;
      expect(await File(recorder.path!).exists(), isFalse);
    },
  );
  test(
    'timeout devuelve control y conserva audio hasta terminar el motor',
    () async {
      final result = Completer<String>();
      final entered = Completer<void>();
      final recorder = FakeRecorder();
      final speech = LocalSpeech(
        library,
        recorder: recorder,
        temporaryDirectory: () async => directory,
        transcriptionTimeout: const Duration(milliseconds: 50),
        transcribe: (_, _) {
          entered.complete();
          return result.future;
        },
      );
      await speech.start(() {});
      final rejected = expectLater(speech.finish(resource), throwsStateError);
      await entered.future;
      await rejected;
      expect(speech.transcribing, isTrue);
      expect(await File(recorder.path!).exists(), isTrue);
      await expectLater(speech.start(() {}), throwsStateError);
      result.complete('texto tardio');
      await speech.close();
      expect(speech.transcribing, isFalse);
      expect(await File(recorder.path!).exists(), isFalse);
    },
  );
}
