import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../lib/data/api.dart';
import '../lib/data/local_store.dart';
import '../lib/data/repository.dart';
import '../lib/domain/schema.dart';

const upper = 'ABCDEFAB-1234-4ABC-8DEF-ABCDEFABCDEF';
const lower = 'abcdefab-1234-4abc-8def-abcdefabcdef';

class UuidServer implements RemoteApi {
  final Map<String, Map<String, dynamic>> rows = {};
  final List<Map<String, dynamic>> requests = [];
  bool conflict = false;
  @override
  Future<dynamic> request(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    if (path == '/mobile-sync') {
      requests.add(Map.from(body!));
      if (conflict) throw ApiFailure(409, 'Conflicto');
      final id = (body['id'] as String).toLowerCase();
      final dto = Map<String, dynamic>.from(body['data'])..['id'] = id;
      rows[id] = dto;
      return {'operationId': body['operationId'], 'data': dto};
    }
    if (path == '/api/clientes') return rows.values.toList();
    final dto = rows[path.split('/').last.toLowerCase()];
    if (dto == null) throw ApiFailure(404, 'No existe');
    return dto;
  }
}

void main() {
  sqfliteFfiInit();
  final schema = AppSchema({
    'resources': [
      {
        'className': 'Cliente',
        'path': '/api/clientes',
        'primaryKey': 'id',
        'fields': [
          {
            'name': 'id',
            'javaType': 'UUID',
            'nullable': false,
            'primaryKey': true,
          },
          {'name': 'nombre', 'javaType': 'String', 'nullable': false},
          {'name': 'parentId', 'javaType': 'UUID', 'nullable': true},
        ],
      },
    ],
  });
  late LocalStore store;
  late UuidServer server;
  late Repository repo;
  setUp(() async {
    store = await LocalStore.open(
      'uuid-tests',
      factory: databaseFactoryFfi,
      path: inMemoryDatabasePath,
    );
    server = UuidServer();
    repo = Repository(store, server, schema);
  });
  tearDown(() async {
    await store.close();
  });

  Future<void> legacy() async {
    final payload = jsonEncode({'id': upper, 'nombre': 'Anterior'});
    await store.db.insert('records', {
      'resource': 'clientes',
      'id': upper,
      'payload': payload,
    });
    await store.db.insert('outbox', {
      'resource': 'clientes',
      'id': upper,
      'method': 'POST',
      'operation_id': '11111111-1111-4111-8111-111111111111',
      'payload': payload,
      'attempted': 1,
    });
  }

  test(
    'normaliza UUID de formularios, claves y referencias antes de guardar',
    () async {
      final resource = schema.resources.single;
      expect(resource.key.parse(upper), lower);
      await repo.save(resource, {
        'id': upper,
        'nombre': 'Ana',
        'parentId': upper,
      }, create: true);
      expect((await store.queue()).single['id'], lower);
      expect((await store.rows('clientes')).single['parentId'], lower);
      await repo.synchronize();
      expect(await store.queue(), isEmpty);
      expect((await store.rows('clientes')).single['id'], lower);
    },
  );

  test(
    'recupera un recibo antiguo sin cambiar su peticion ni bloquear la cola',
    () async {
      await legacy();
      final before = (await store.queue()).single;
      await repo.synchronize();
      expect(server.requests.single['id'], upper);
      expect(
        server.requests.single['data'],
        jsonDecode(before['payload'] as String),
      );
      expect(server.requests.single['operationId'], before['operation_id']);
      expect(await store.queue(), isEmpty);
      expect((await store.rows('clientes')).single['id'], lower);
      await repo.save(schema.resources.single, {
        'id': lower,
        'nombre': 'Actualizada',
      }, create: false);
      await repo.synchronize();
      expect(await store.queue(), isEmpty);
      expect((await store.rows('clientes')).single['nombre'], 'Actualizada');
    },
  );

  test(
    'resuelve conflictos anteriores usando la identidad UUID normalizada',
    () async {
      await legacy();
      server.conflict = true;
      server.rows[lower] = {'id': lower, 'nombre': 'Remota'};
      await expectLater(repo.synchronize(), throwsA(isA<ApiFailure>()));
      final operation = (await store.queue()).single['operation_id'] as String;
      await repo.acceptServer(operation);
      expect(await store.queue(), isEmpty);
      expect((await store.rows('clientes')).single, {
        'id': lower,
        'nombre': 'Remota',
      });
    },
  );
}
