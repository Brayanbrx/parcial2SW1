import 'dart:async';
import '../domain/assistant_ports.dart';
import 'local_agent.dart' show TextEngineFactory, openLocalTextEngine;
import 'model_library.dart';

/// One owner for loading, inference, cancellation and delayed native cleanup.
class AssistantRuntime {
  final ModelLibrary library;
  final TextEngineFactory factory;
  final Duration requestTimeout, turnTimeout, idleTimeout;
  LocalTextEngine? _engine;
  Completer<void>? _active;
  Completer<void>? _cancelled;
  Future<void>? _releasing;
  Timer? _idle;
  bool _closed = false, _stop = false;
  String? _configuration;
  int lastMilliseconds = 0;
  bool get processing => _active != null || _releasing != null;
  AssistantRuntime(
    this.library, {
    this.factory = openLocalTextEngine,
    this.requestTimeout = const Duration(seconds: 240),
    this.turnTimeout = const Duration(seconds: 120),
    this.idleTimeout = const Duration(seconds: 60),
  });

  void checkActive() {
    if (_stop || _closed) throw StateError('Solicitud cancelada');
  }

  Future<T> run<T>(
    Future<T> Function(AssistantCompletion complete) operation,
  ) async {
    if (_closed || processing)
      throw StateError('Espera a que se libere el modelo');
    if (!library.textReady)
      throw StateError('Selecciona un modelo local o configura la IA en linea');
    _idle?.cancel();
    _stop = false;
    final active = Completer<void>();
    _active = active;
    final cancellation = Completer<void>();
    _cancelled = cancellation;
    final timer = Timer(requestTimeout, () => unawaited(cancel()));
    final work = _work(operation, active);
    try {
      return await Future.any([
        work,
        cancellation.future.then<T>(
          (_) => throw StateError(
            'Solicitud cancelada o tiempo agotado; no se guardaron cambios.',
          ),
        ),
      ]);
    } finally {
      timer.cancel();
    }
  }

  Future<T> _work<T>(
    Future<T> Function(AssistantCompletion) operation,
    Completer<void> active,
  ) async {
    final watch = Stopwatch()..start();
    var succeeded = false;
    try {
      final configuration =
          '${library.textMode}|${library.textId}|${library.backend}|${library.template}|${library.nativeTools}|${library.remote.textLabel}';
      if (_configuration != configuration) {
        await _engine?.close();
        _engine = null;
      }
      final loadingTimer = Timer(turnTimeout, () => unawaited(cancel()));
      try {
        _engine ??= await factory(
          library,
          library.textRemote ? null : library.text,
        );
      } finally {
        loadingTimer.cancel();
      }
      _configuration = configuration;
      checkActive();
      final result = await operation(_complete);
      checkActive();
      succeeded = true;
      return result;
    } finally {
      // Never release the lease before a slow native call has really completed.
      try {
        if (!succeeded || _stop || _closed) {
          await _engine?.stop();
          await _engine?.close();
          _engine = null;
        }
      } finally {
        lastMilliseconds = watch.elapsedMilliseconds;
        _active = null;
        _cancelled = null;
        active.complete();
        if (_engine != null)
          _idle = Timer(
            idleTimeout,
            () => unawaited(release().catchError((Object _) {})),
          );
      }
    }
  }

  Future<String> _complete(String system, String context) async {
    checkActive();
    final timer = Timer(turnTimeout, () => unawaited(cancel()));
    final buffer = StringBuffer();
    try {
      await for (final token in _engine!.generate(system, context)) {
        checkActive();
        buffer.write(token);
        if (buffer.length > 12000)
          throw const FormatException('Respuesta demasiado larga');
      }
      checkActive();
      return buffer.toString();
    } finally {
      timer.cancel();
    }
  }

  Future<void> cancel() async {
    _stop = true;
    final cancelled = _cancelled;
    if (cancelled != null && !cancelled.isCompleted) cancelled.complete();
    try {
      await _engine?.stop().timeout(const Duration(seconds: 2));
    } catch (_) {}
  }

  Future<void> release() async {
    _idle?.cancel();
    if (_active != null) throw StateError('Espera a que termine el modelo');
    if (_releasing != null) return _releasing;
    final engine = _engine;
    if (engine == null) return;
    _engine = null;
    final work = engine.close();
    _releasing = work;
    try {
      await work;
    } finally {
      _releasing = null;
    }
  }

  Future<void> close() async {
    _closed = true;
    await cancel();
    await _active?.future;
    await release();
  }
}
