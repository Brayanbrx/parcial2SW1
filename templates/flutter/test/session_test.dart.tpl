import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import '../lib/data/api.dart';

class MemorySessions extends SessionStore {
  String? saved;
  List<Map<String, dynamic>> logouts = [];
  @override
  Future<Session?> restore() async =>
      saved == null ? null : Session.fromJson(jsonDecode(saved!));
  @override
  Future<void> save(Session session) async {
    saved = jsonEncode(session.toJson());
  }

  @override
  Future<void> clear() async {
    saved = null;
  }

  @override
  Future<List<Map<String, dynamic>>> pendingLogouts() async =>
      logouts.map((e) => Map<String, dynamic>.from(e)).toList();
  @override
  Future<void> saveLogouts(List<Map<String, dynamic>> entries) async {
    logouts = entries;
  }
}

Session cached({bool expired = true, String? refresh = 'device-secret'}) =>
    Session(
      'https://backend.test',
      'admin',
      'old-access',
      expired ? 1 : DateTime.now().millisecondsSinceEpoch ~/ 1000 + 900,
      contract: {'resources': []},
      refreshToken: refresh,
    );
http.Response renewed() => http.Response(
  jsonEncode({
    'username': 'admin',
    'accessToken': 'new-access',
    'refreshToken': 'device-secret',
    'expiresAt': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 900,
  }),
  200,
);

