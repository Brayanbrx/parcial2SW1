import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../data/api.dart';
import '../data/local_store.dart';
import '../data/local_auth.dart';
import '../data/repository.dart';
import '../domain/schema.dart';
import '../domain/assistant_session.dart';
import '../domain/proposal.dart';

class AppModel extends ChangeNotifier {
  final assistantSession = AssistantSession();
  Future<void>? assistantCleanup;
  AppSchema schema;
  final ApiClient api;
  final SessionStore sessions;
  final LocalAuth localAuth;
  final Future<LocalStore> Function(String scope) openStore;
  Repository? repository;
  ResourceSpec selected;
  List<Map<String, dynamic>> rows = [];
  List<Map<String, Object?>> queue = [];
  String message = '';
  bool busy = false;
  bool serverReachable = false;
  bool get syncing => _syncRun != null;
  Object? _syncRun;
  bool _disposed = false;
  Timer? timer;
  Session? get session => api.session;
  bool get isLocal => session?.isLocal == true;
  AppModel(
    this.schema,
    this.api,
    this.sessions, {
    this.openStore = LocalStore.open,
  }) : localAuth = LocalAuth(sessions.storage),
       selected = schema.resources.first {
    api.sessions = sessions;
  }
  Future<void> restore() async {
    await localAuth.ensureSeed();
    final session = await sessions.restore();
    if (session != null) await _open(session);
  }

  Future<void> loginLocal(String username, String password) async {
    final session = await localAuth.login(username, password);
    await _open(session);
    await sessions.save(session);
  }

  Future<void> login(String url, String username, String password) async {
    final session = await api.login(url, username, password);
    await sessions.save(session);
    await _open(session);
  }

