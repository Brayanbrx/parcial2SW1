import 'dart:convert';
import 'dart:io';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';
import 'remote_ai.dart';

enum ModelRuntime { litertlm, gguf, whisper }

class LocalModelFile {
  final String id, name;
  final ModelRuntime runtime;
  final int bytes;
  const LocalModelFile(this.id, this.name, this.runtime, this.bytes);
  String get extension => switch (runtime) {
    ModelRuntime.litertlm => 'litertlm',
    ModelRuntime.gguf => 'gguf',
    ModelRuntime.whisper => 'bin',
  };
  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'runtime': runtime.name,
    'bytes': bytes,
  };
  factory LocalModelFile.fromJson(Map<String, dynamic> j) {
    if (j['id'] is! String ||
        !RegExp(r'^[a-f0-9-]{36}$').hasMatch(j['id']) ||
        j['name'] is! String ||
        j['bytes'] is! int ||
        j['bytes'] <= 0) {
      throw const FormatException('Catalogo de modelos invalido');
    }
    return LocalModelFile(
      j['id'],
      j['name'],
      ModelRuntime.values.byName(j['runtime']),
      j['bytes'],
    );
  }
}

/// Keeps private copies; imports never replace an earlier model.
///
/// Tambien decide de donde sale cada capacidad: `textMode` y `speechMode`
/// eligen entre el modelo importado (local, funciona en modo avion) y la IA en
/// linea configurada en [remote] con los proveedores de `infra/.env`.
class ModelLibrary {
  static const modes = ['local', 'remote'];
  final Directory directory;
  final List<LocalModelFile> models = [];
  String? textId, speechId;
  String _textMode = 'local', _speechMode = 'local';
  final RemoteAiSettings remote = RemoteAiSettings.fromBuild();
  final Map<String, Map<String, String>> _settings = {};
  bool get nativeTools =>
      text?.runtime == ModelRuntime.litertlm &&
      _settings[textId]?['nativeTools'] == 'verified' &&
      _settings[textId]?['nativeToolsBackend'] == backend;
  set nativeTools(bool value) {
    if (textId != null) {
      (_settings[textId!] ??= {})['nativeTools'] = value ? 'verified' : 'json';
      _settings[textId!]!['nativeToolsBackend'] = backend;
    }
  }

  String get backend => _settings[textId]?['backend'] ?? 'cpu';
  set backend(String value) {
    if (!['cpu', 'gpu'].contains(value))
      throw const FormatException('Backend local invalido');
    if (textId != null) (_settings[textId!] ??= {})['backend'] = value;
  }

  String get template => _settings[textId]?['template'] ?? 'chatml';
  set template(String value) {
    if (!templates.contains(value))
      throw const FormatException('Plantilla invalida');
    if (textId != null) (_settings[textId!] ??= {})['template'] = value;
  }

  String get language => _settings[speechId]?['language'] ?? 'es';
  set language(String value) {
    if (!['es', 'auto'].contains(value))
      throw const FormatException('Idioma invalido');
    if (speechId != null) (_settings[speechId!] ??= {})['language'] = value;
  }

  String get textMode => _textMode;
  set textMode(String value) {
    if (!modes.contains(value)) throw const FormatException('Modo invalido');
    _textMode = value;
  }

  String get speechMode => _speechMode;
  set speechMode(String value) {
    if (!modes.contains(value)) throw const FormatException('Modo invalido');
    _speechMode = value;
  }

  bool get textRemote => _textMode == 'remote';
  bool get speechRemote => _speechMode == 'remote';

  /// Hay con que interpretar texto: modelo importado o IA en linea completa.
  bool get textReady => textRemote ? remote.textReady : text != null;

  /// Hay con que transcribir: Whisper importado o IA en linea completa.
  bool get speechReady => speechRemote ? remote.speechReady : speech != null;

  static const templates = [
    'chatml',
    'llama2',
    'alpaca',
    'vicuna',
    'phi',
    'gemma',
    'zephyr',
  ];
  ModelLibrary(this.directory);

  static Future<ModelLibrary> open() async {
    final support = await getApplicationSupportDirectory();
    final library = ModelLibrary(Directory('${support.path}/local-models'));
    await library.restore();
    // Preserve the single GGUF from previous generated apps on first migration.
    final legacy = File('${support.path}/model.gguf');
    if (!await library.manifest.exists() && await legacy.exists()) {
      final model = await library.importFile(
        legacy,
        'Modelo GGUF anterior',
        ModelRuntime.gguf,
      );
      library.textId = model.id;
      final settings = File('${support.path}/model-settings.json');
      if (await settings.exists()) {
        final j = jsonDecode(await settings.readAsString());
        if (j is Map && templates.contains(j['template']))
          library.template = j['template'];
      }
      await library.save();
    }
    // Las claves de la IA en linea viven en el almacenamiento seguro, no en el
    // catalogo. Si ese almacenamiento falla, la biblioteca local sigue abriendo.
    try {
      await library.remote.load(const FlutterSecureStorage());
    } catch (_) {}
    return library;
  }

