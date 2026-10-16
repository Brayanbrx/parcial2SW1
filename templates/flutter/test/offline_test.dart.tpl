import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../lib/domain/schema.dart';
import '../lib/domain/proposal.dart';
import '../lib/data/local_store.dart';
import '../lib/data/repository.dart';
import '../lib/data/api.dart';

class FakeApi implements RemoteApi {
  bool offline = true, loseResponse = false, conflict = false;
  int writes = 0;
  final receipts = <String, Map<String, dynamic>>{};
  final rows = <String, Map<String, dynamic>>{};
  Completer<void>? reading, releaseRead;
  @override
  Future<dynamic> request(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    if (offline) throw Exception('offline');
    if (path == '/mobile-sync') {
      if (conflict) throw ApiFailure(409, 'Conflicto remoto');
      final id = body!['operationId'] as String;
      if (receipts.containsKey(id)) return receipts[id];
      writes++;
      final data = body['data'];
      if (body['method'] == 'DELETE') {
        rows.remove(body['id']);
      } else {
        rows[body['id']] = Map<String, dynamic>.from(data);
      }
      final result = <String, dynamic>{'operationId': id, 'data': data};
      receipts[id] = result;
      if (loseResponse) {
        loseResponse = false;
        throw Exception('response lost');
      }
      return result;
    }
    if (path == '/api/clientes') return rows.values.toList();
    reading?.complete();
    await releaseRead?.future;
    final record = rows[path.split('/').last];
    if (record == null) throw ApiFailure(404, 'No existe');
    return record;
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
            'javaType': 'String',
            'primaryKey': true,
            'nullable': false,
          },
          {
            'name': 'nombre',
            'javaType': 'String',
            'nullable': false,
            'maxLength': 120,
          },
        ],
      },
    ],
  });
  late LocalStore store;
  late FakeApi api;
  late Repository repo;
  setUp(() async {
    store = await LocalStore.open(
      'test',
      factory: databaseFactoryFfi,
      path: inMemoryDatabasePath,
    );
    api = FakeApi();
    repo = Repository(store, api, schema);
  });
  tearDown(() async {
    await store.close();
  });
  test(
    'resolver conflicto excluye sincronizacion, ediciones y otra resolucion',
    () async {
      api.offline = false;
      api.rows['a'] = {'id': 'a', 'nombre': 'Ana'};
      await repo.synchronize();
      await repo.save(schema.resources.first, {
        'id': 'a',
        'nombre': 'Local',
      }, create: false);
      api.conflict = true;
      await expectLater(repo.synchronize(), throwsA(isA<ApiFailure>()));
      final operation = (await store.queue()).single['operation_id'] as String;
      api.reading = Completer<void>();
      api.releaseRead = Completer<void>();
      final resolving = repo.acceptServer(operation);
      await api.reading!.future;
      await expectLater(repo.acceptServer(operation), throwsStateError);
      await expectLater(
        repo.save(schema.resources.first, {
          'id': 'b',
          'nombre': 'Otra',
        }, create: true),
        throwsStateError,
      );
      await repo.synchronize();
      api.releaseRead!.complete();
      await resolving;
      expect(await store.queue(), isEmpty);
      expect((await store.rows('clientes')).single['nombre'], 'Ana');
      await repo.save(schema.resources.first, {
        'id': 'a',
        'nombre': 'Posterior',
      }, create: false);
      expect((await store.rows('clientes')).single['nombre'], 'Posterior');
    },
  );
  test(
    'ediciones offline se consolidan antes del primer envio y alta borrada no llega al servidor',
    () async {
      final r = schema.resources.first;
      await repo.save(r, {'id': 'a', 'nombre': 'Ana'}, create: true);
      final operation = (await store.queue()).single['operation_id'];
      await repo.save(r, {'id': 'a', 'nombre': 'Corregida'}, create: false);
      expect((await store.queue()).single['operation_id'], operation);
      expect((await store.queue()).single['method'], 'POST');
      expect((await store.rows('clientes')).single['nombre'], 'Corregida');
      await repo.delete(r, 'a');
      expect(await store.queue(), isEmpty);
      expect(await store.rows('clientes'), isEmpty);
      api.offline = false;
      await repo.synchronize();
      expect(api.writes, 0);
    },
  );
  test(
    'CRUD propuesto por agente usa SQLite y reintentos para cualquier recurso del contrato',
    () async {
      final create = Proposal.parse(
        '{"action":"CREATE","resource":"clientes","data":{"id":"a","nombre":"Ana"}}',
        schema,
      );
      await repo.save(
        schema.resource(create.resource),
        create.data!,
        create: true,
      );
      final update = Proposal.parse(
        '{"action":"UPDATE","resource":"clientes","id":"a","data":{"id":"a","nombre":"Nueva"}}',
        schema,
      );
      await repo.save(
        schema.resource(update.resource),
        update.data!,
        create: false,
      );
      expect((await store.rows('clientes')).single['nombre'], 'Nueva');
      await expectLater(repo.synchronize(), throwsException);
      api.offline = false;
      await repo.synchronize();
      expect(api.rows['a']!['nombre'], 'Nueva');
      final deletion = Proposal.parse(
        '{"action":"DELETE","resource":"clientes","id":"a"}',
        schema,
      );
      api.offline = true;
      await repo.delete(schema.resource(deletion.resource), deletion.id);
      expect(await store.rows('clientes'), isEmpty);
      expect(await store.queue(), hasLength(1));
      api.offline = false;
      await repo.synchronize();
      expect(api.rows, isEmpty);
      expect(await store.queue(), isEmpty);
    },
  );
  test(
    'guardado local atomico y reintento con ID estable tras perder confirmacion',
    () async {
      await repo.save(schema.resources.first, {
        'id': 'a',
        'nombre': 'Ana',
      }, create: true);
      expect((await store.rows('clientes')).single['nombre'], 'Ana');
      final id = (await store.queue()).single['operation_id'];
      await expectLater(repo.synchronize(), throwsException);
      expect((await store.queue()).single['operation_id'], id);
      api.offline = false;
      api.loseResponse = true;
      await expectLater(repo.synchronize(), throwsException);
      expect(api.writes, 1);
      await repo.synchronize();
      expect(api.writes, 1);
      expect(await store.queue(), isEmpty);
    },
  );
  test(
    'no modifica una solicitud pendiente y conserva la base remota de una actualizacion',
    () async {
      await repo.save(schema.resources.first, {
        'id': 'a',
        'nombre': 'Ana',
      }, create: true);
      await expectLater(repo.synchronize(), throwsException);
      await expectLater(
        repo.save(schema.resources.first, {
          'id': 'a',
          'nombre': 'Otra',
        }, create: false),
        throwsStateError,
      );
      api.offline = false;
      await repo.synchronize();
      await repo.save(schema.resources.first, {
        'id': 'a',
        'nombre': 'Nueva',
      }, create: false);
      expect(
        jsonDecode((await store.queue()).single['base'] as String)['nombre'],
        'Ana',
      );
    },
  );
  test(
    'descarga elimina registros borrados en servidor sin borrar cambios pendientes',
    () async {
      api.offline = false;
      api.rows['a'] = {'id': 'a', 'nombre': 'Ana'};
      await repo.synchronize();
      api.rows.clear();
      await repo.synchronize();
      expect(await store.rows('clientes'), isEmpty);
    },
  );
  test('rechaza campos inventados y propuesta ambigua antes de guardar', () {
    expect(
      () => schema.resources.first.validate({
        'id': 'a',
        'nombre': 'Ana',
        'admin': true,
      }),
      throwsFormatException,
    );
    expect(
      () => Proposal.parse('{"question":"Que cliente?"}', schema),
      throwsFormatException,
    );
    expect(
      () => Proposal.parse(
        '{"action":"UPDATE","resource":"clientes","id":"a","data":{"id":"b","nombre":"Ana"}}',
        schema,
      ),
      throwsFormatException,
    );
  });
  test(
    'conserva datos y operacion al cerrar y volver a abrir SQLite',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'uml-offline-test-',
      );
      final path = '${directory.path}/local.db';
      LocalStore? disk;
      try {
        disk = await LocalStore.open(
          'test',
          factory: databaseFactoryFfi,
          path: path,
        );
        await Repository(disk, api, schema).save(schema.resources.first, {
          'id': 'a',
          'nombre': 'Ana',
        }, create: true);
        final operation = (await disk.queue()).single['operation_id'];
        await disk.close();
        disk = await LocalStore.open(
          'test',
          factory: databaseFactoryFfi,
          path: path,
        );
        expect((await disk.rows('clientes')).single['nombre'], 'Ana');
        expect((await disk.queue()).single['operation_id'], operation);
      } finally {
        await disk?.close();
        await directory.delete(recursive: true);
      }
    },
  );
  test(
    'no sobrescribe un registro cambiado durante la revision del formulario',
    () async {
      api.offline = false;
      api.rows['a'] = {'id': 'a', 'nombre': 'Ana'};
      await repo.synchronize();
      final original = (await store.rows('clientes')).single;
      api.rows['a'] = {'id': 'a', 'nombre': 'Remota'};
      await repo.synchronize();
      await expectLater(
        repo.save(
          schema.resources.first,
          {'id': 'a', 'nombre': 'Local'},
          create: false,
          expected: original,
        ),
        throwsStateError,
      );
      await expectLater(
        repo.delete(schema.resources.first, 'a', expected: original),
        throwsStateError,
      );
      expect(await store.queue(), isEmpty);
    },
  );
  test(
    'rechazo definitivo requiere resolucion y conserva version remota',
    () async {
      api.offline = false;
      api.rows['a'] = {'id': 'a', 'nombre': 'Ana'};
      await repo.synchronize();
      await repo.save(schema.resources.first, {
        'id': 'a',
        'nombre': 'Local',
      }, create: false);
      final operation = (await store.queue()).single['operation_id'] as String;
      await expectLater(repo.acceptServer(operation), throwsStateError);
      api.conflict = true;
      api.rows['a'] = {'id': 'a', 'nombre': 'Remota'};
      await expectLater(repo.synchronize(), throwsA(isA<ApiFailure>()));
      expect((await store.queue()).single['status'], 'conflict');
      expect((await store.rows('clientes')).single['nombre'], 'Local');
      await repo.acceptServer(operation);
      expect(await store.queue(), isEmpty);
      expect((await store.rows('clientes')).single['nombre'], 'Remota');
    },
  );
}