  Future<void> _open(Session session) async {
    assistantSession.clear();
    final bundled = await AppSchema.load();
    final nextSchema = session.isLocal
        ? bundled
        : session.contract == null
        ? schema
        : AppSchema.fromRemote({
            'protocolVersion': 1,
            'contract': session.contract,
          });
    // Preserve queues from the earlier paired APK when connecting to its original contract.
    final scopeHash = nextSchema.fingerprint == bundled.fingerprint
        ? '__SCHEMA_HASH__'
        : nextSchema.fingerprint;
    timer?.cancel();
    _syncRun = null;
    serverReachable = false;
    await repository?.local.close();
    api.session = session;
    schema = nextSchema;
    selected = schema.resources.first;
    repository = Repository(
      await openStore('${session.url}|${session.username}|$scopeHash'),
      api,
      schema,
    );
    await refreshLocal();
    message = session.isLocal ? 'Guardado en este dispositivo' : '';
    if (session.isLocal) return;
    timer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => unawaited(sync()),
    );
    unawaited(sync());
  }

  Future<void> logout() async {
    if (busy) throw StateError('Espera a que termine la operacion');
    assistantSession.clear();
    timer?.cancel();
    _syncRun = null;
    final wasLocal = isLocal;
    if (session != null && !wasLocal) await sessions.queueLogout(session!);
    // Invalidate in-flight requests before awaiting secure-storage deletion.
    api.session = null;
    await sessions.clear();
    await repository?.local.close();
    repository = null;
    api.session = null;
    rows = [];
    queue = [];
    notifyListeners();
    if (!wasLocal) unawaited(api.flushLogouts());
  }

  Future<void> refreshLocal() async {
    final repo = repository;
    if (repo == null || _disposed) return;
    final resource = selected;
    final nextRows = await repo.local.rows(resource.resource);
    final nextQueue = await repo.local.queue();
    if (_disposed ||
        !identical(repository, repo) ||
        !identical(selected, resource))
      return;
    rows = nextRows;
    queue = nextQueue;
    notifyListeners();
  }

  Future<void> select(ResourceSpec value) async {
    selected = value;
    await refreshLocal();
  }

  Future<void> sync() async {
    if (isLocal) return;
    final repo = repository;
    if (busy || _syncRun != null || repo == null || _disposed) return;
    final run = Object();
    _syncRun = run;
    message = 'Comprobando servidor…';
    notifyListeners();
    var locked = false;
    bool current() =>
        !_disposed && identical(repository, repo) && identical(_syncRun, run);
    try {
      // A slow/unreachable server must not prevent local agent/form writes.
      // Lock editing only after the contract is reachable and the outbox is sent.
      await api.verifyContract(schema);
      if (current()) serverReachable = true;
      if (!current() || busy) return;
      locked = true;
      busy = true;
      notifyListeners();
      await repo.synchronize();
      if (current()) message = 'Actualizado';
    } catch (error) {
      if (current()) {
        // An HTTP rejection (for example a conflict) still proves connectivity.
        serverReachable = error is ApiFailure || error is FormatException;
        message = error is ApiFailure
            ? error.message
            : error is FormatException
            ? error.message
            : error is StateError
            ? error.message.toString()
            : connectionErrorMessage(error, session?.url ?? '');
      }
    } finally {
      if (current()) {
        _syncRun = null;
        if (locked) busy = false;
        await refreshLocal();
      }
    }
  }

  Future<void> acceptServer(String operationId) async {
    final repo = repository;
    if (busy || repo == null || _disposed) {
      throw StateError('Espera a que termine la operacion');
    }
    busy = true;
    notifyListeners();
    try {
      await repo.acceptServer(operationId);
    } finally {
      if (!_disposed && identical(repository, repo)) {
        busy = false;
        await refreshLocal();
      }
    }
  }

  Future<void> save(
    ResourceSpec resource,
    Map<String, dynamic> data, {
    required bool create,
    Map<String, dynamic>? expected,
  }) async {
    if (busy) throw StateError('Espera a que termine la sincronizacion');
    await repository!.save(resource, data, create: create, expected: expected);
    await refreshLocal();
    unawaited(sync());
  }

  Future<void> delete(
    ResourceSpec resource,
    dynamic id, {
    Map<String, dynamic>? expected,
  }) async {
    if (busy) throw StateError('Espera a que termine la sincronizacion');
    await repository!.delete(resource, id, expected: expected);
    await refreshLocal();
    unawaited(sync());
  }

  @override
  void dispose() {
    assistantSession.clear();
    _disposed = true;
    _syncRun = null;
    timer?.cancel();
    api.close();
    unawaited(repository?.local.close());
    super.dispose();
  }

  Future<void> commitAssistantChange(
    Repository expectedRepository,
    Map<String, dynamic> draft,
  ) async {
    if (busy ||
        _disposed ||
        !identical(repository, expectedRepository) ||
        !identical(assistantSession.pendingDraft, draft)) {
      throw StateError(
        'El borrador ya no pertenece a la sesion activa o hay una sincronizacion en curso',
      );
    }
    final raw = Map<String, dynamic>.from(draft['proposal']);
    final expected = draft['expected'] == null
        ? null
        : Map<String, dynamic>.from(draft['expected']);
    final proposal = Proposal.parse(
      jsonEncode(raw),
      schema,
      records: expected == null ? [] : [expected],
    );
    final resource = schema.resource(proposal.resource);
    busy = true;
    notifyListeners();
    try {
      if (proposal.action == 'DELETE') {
        await expectedRepository.delete(
          resource,
          proposal.id,
          expected: expected,
        );
      } else {
        await expectedRepository.save(
          resource,
          proposal.data!,
          create: proposal.action == 'CREATE',
          expected: expected,
        );
      }
      assistantSession.recordCommitted(draft);
      assistantSession.pendingDraft = null;
      assistantSession.pendingQuestion = null;
      assistantSession.pendingInstruction = null;
      assistantSession.add(
        'system',
        'Cambio confirmado y guardado localmente: ${draft['draftId']}',
      );
    } catch (_) {
      assistantSession.pendingDraft = null;
      rethrow;
    } finally {
      busy = false;
      if (!_disposed && identical(repository, expectedRepository)) {
        try {
          await refreshLocal();
        } catch (_) {
          message = 'No se pudo actualizar la vista local.';
        }
        notifyListeners();
      }
    }
    unawaited(sync());
  }
}
