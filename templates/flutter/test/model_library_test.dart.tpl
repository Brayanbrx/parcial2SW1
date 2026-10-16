import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import '../lib/data/model_library.dart';

void main() {
  late Directory root;
  late ModelLibrary library;
  setUp(() async {
    root = await Directory.systemTemp.createTemp('model-library-test-');
    library = ModelLibrary(Directory('${root.path}/private'));
    await library.restore();
  });
  tearDown(() async {
    await root.delete(recursive: true);
  });
  Future<File> weights(String name, String header) async => File(
    '${root.path}/$name',
  ).writeAsBytes([...header.codeUnits, ...List.filled(32, 0)]);

  test(
    'conserva varios modelos, seleccion independiente y preferencias al reabrir',
    () async {
      final a = await library.importFile(
        await weights('a.gguf', 'GGUF'),
        'A',
        ModelRuntime.gguf,
      );
      final b = await library.importFile(
        await weights('b.litertlm', 'TEST'),
        'B',
        ModelRuntime.litertlm,
      );
      final voice = await library.importFile(
        await weights('base.bin', 'lmgg'),
        'Voz',
        ModelRuntime.whisper,
      );
      await library.select(a);
      await library.select(voice);
      await library.select(b);
      library.backend = 'gpu';
      library.template = 'gemma';
      await library.save();
      final restored = ModelLibrary(library.directory);
      await restored.restore();
      expect(restored.models.length, 3);
      expect(restored.text!.id, b.id);
      expect(restored.speech!.id, voice.id);
      expect(restored.backend, 'gpu');
      expect(restored.template, 'gemma');
      expect(await restored.file(a).exists(), isTrue);
    },
  );
  test(
    'no confunde GGUF de texto con Whisper y conserva catalogo tras error',
    () async {
      final source = await weights('wrong.bin', 'GGUF');
      await expectLater(
        library.importFile(source, 'wrong', ModelRuntime.whisper),
        throwsFormatException,
      );
      expect(library.models, isEmpty);
      expect(await source.exists(), isTrue);
    },
  );
  test('quitar borra solamente la copia privada seleccionada', () async {
    final source = await weights('a.gguf', 'GGUF');
    final model = await library.importFile(source, 'A', ModelRuntime.gguf);
    await library.select(model);
    await library.remove(model);
    expect(library.text, isNull);
    expect(await library.file(model).exists(), isFalse);
    expect(await source.exists(), isTrue);
    final restored = ModelLibrary(library.directory);
    await restored.restore();
    expect(restored.models, isEmpty);
  });
  test('rechaza rutas de catalogo fuera del directorio privado', () {
    expect(
      () => LocalModelFile.fromJson({
        'id': '../../outside',
        'name': 'x',
        'runtime': 'gguf',
        'bytes': 50,
      }),
      throwsFormatException,
    );
  });
  test(
    'cada LLM y Whisper recupera su propia configuracion al cambiar y reiniciar',
    () async {
      final a = await library.importFile(
        await weights('a.gguf', 'GGUF'),
        'Gemma',
        ModelRuntime.gguf,
      );
      final b = await library.importFile(
        await weights('b.gguf', 'GGUF'),
        'Otro',
        ModelRuntime.gguf,
      );
      final voice = await library.importFile(
        await weights('voz.bin', 'lmgg'),
        'Whisper',
        ModelRuntime.whisper,
      );
      await library.select(a);
      library.template = 'gemma';
      library.backend = 'gpu';
      await library.save();
      await library.select(b);
      expect(library.template, 'chatml');
      library.template = 'llama2';
      await library.save();
      await library.select(voice);
      library.language = 'auto';
      await library.save();
      await library.select(a);
      final restored = ModelLibrary(library.directory);
      await restored.restore();
      expect(restored.template, 'gemma');
      expect(restored.backend, 'gpu');
      expect(restored.language, 'auto');
      await restored.select(b);
      expect(restored.template, 'llama2');
      expect(restored.backend, 'cpu');
      expect(await restored.file(a).exists(), isTrue);
    },
  );
}