void main() {
  test('no reenvia una operacion con otra sesion tras un 401 tardio', () async {
    final entered = Completer<void>(), response = Completer<http.Response>();
    final sent = <String>[];
    final api = ApiClient(
      session: cached(expired: false),
      client: MockClient((req) {
        sent.add(req.url.host);
        if (!entered.isCompleted) entered.complete();
        return response.future;
      }),
    );
    final pending = api.request('POST', '/mobile-sync', {
      'operationId': 'old-account',
    });
    final rejected = expectLater(pending, throwsA(isA<ApiFailure>()));
    await entered.future;
    api.session = Session(
      'https://other.test',
      'other',
      'other-token',
      9999999999,
    );
    response.complete(http.Response('{}', 401));
    await rejected;
    expect(sent, ['backend.test']);
    expect(api.session!.username, 'other');
    api.close();
  });

  test('ignora respuesta exitosa de una sesion cerrada', () async {
    final entered = Completer<void>(), response = Completer<http.Response>();
    final api = ApiClient(
      session: cached(expired: false),
      client: MockClient((req) {
        entered.complete();
        return response.future;
      }),
    );
    final pending = api.request('GET', '/api/clientes');
    final rejected = expectLater(pending, throwsA(isA<ApiFailure>()));
    await entered.future;
    api.session = null;
    response.complete(http.Response('[{"id":"private"}]', 200));
    await rejected;
    api.close();
  });

  test(
    'una cuenta nueva no reutiliza la renovacion pendiente de la anterior',
    () async {
      final entered = Completer<void>(),
          oldResponse = Completer<http.Response>();
      final api = ApiClient(
        session: cached(),
        client: MockClient((req) {
          if (req.url.host == 'backend.test') {
            entered.complete();
            return oldResponse.future;
          }
          if (req.url.path == '/session/refresh') {
            return Future.value(
              http.Response(
                jsonEncode({
                  'username': 'other',
                  'accessToken': 'new-other',
                  'refreshToken': 'other-refresh',
                  'expiresAt': 9999999999,
                }),
                200,
              ),
            );
          }
          expect(req.headers['authorization'], 'Bearer new-other');
          return Future.value(http.Response('[]', 200));
        }),
      );
      final previous = api.request('GET', '/api/clientes');
      final rejected = expectLater(previous, throwsA(isA<ApiFailure>()));
      await entered.future;
      api.session = Session(
        'https://other.test',
        'other',
        'expired-other',
        1,
        refreshToken: 'other-refresh',
      );
      expect(await api.request('GET', '/api/clientes'), []);
      oldResponse.complete(renewed());
      await rejected;
      expect(api.session!.token, 'new-other');
      api.close();
    },
  );

  test(
    'restaura sesion y renueva una sola vez para solicitudes simultaneas',
    () async {
      final store = MemorySessions();
      await store.save(cached());
      var refreshes = 0;
      final api = ApiClient(
        session: await store.restore(),
        client: MockClient((req) async {
          if (req.url.path == '/session/refresh') {
            refreshes++;
            expect(jsonDecode(req.body), {'refreshToken': 'device-secret'});
            expect(req.headers['authorization'], isNull);
            return renewed();
          }
          expect(req.headers['authorization'], 'Bearer new-access');
          return http.Response('[]', 200);
        }),
      )..sessions = store;
      await Future.wait([
        api.request('GET', '/api/clientes'),
        api.request('GET', '/api/productos'),
      ]);
      expect(refreshes, 1);
      expect((await store.restore())!.token, 'new-access');
      expect((await store.restore())!.contract, {'resources': []});
      expect(jsonDecode(store.saved!).containsKey('password'), isFalse);
      api.close();
    },
  );

  test(
    'un 401 renueva y reintenta la misma operacion sin modificar su id',
    () async {
      var sends = 0, refreshes = 0;
      final operation = {
        'operationId': 'stable-id',
        'method': 'PUT',
        'data': {'nombre': 'Ana'},
      };
      final api = ApiClient(
        session: cached(expired: false),
        client: MockClient((req) async {
          if (req.url.path == '/session/refresh') {
            refreshes++;
            return renewed();
          }
          expect(jsonDecode(req.body), operation);
          sends++;
          return http.Response(
            sends == 1 ? '{}' : '{"ok":true}',
            sends == 1 ? 401 : 200,
          );
        }),
      );
      expect(await api.request('POST', '/mobile-sync', operation), {
        'ok': true,
      });
      expect(sends, 2);
      expect(refreshes, 1);
      api.close();
    },
  );

  test(
    'sin red conserva sesion y reanuda renovacion al recuperar conexion',
    () async {
      final store = MemorySessions();
      await store.save(cached());
      var offline = true;
      final api = ApiClient(
        session: await store.restore(),
        client: MockClient((req) async {
          if (offline) throw http.ClientException('offline');
          if (req.url.path == '/session/refresh') return renewed();
          return http.Response('[]', 200);
        }),
      )..sessions = store;
      await expectLater(
        api.request('GET', '/api/clientes'),
        throwsA(isA<http.ClientException>()),
      );
      expect((await store.restore())!.refreshToken, 'device-secret');
      expect(api.session!.token, 'old-access');
      offline = false;
      expect(await api.request('GET', '/api/clientes'), []);
      expect((await store.restore())!.token, 'new-access');
      api.close();
    },
  );

  test(
    'logout sin red queda en almacenamiento seguro hasta confirmar revocacion',
    () async {
      final store = MemorySessions();
      await store.save(cached());
      await store.queueLogout((await store.restore())!);
      await store.clear();
      final offline = ApiClient(
        client: MockClient((_) async => throw http.ClientException('offline')),
      )..sessions = store;
      await offline.flushLogouts();
      expect(await store.restore(), isNull);
      expect(await store.pendingLogouts(), hasLength(1));
      offline.close();
      final online = ApiClient(
        client: MockClient((req) async {
          expect(req.url.toString(), 'https://backend.test/session/logout');
          expect(jsonDecode(req.body), {'refreshToken': 'device-secret'});
          return http.Response('', 204);
        }),
      )..sessions = store;
      await online.flushLogouts();
      expect(await store.pendingLogouts(), isEmpty);
      online.close();
    },
  );

  test(
    'sesion revocada no entra en un bucle ni descarta datos locales',
    () async {
      final store = MemorySessions();
      await store.save(cached());
      var calls = 0;
      final api = ApiClient(
        session: await store.restore(),
        client: MockClient((_) async {
          calls++;
          return http.Response('{"message":"Sesion revocada"}', 401);
        }),
      )..sessions = store;
      await expectLater(
        api.request('GET', '/api/clientes'),
        throwsA(isA<ApiFailure>().having((e) => e.status, 'status', 401)),
      );
      expect(calls, 1);
      expect(await store.restore(), isNotNull);
      api.close();
    },
  );
}
