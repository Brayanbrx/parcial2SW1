import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import '../lib/data/api.dart';
import '../lib/domain/schema.dart';

Map<String, dynamic> contract(String project, String resource, String key) => {
  'schemaVersion': 1,
  'project': project,
  'resources': [
    {
      'className': resource,
      'path': '/api/$resource',
      'primaryKey': key,
      'fields': [
        {
          'name': key,
          'javaType': 'UUID',
          'nullable': false,
          'primaryKey': true,
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
};
void main() {
  test('rechaza fechas y horas que Dart normaliza pero Java no acepta', () {
    final resource = ResourceSpec({
      'className': 'Evento',
      'path': '/api/eventos',
      'primaryKey': 'id',
      'fields': [
        {
          'name': 'id',
          'javaType': 'String',
          'nullable': false,
          'primaryKey': true,
        },
        {'name': 'fecha', 'javaType': 'LocalDateTime', 'nullable': false},
      ],
    });
    for (final date in [
      '2026-02-30T12:00:00',
      '2026-09-11T25:00:00',
      '2026-09-11T12:60:00',
      '2026-09-11T12:00:60',
      '2026-09-11T12:00:00.1234567890',
    ]) {
      expect(
        () => resource.validate({'id': 'a', 'fecha': date}),
        throwsFormatException,
        reason: date,
      );
    }
    for (final date in [
      '2024-02-29T23:59:59',
      '2026-09-11T12:00:00.123456789',
    ]) {
      expect(
        () => resource.validate({'id': 'a', 'fecha': date}),
        returnsNormally,
      );
    }
  });
  test(
    'mismo cliente adopta contratos de negocios diferentes y conserva contrato offline',
    () async {
      for (final name in ['ventas', 'barberia', 'inventario']) {
        final schema = contract(name, '${name}registros', 'codigo');
        final requests = <String>[];
        final api = ApiClient(
          client: MockClient((request) async {
            requests.add(request.url.path);
            if (request.url.path == '/session/login')
              return http.Response(
                jsonEncode({
                  'username': 'admin',
                  'accessToken': 'test',
                  'expiresAt': 4102444800,
                }),
                200,
              );
            expect(request.headers['authorization'], 'Bearer test');
            return http.Response(
              jsonEncode({'protocolVersion': 1, 'contract': schema}),
              200,
            );
          }),
        );
        final session = await api.login(
          'https://example.invalid',
          'admin',
          'password',
        );
        final restored = Session.fromJson(
          jsonDecode(jsonEncode(session.toJson())),
        );
        expect(restored.contract, schema);
        api.session = session;
        await api.verifyContract(
          AppSchema.fromRemote({
            'protocolVersion': 1,
            'contract': restored.contract,
          }),
        );
        expect(requests, [
          '/session/login',
          '/mobile-contract',
          '/mobile-contract',
        ]);
        api.close();
      }
    },
  );
  test('rechaza protocolo y rutas arbitrarias antes de activar contrato', () {
    final c = contract('ventas', 'clientes', 'id');
    expect(
      () => AppSchema.fromRemote({'protocolVersion': 2, 'contract': c}),
      throwsFormatException,
    );
    (c['resources'] as List).first['path'] = 'https://other.invalid/steal';
    expect(
      () => AppSchema.fromRemote({'protocolVersion': 1, 'contract': c}),
      throwsFormatException,
    );
  });
  test(
    'huella no cambia por orden de claves y bloquea cambios de contrato',
    () async {
      final c = contract('ventas', 'clientes', 'id');
      final a = AppSchema.fromRemote({'protocolVersion': 1, 'contract': c});
      final b = AppSchema.fromRemote({
        'protocolVersion': 1,
        'contract': Map<String, dynamic>.fromEntries(
          c.entries.toList().reversed,
        ),
      });
      expect(a.fingerprint, b.fingerprint);
      final api = ApiClient(
        session: Session(
          'https://example.invalid',
          'admin',
          'token',
          4102444800,
        ),
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'protocolVersion': 1,
              'contract': contract('otra', 'productos', 'codigo'),
            }),
            200,
          ),
        ),
      );
      await expectLater(api.verifyContract(a), throwsA(isA<ApiFailure>()));
      api.close();
    },
  );
}
