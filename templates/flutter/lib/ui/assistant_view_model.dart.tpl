import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/assistant_runtime.dart';
import '../data/assistant_tools.dart';
import '../data/model_library.dart';
import '../data/repository.dart';
import '../domain/assistant_protocol.dart';
import '../domain/assistant_runner.dart';
import '../domain/assistant_session.dart';
import 'app_model.dart';

class AssistantViewModel extends ChangeNotifier {
  final AppModel app;
  final ModelLibrary library;
  final AssistantRuntime runtime;
  final Repository repository;
  final AssistantSession session;
  bool busy = false, _disposed = false;
  String status = '';
  AssistantViewModel(this.app, this.library, {AssistantRuntime? runtime})
    : runtime = runtime ?? AssistantRuntime(library),
      repository = app.repository!,
      session = app.assistantSession;
  bool get processing => runtime.processing;
  Map<String, dynamic>? get draft => session.pendingDraft;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _check(int generation) {
    runtime.checkActive();
    if (_disposed ||
        session.generation != generation ||
        !identical(app.repository, repository)) {
      throw StateError('La sesion cambio; solicitud descartada');
    }
  }

  Future<void> send(String text) async {
    if (busy || processing) return;
    if (draft != null) {
      status = 'Confirma o descarta el cambio pendiente antes de continuar.';
      _notify();
      return;
    }
    // Changing provider must never transfer a local conversation to the cloud.
    final mode = library.textRemote
        ? 'remote:${library.remote.textLabel}'
        : 'local';
    if (session.mode != null && session.mode != mode) session.clear();
    session.mode = mode;
    final generation = session.generation;
    busy = true;
    status = 'Preparando el asistente…';
    _notify();
    try {
      final outcome = await runtime.run(
        (complete) => AssistantRunner(
          complete: complete,
          tools: LocalAssistantTools(repository, () => _check(generation)),
          session: session,
          checkActive: () => _check(generation),
          progress: (value) {
            status = value;
            _notify();
          },
        ).run(text, app.selected.resource, const Uuid().v4()),
      );
      _check(generation);
      status =
          '${outcome.steps} pasos · ${(runtime.lastMilliseconds / 1000).toStringAsFixed(1)} s';
    } catch (error) {
      if (!_disposed && session.generation == generation) {
        status = error is StateError
            ? error.message.toString()
            : error.toString();
      }
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> confirm() async {
    final pending = draft;
    if (busy || processing || pending == null) return;
    busy = true;
    _notify();
    try {
      await app.commitAssistantChange(repository, pending);
      status = app.isLocal
          ? 'Guardado en este dispositivo.'
          : 'Guardado en este dispositivo. Consulta Pendientes para ver la sincronizacion.';
      session.add('assistant', status);
    } catch (error) {
      status = error.toString();
    } finally {
      busy = false;
      _notify();
    }
  }

  void discard() {
    if (busy) return;
    session.pendingDraft = null;
    session.add('user', 'Descarto el cambio pendiente. No se guardo.');
    status = 'Cambio descartado. Puedes corregir la instruccion.';
    _notify();
  }

  Future<void> cancel() async {
    status = 'Cancelando solicitud…';
    _notify();
    await runtime.cancel();
    _notify();
  }

  Future<void> reset() async {
    if (busy || processing) return;
    session.clear();
    await runtime.release();
    status = '';
    _notify();
  }

  Future<void> verifyNativeTools() async {
    if (busy ||
        processing ||
        library.textRemote ||
        library.text?.runtime != ModelRuntime.litertlm)
      return;
    busy = true;
    status = 'Comprobando llamadas nativas con datos de prueba…';
    _notify();
    try {
      await runtime.release();
      library.nativeTools = true;
      await runtime.run((complete) async {
        final runId = const Uuid().v4();
        final nonce = const Uuid().v4();
        final packet = {
          'protocol': 1,
          'runId': runId,
          'requireNativeCall': true,
          'tools': [assistantToolDefinitions().first],
          'instruction':
              'Invoca describe_resource con resource igual a prueba. Despues devuelve el codigo recibido en un JSON version 1 kind answer text.',
          'transcript': <Map<String, dynamic>>[],
        };
        final first = AssistantReply.parse(
          await complete(assistantSystemPrompt, jsonEncode(packet)),
        );
        if (first.kind != 'tool' ||
            first.tool != 'describe_resource' ||
            first.arguments['resource'] != 'prueba') {
          throw const FormatException(
            'El modelo no solicito la herramienta esperada',
          );
        }
        packet['transcript'] = [
          {
            'name': 'describe_resource',
            'ok': true,
            'data': {'codigo': nonce},
          },
        ];
        packet.remove('requireNativeCall');
        final second = AssistantReply.parse(
          await complete(assistantSystemPrompt, jsonEncode(packet)),
        );
        if (second.kind != 'answer' || !second.text.contains(nonce))
          throw const FormatException('El modelo no utilizo el resultado');
      });
      await library.save();
      status =
          'Prueba nativa superada para este modelo y procesador seleccionado. Evalua su precision con tus consultas.';
    } catch (error) {
      library.nativeTools = false;
      await library.save();
      status = 'Se mantiene el protocolo JSON: $error';
    } finally {
      if (!runtime.processing) await runtime.release();
      busy = false;
      _notify();
    }
  }

  Future<void> close() async {
    _disposed = true;
    await runtime.close();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