  File get manifest => File('${directory.path}/library.json');
  File file(LocalModelFile model) =>
      File('${directory.path}/${model.id}.${model.extension}');
  LocalModelFile? get text => models
      .where((m) => m.id == textId && m.runtime != ModelRuntime.whisper)
      .firstOrNull;
  LocalModelFile? get speech => models
      .where((m) => m.id == speechId && m.runtime == ModelRuntime.whisper)
      .firstOrNull;

  Future<void> restore() async {
    await directory.create(recursive: true);
    if (!await manifest.exists()) return;
    final j = jsonDecode(await manifest.readAsString()) as Map<String, dynamic>;
    if (j['version'] != 1)
      throw const FormatException('Version de catalogo incompatible');
    models
      ..clear()
      ..addAll((j['models'] as List).map((m) => LocalModelFile.fromJson(m)));
    textId = j['textId'];
    speechId = j['speechId'];
    _textMode = modes.contains(j['textMode']) ? j['textMode'] : 'local';
    _speechMode = modes.contains(j['speechMode']) ? j['speechMode'] : 'local';
    _settings.clear();
    final stored = j['settings'];
    if (stored is Map) {
      for (final model in models) {
        final entry = stored[model.id];
        if (entry is! Map) continue;
        _settings[model.id] = {
          if (entry['nativeTools'] == 'verified') 'nativeTools': 'verified',
          if (['cpu', 'gpu'].contains(entry['nativeToolsBackend']))
            'nativeToolsBackend': entry['nativeToolsBackend'],
          if (['cpu', 'gpu'].contains(entry['backend']))
            'backend': entry['backend'],
          if (templates.contains(entry['template']))
            'template': entry['template'],
          if (['es', 'auto'].contains(entry['language']))
            'language': entry['language'],
        };
      }
    } else {
      // Migrate preferences saved by the first version of the library.
      backend = ['cpu', 'gpu'].contains(j['backend']) ? j['backend'] : 'cpu';
      template = templates.contains(j['template']) ? j['template'] : 'chatml';
      language = ['es', 'auto'].contains(j['language']) ? j['language'] : 'es';
    }
  }

  Future<void> save() async {
    await directory.create(recursive: true);
    final pending = File('${manifest.path}.pending');
    await pending.writeAsString(
      jsonEncode({
        'version': 1,
        'models': models.map((m) => m.toJson()).toList(),
        'textId': textId,
        'speechId': speechId,
        'textMode': _textMode,
        'speechMode': _speechMode,
        'backend': backend,
        'template': template,
        'language': language,
        'settings': _settings,
      }),
      flush: true,
    );
    await pending.rename(manifest.path);
  }

  Future<LocalModelFile> importFile(
    File source,
    String name,
    ModelRuntime runtime,
  ) async {
    final size = await source.length();
    if (size < 16)
      throw const FormatException('Archivo de modelo vacio o incompleto');
    final handle = await source.open();
    try {
      final header = await handle.read(4);
      if (runtime == ModelRuntime.gguf &&
          ascii.decode(header, allowInvalid: true) != 'GGUF') {
        throw const FormatException('Se esperaba un archivo GGUF de texto');
      }
      if (runtime == ModelRuntime.whisper &&
          header.join(',') != '108,109,103,103') {
        throw const FormatException(
          'Se esperaba un modelo Whisper GGML .bin de whisper.cpp',
        );
      }
    } finally {
      await handle.close();
    }
    await directory.create(recursive: true);
    final model = LocalModelFile(const Uuid().v4(), name, runtime, size);
    final pending = File('${file(model).path}.pending');
    try {
      await source.copy(pending.path);
      if (await pending.length() != size) throw StateError('Copia incompleta');
      await pending.rename(file(model).path);
      models.add(model);
      try {
        await save();
      } catch (_) {
        models.remove(model);
        if (await file(model).exists()) await file(model).delete();
        rethrow;
      }
      return model;
    } finally {
      if (await pending.exists()) await pending.delete();
    }
  }

  Future<void> select(LocalModelFile model) async {
    if (!models.any((m) => m.id == model.id) || !await file(model).exists()) {
      throw StateError('El modelo ya no esta disponible. Importalo de nuevo.');
    }
    if (model.runtime == ModelRuntime.whisper) {
      speechId = model.id;
    } else {
      textId = model.id;
    }
    await save();
  }

  Future<void> remove(LocalModelFile model) async {
    models.removeWhere((m) => m.id == model.id);
    _settings.remove(model.id);
    if (textId == model.id) textId = null;
    if (speechId == model.id) speechId = null;
    await save();
    // Only delete the library-owned UUID path, never the imported source file.
    if (await file(model).exists()) await file(model).delete();
  }
}
