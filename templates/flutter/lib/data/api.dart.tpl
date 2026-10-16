import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../domain/schema.dart';

String connectionErrorMessage(Object error, String url) {
  if (error is ApiFailure || error is FormatException || error is StateError) {
    return error is FormatException ? error.message : error.toString();
  }
  final uri = Uri.tryParse(url.trim());
  final host = uri?.host ?? '';
  final local = ['127.0.0.1', 'localhost', '::1'].contains(host);
  final emulator = host == '10.0.2.2';
  final destination = uri != null && host.isNotEmpty
      ? '${uri.scheme}://$host:${uri.port}'
      : 'el servidor';
  final advice = local
      ? 'Conecta el cable USB a la PC y manten activo el conector USB. Comprueba que el backend este encendido.'
      : emulator
      ? '10.0.2.2 solo sirve en el emulador. En un telefono usa USB con 127.0.0.1 o la direccion de la PC en la misma red Wi-Fi.'
      : 'Comprueba que el servidor este encendido y accesible desde la red del telefono.';
  return 'No se pudo conectar con $destination. $advice Tus datos se conservan. Vuelve a intentar cuando se restablezca la conexion.';
}

class ApiFailure implements Exception {
  final int status;
  final String message;
  ApiFailure(this.status, this.message);
  @override
  String toString() => message;
}

class Session {
  final String url, username, token;
  final int expiresAt;
  final Map<String, dynamic>? contract;
  final String? refreshToken;
  final bool isLocal;
  Session(
    this.url,
    this.username,
    this.token,
    this.expiresAt, {
    this.contract,
    this.refreshToken,
    this.isLocal = false,
  });
  Map<String, dynamic> toJson() => {
    'url': url,
    'username': username,
    'token': token,
    'expiresAt': expiresAt,
    'contract': contract,
    'refreshToken': refreshToken,
    'isLocal': isLocal,
  };
  factory Session.fromJson(Map<String, dynamic> j) => Session(
    j['url'],
    j['username'],
    j['token'],
    j['expiresAt'],
    contract: j['contract'],
    refreshToken: j['refreshToken'],
    isLocal: j['isLocal'] == true,
  );
}

class SessionStore {
  final FlutterSecureStorage storage;
  Future<void> _writes = Future<void>.value();
  Future<void> _write(Future<void> Function() action) {
    final next = _writes.then((_) => action());
    _writes = next.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return next;
  }

  SessionStore([FlutterSecureStorage? storage])
    : storage = storage ?? const FlutterSecureStorage();
  Future<Session?> restore() async {
    final s = await storage.read(key: 'session');
    return s == null ? null : Session.fromJson(jsonDecode(s));
  }

  Future<void> save(Session session) => _write(
    () => storage.write(key: 'session', value: jsonEncode(session.toJson())),
  );
  Future<void> clear() => _write(() => storage.delete(key: 'session'));
  Future<List<Map<String, dynamic>>> pendingLogouts() async {
    final value = await storage.read(key: 'pendingLogouts');
    return value == null
        ? []
        : (jsonDecode(value) as List)
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
  }

  Future<void> saveLogouts(List<Map<String, dynamic>> entries) =>
      storage.write(key: 'pendingLogouts', value: jsonEncode(entries));
  Future<void> queueLogout(Session session) async {
    if (session.refreshToken == null) return;
    final entries = await pendingLogouts();
    if (!entries.any(
      (e) =>
          e['url'] == session.url && e['refreshToken'] == session.refreshToken,
    ))
      entries.add({'url': session.url, 'refreshToken': session.refreshToken});
    await saveLogouts(entries);
  }
}

abstract class RemoteApi {
  Future<dynamic> request(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]);
}

class ApiClient implements RemoteApi {
  Session? _session;
  int _sessionEpoch = 0;
  Session? get session => _session;
  set session(Session? value) {
    _session = value;
    _sessionEpoch++;
  }

