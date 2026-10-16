import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../lib/data/api.dart';
import '../lib/data/local_store.dart';
import '../lib/data/repository.dart';
import '../lib/domain/schema.dart';
import '../lib/domain/proposal.dart';
import '../lib/ui/app_model.dart';

class SlowConnection extends ApiClient {
  Completer<void> connection = Completer<void>();
  final stored = <String, dynamic>{};
  int sent = 0;
  @override
  Future<void> verifyContract(AppSchema schema) => connection.future;
  @override
  Future<dynamic> request(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    if (path == '/mobile-sync') {
      sent++;
      stored.addAll(body!['data']);
      return {
        'operationId': body['operationId'],
        'data': Map<String, dynamic>.from(stored),
      };
    }
    return [Map<String, dynamic>.from(stored)];
  }
}

class SlowResolution extends Repository {
  SlowResolution(super.local, super.remote, super.schema);
  final started = Completer<void>(), released = Completer<void>();
  int synchronizations = 0;
  @override
  Future<void> acceptServer(String operationId) async {
    started.complete();
    await released.future;
  }

  @override
  Future<void> synchronize() async {
    synchronizations++;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  test(
    'sondeo pendiente no desbloquea una resolucion de conflicto activa',
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
                'javaType': 'String',
                'nullable': false,
                'primaryKey': true,
              },
            ],
          },
        ],
      });
      final local = await LocalStore.open(
        'conflict-lock',
        factory: databaseFactoryFfi,
        path: inMemoryDatabasePath,
      );
      final api = SlowConnection();
      final repo = SlowResolution(local, api, schema);
      final model = AppModel(schema, api, SessionStore())..repository = repo;
      final checking = model.sync();
      final resolving = model.acceptServer('conflict');
      await repo.started.future;
      api.connection.complete();
      await checking;
      expect(model.busy, isTrue);
      expect(repo.synchronizations, 0);
      await expectLater(model.logout(), throwsStateError);
      await expectLater(
        model.save(schema.resources.first, {'id': 'a'}, create: true),
        throwsStateError,
      );
      repo.released.complete();
      await resolving;
      expect(model.busy, isFalse);
      model.repository = null;
      model.dispose();
      await local.close();
    },
  );
  test(
    'propuesta confirmada se guarda durante espera offline y sincroniza al reconectar',
    () async {
      final schema = AppSchema({
        'project': 'test',
        'resources': [
          {
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
              {'name': 'nombre', 'javaType': 'String', 'nullable': false},
            ],
          },
        ],
      });
      final local = await LocalStore.open(
        'offline-agent',
        factory: databaseFactoryFfi,
        path: inMemoryDatabasePath,
      );
      final api = SlowConnection();
      final model = AppModel(schema, api, SessionStore());
      model.repository = Repository(local, api, schema);
      final checking = model.sync();
      expect(model.busy, isFalse);
      final proposal = Proposal.parse(
        '{"action":"CREATE","resource":"clientes","data":{"id":"a","nombre":"Ana"}}',
        schema,
      );
      await model.save(schema.resources.first, proposal.data!, create: true);
      expect((await local.rows('clientes')).single['nombre'], 'Ana');
      expect((await local.queue()).length, 1);
      expect(api.sent, 0);
      api.connection.completeError(Exception('offline'));
      await checking;
      expect(model.serverReachable, isFalse);
      expect(model.message, contains('No se pudo conectar'));
      expect((await local.queue()).length, 1);
      api.connection = Completer<void>()..complete();
      await model.sync();
      expect(model.serverReachable, isTrue);
      expect(api.sent, 1);
      expect(await local.queue(), isEmpty);
      expect((await local.rows('clientes')).single['nombre'], 'Ana');
      model.repository = null;
      model.dispose();
      await local.close();
    },
  );
}
