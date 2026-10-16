import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import '../lib/data/assistant_tools.dart';
import '../lib/data/repository.dart';
import 'support/assistant_test_support.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Repository repository;
  late LocalAssistantTools tools;
  setUp(() async {
    repository = await assistantRepository();
    tools = LocalAssistantTools(repository, () {});
  });
  tearDown(() async {
    await repository.local.close();
  });

  test(
    'search uses local data outside the visible list; pages have stable cursors',
    () async {
      final first = await tools.execute('search_records', {
        'resource': 'clientes',
        'limit': 1,
        'filters': [
          {'field': 'nombre', 'op': 'contains', 'value': 'ana'},
        ],
      });
      expect(first['ok'], true);
      expect(first['data']['records'].single['id'], 1);
      final second = await tools.execute('search_records', {
        'resource': 'clientes',
        'limit': 1,
        'filters': [
          {'field': 'nombre', 'op': 'contains', 'value': 'ana'},
        ],
        'cursor': first['nextCursor'],
      });
      expect(second['data']['records'].single['id'], 2);
      expect(second['nextCursor'], isNull);
    },
  );
  test('cursor rejects concurrent change and changed filters', () async {
    final first = await tools.execute('search_records', {
      'resource': 'clientes',
      'limit': 1,
    });
    await repository.local.db.update(
      'records',
      {
        'payload': jsonEncode({'id': 1, 'nombre': 'Otra Ana'}),
      },
      where: 'id=?',
      whereArgs: ['1'],
    );
    final next = await tools.execute('search_records', {
      'resource': 'clientes',
      'cursor': first['nextCursor'],
    });
    expect(next['ok'], false);
    expect(next['error']['message'], contains('Cursor'));
  });
  test(
    'aggregates use all matching rows, exact decimal sums and null handling',
    () async {
      final sum = await tools.execute('aggregate_records', {
        'resource': 'clientes',
        'operation': 'sum',
        'field': 'saldo',
      });
      expect(sum['data']['value'], '0.30');
      final avg = await tools.execute('aggregate_records', {
        'resource': 'clientes',
        'operation': 'avg',
        'field': 'saldo',
      });
      expect(avg['data']['value'], '0.15');
      expect(avg['data']['nonNull'], 2);
      final count = await tools.execute('aggregate_records', {
        'resource': 'clientes',
        'operation': 'count',
      });
      expect(count['data']['value'], 3);
      final keyCount = await tools.execute('aggregate_records', {
        'resource': 'clientes',
        'operation': 'count',
        'field': 'id',
        'filters': [
          {'field': 'nombre', 'op': 'contains', 'value': 'Ana'},
        ],
      });
      expect(keyCount['ok'], true);
      expect(keyCount['data']['value'], 2);
      final decimalFilter = await tools.execute('search_records', {
        'resource': 'clientes',
        'filters': [
          {'field': 'saldo', 'op': 'lt', 'value': '0.15'},
        ],
      });
      expect(decimalFilter['ok'], true);
      expect(decimalFilter['data']['records'].single['id'], 1);
    },
  );
  test(
    'rejects unknown tools, resources, fields, types, operators and arbitrary arguments',
    () async {
      for (final request in [
        [
          'execute_sql',
          {'resource': 'clientes', 'sql': 'delete from records'},
        ],
        [
          'get_record',
          {'resource': 'otro', 'id': 1},
        ],
        [
          'get_record',
          {'resource': 'clientes', 'id': '1'},
        ],
        [
          'search_records',
          {
            'resource': 'clientes',
            'filters': [
              {'field': 'password', 'op': 'eq', 'value': 'x'},
            ],
          },
        ],
        [
          'search_records',
          {
            'resource': 'clientes',
            'filters': [
              {'field': 'id', 'op': 'contains', 'value': 1},
            ],
          },
        ],
        [
          'search_records',
          {
            'resource': 'clientes',
            'filters': [
              {'field': 'nombre', 'op': 'sql', 'value': 'x'},
            ],
          },
        ],
        [
          'aggregate_records',
          {'resource': 'clientes', 'operation': 'count', 'field': 'nombre'},
        ],
        [
          'prepare_change',
          {'resource': 'clientes', 'action': 'DELETE', 'id': 1, 'data': {}},
        ],
      ]) {
        final result = await tools.execute(
          request[0] as String,
          Map<String, dynamic>.from(request[1] as Map),
        );
        expect(result['ok'], false, reason: request.toString());
      }
      expect(await repository.local.queue(), isEmpty);
    },
  );
  test(
    'prepare requires evidence and never writes, preserves unrelated fields',
    () async {
      final args = {
        'resource': 'clientes',
        'action': 'UPDATE',
        'id': 1,
        'data': {'telefono': '77712345'},
      };
      expect((await tools.execute('prepare_change', args))['ok'], false);
      await tools.execute('get_record', {'resource': 'clientes', 'id': 1});
      final result = await tools.execute('prepare_change', args);
      expect(result['ok'], true);
      expect(result['data']['proposal']['data']['nombre'], 'Ana Perez');
      expect(result['data']['expected']['telefono'], '111');
      expect(
        (await repository.local.rows('clientes')).first['telefono'],
        '111',
      );
      expect(await repository.local.queue(), isEmpty);
    },
  );
  test('prepare rejects stale evidence and primary-key changes', () async {
    await tools.execute('get_record', {'resource': 'clientes', 'id': 1});
    final invalid = await tools.execute('prepare_change', {
      'resource': 'clientes',
      'action': 'UPDATE',
      'id': 1,
      'data': {'id': 2},
    });
    expect(invalid['ok'], false);
    await repository.save(repository.schema.resources.first, {
      'id': 1,
      'nombre': 'Cambio',
      'telefono': '111',
      'saldo': 0.1,
    }, create: false);
    final stale = await tools.execute('prepare_change', {
      'resource': 'clientes',
      'action': 'DELETE',
      'id': 1,
    });
    expect(stale['ok'], false);
  });
  test('create rejects duplicate keys and required missing fields', () async {
    expect(
      (await tools.execute('prepare_change', {
        'resource': 'clientes',
        'action': 'CREATE',
        'data': {'id': 1, 'nombre': 'Duplicado'},
      }))['ok'],
      false,
    );
    expect(
      (await tools.execute('prepare_change', {
        'resource': 'clientes',
        'action': 'CREATE',
        'data': {'id': 5},
      }))['ok'],
      false,
    );
    final valid = await tools.execute('prepare_change', {
      'resource': 'clientes',
      'action': 'CREATE',
      'data': {'id': 5, 'nombre': 'Maria'},
    });
    expect(valid['data']['proposal']['data']['telefono'], isNull);
    expect(await repository.local.queue(), isEmpty);
  });
  test('scan limit never presents a partial aggregate as a total', () async {
    final batch = repository.local.db.batch();
    for (var i = 4; i <= 5001; i++) {
      batch.insert('records', {
        'resource': 'clientes',
        'id': '$i',
        'payload': jsonEncode({'id': i, 'nombre': 'Cliente'}),
      });
    }
    await batch.commit(noResult: true);
    final result = await tools.execute('aggregate_records', {
      'resource': 'clientes',
      'operation': 'count',
    });
    expect(result['coverage']['complete'], false);
    expect(result['data']['value'], isNull);
  });
  test(
    'deleted records are excluded and cancellation stops before reading',
    () async {
      await repository.local.db.update(
        'records',
        {'deleted': 1},
        where: 'id=?',
        whereArgs: ['1'],
      );
      expect(
        (await tools.execute('get_record', {
          'resource': 'clientes',
          'id': 1,
        }))['data']['record'],
        isNull,
      );
      final cancelled = LocalAssistantTools(
        repository,
        () => throw StateError('cancelado'),
      );
      await expectLater(
        cancelled.execute('search_records', {'resource': 'clientes'}),
        throwsStateError,
      );
    },
  );
}