  SessionStore? sessions;
  Future<Session>? _refreshing;
  int? _refreshEpoch;
  Future<void>? _flushing;
  final http.Client client;
  ApiClient({Session? session, http.Client? client})
    : _session = session,
      client = client ?? http.Client();
  Future<Session> login(String url, String username, String password) async {
    await flushLogouts();
    final uri = Uri.tryParse(url.trim());
    if (uri == null ||
        !['http', 'https'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment)
      throw FormatException('URL HTTP/HTTPS invalida');
    final base = url.trim().replaceAll(RegExp(r'/+$'), '');
    final response = await client
        .post(
          Uri.parse('$base/session/login'),
          headers: {'content-type': 'application/json'},
          body: jsonEncode({'username': username.trim(), 'password': password}),
        )
        .timeout(const Duration(seconds: 20));
    final data = decode(response);
    if (data is! Map ||
        data['username'] is! String ||
        data['accessToken'] is! String ||
        data['expiresAt'] is! int)
      throw FormatException('Respuesta de login incompatible');
    final contractResponse = await client
        .get(
          Uri.parse('$base/mobile-contract'),
          headers: {'authorization': 'Bearer ${data['accessToken']}'},
        )
        .timeout(const Duration(seconds: 20));
    if (contractResponse.bodyBytes.length > 1024 * 1024)
      throw FormatException('Contrato demasiado grande');
    if (contractResponse.statusCode == 404)
      throw FormatException(
        'Este backend no publica el contrato movil. Regenera Android + backend.',
      );
    final schema = AppSchema.fromRemote(decode(contractResponse));
    return Session(
      base,
      data['username'],
      data['accessToken'],
      data['expiresAt'],
      contract: schema.contract,
      refreshToken: data['refreshToken'] as String?,
    );
  }

  Future<void> verifyContract(AppSchema schema) async {
    final current = AppSchema.fromRemote(
      await request('GET', '/mobile-contract'),
    );
    if (current.fingerprint != schema.fingerprint)
      throw ApiFailure(
        409,
        'El contrato del backend cambio. Los pendientes permanecen separados; restaura el backend compatible para sincronizarlos o inicia una nueva sesion para usar el contrato nuevo.',
      );
  }

  @override
  Future<dynamic> request(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    if (session?.isLocal == true) {
      throw ApiFailure(403, 'La cuenta local no tiene acceso al servidor');
    }
    final epoch = _sessionEpoch;
    await flushLogouts();
    _checkSession(epoch);
    var s = session;
    if (s == null)
      throw ApiFailure(401, 'Inicia sesion; tus cambios locales se conservan.');
    if (s.expiresAt <= DateTime.now().millisecondsSinceEpoch ~/ 1000 + 30)
      s = await _refresh(epoch);
    _checkSession(epoch);
    var response = await _send(s, method, path, body);
    _checkSession(epoch);
    if (response.statusCode == 401 && s.refreshToken != null) {
      if (identical(session, s))
        s = await _refresh(epoch);
      else {
        s = session;
      }
      _checkSession(epoch);
      if (s == null) throw ApiFailure(401, 'Sesion cerrada');
      response = await _send(s, method, path, body);
      _checkSession(epoch);
    }
    return decode(response);
  }

  Future<http.Response> _send(
    Session s,
    String method,
    String path,
    Map<String, dynamic>? body,
  ) async {
    final request = http.Request(method, Uri.parse('${s.url}$path'))
      ..headers.addAll({
        'authorization': 'Bearer ${s.token}',
        'content-type': 'application/json',
      });
    if (body != null) request.body = jsonEncode(body);
    return http.Response.fromStream(
      await client.send(request).timeout(const Duration(seconds: 20)),
    ).timeout(const Duration(seconds: 20));
  }

  void _checkSession(int epoch) {
    if (epoch != _sessionEpoch)
      throw ApiFailure(
        401,
        'La sesion cambio; vuelve a intentar desde la cuenta actual.',
      );
  }

  Future<Session> _refresh(int epoch) {
    _checkSession(epoch);
    if (_refreshing != null && _refreshEpoch == epoch) return _refreshing!;
    _refreshEpoch = epoch;
    return _refreshing = _renew(epoch).whenComplete(() {
      if (_refreshEpoch == epoch) {
        _refreshing = null;
        _refreshEpoch = null;
      }
    });
  }

  Future<Session> _renew(int epoch) async {
    final old = session;
    if (old == null || old.refreshToken == null)
      throw ApiFailure(
        401,
        'Esta sesion antigua requiere un nuevo login para activar la renovacion automatica. Tus datos se conservan.',
      );
    final response = await client
        .post(
          Uri.parse('${old.url}/session/refresh'),
          headers: {'content-type': 'application/json'},
          body: jsonEncode({'refreshToken': old.refreshToken}),
        )
        .timeout(const Duration(seconds: 20));
    final value = decode(response);
    if (value is! Map ||
        value['accessToken'] is! String ||
        value['username'] != old.username ||
        value['expiresAt'] is! int ||
        value['refreshToken'] != old.refreshToken)
      throw FormatException('Respuesta de renovacion incompatible');
    final renewed = Session(
      old.url,
      old.username,
      value['accessToken'],
      value['expiresAt'],
      contract: old.contract,
      refreshToken: old.refreshToken,
    );
    _checkSession(epoch);
    await sessions?.save(renewed);
    _checkSession(epoch);
    // A token renewal belongs to the same login; external assignments start a new epoch.
    _session = renewed;
    return renewed;
  }

  Future<void> flushLogouts() =>
      _flushing ??= _flushLogouts().whenComplete(() => _flushing = null);
  Future<void> _flushLogouts() async {
    final store = sessions;
    if (store == null) return;
    try {
      for (final entry in await store.pendingLogouts()) {
        try {
          final response = await client
              .post(
                Uri.parse('${entry['url']}/session/logout'),
                headers: {'content-type': 'application/json'},
                body: jsonEncode({'refreshToken': entry['refreshToken']}),
              )
              .timeout(const Duration(seconds: 5));
          if (response.statusCode != 204) continue;
          final remaining = await store.pendingLogouts();
          remaining.removeWhere(
            (e) =>
                e['url'] == entry['url'] &&
                e['refreshToken'] == entry['refreshToken'],
          );
          await store.saveLogouts(remaining);
        } catch (_) {
          /* Keep pending revocation in secure storage for a later connection. */
        }
      }
    } catch (_) {
      /* A failed cleanup must not discard local sessions or outbox data. */
    }
  }

  dynamic decode(http.Response response) {
    dynamic data;
    try {
      data = response.body.isEmpty ? null : jsonDecode(response.body);
    } catch (_) {
      data = null;
    }
    if (response.statusCode >= 400)
      throw ApiFailure(
        response.statusCode,
        data is Map
            ? (data['message'] ??
                      data['error'] ??
                      'Error HTTP ${response.statusCode}')
                  .toString()
            : 'Error HTTP ${response.statusCode}',
      );
    return data;
  }

  void close() {
    session = null;
    client.close();
  }
}
