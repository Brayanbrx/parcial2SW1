import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

/// Servidor por defecto. Se puede cambiar desde la pantalla de acceso o al
/// compilar con `--dart-define=SERVER_URL=https://mi-servidor`.
const String kDefaultServer = String.fromEnvironment(
  'SERVER_URL',
  defaultValue: 'https://uml.asiscarretera.online',
);

class ApiError implements Exception {
  ApiError(this.status, this.code, this.message, [this.details]);
  final int status;
  final String code;
  final String message;
  final dynamic details;

  bool get isNetwork => status == 0;

  @override
  String toString() => message;
}

/// Cliente HTTP de la plataforma (espejo de `frontend/src/lib/api.ts`).
///
/// El token de acceso dura poco; el de refresco viaja en la cookie
/// `uml_refresh`. En el navegador la gestiona el propio navegador; aquí se
/// guarda en almacenamiento seguro y se reenvía a mano en `/auth/refresh`.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const _storage = FlutterSecureStorage();
  static const _kServer = 'server_url';
  static const _kRefresh = 'refresh_cookie';

  String _server = kDefaultServer;
  String? _accessToken;
  String? _refreshCookie;
  Future<bool>? _refreshing;

  /// Se avisa cuando la sesión caduca de forma definitiva.
  void Function()? onSessionExpired;

  String get server => _server;
  bool get hasRefreshCookie => _refreshCookie != null;

  Future<void> load() async {
    try {
      _server = await _storage.read(key: _kServer) ?? kDefaultServer;
      _refreshCookie = await _storage.read(key: _kRefresh);
    } catch (_) {
      // El almacenamiento puede fallar tras restaurar una copia: se parte de cero.
    }
  }

  Future<void> setServer(String url) async {
    var value = url.trim();
    while (value.endsWith('/')) {
      value = value.substring(0, value.length - 1);
    }
    if (value.isNotEmpty && !value.startsWith('http')) value = 'https://$value';
    _server = value.isEmpty ? kDefaultServer : value;
    await _storage.write(key: _kServer, value: _server);
  }

  Future<void> _saveRefresh(String? cookie) async {
    _refreshCookie = cookie;
    if (cookie == null) {
      await _storage.delete(key: _kRefresh);
    } else {
      await _storage.write(key: _kRefresh, value: cookie);
    }
  }

  void clearTokens() {
    _accessToken = null;
  }

  Future<void> forgetSession() async {
    _accessToken = null;
    await _saveRefresh(null);
  }

  Uri _uri(String path) => Uri.parse('$_server/api$path');

  Future<http.Response> _send(
    String method,
    String path, {
    Object? body,
    bool withRefreshCookie = false,
  }) async {
    final headers = <String, String>{'accept': 'application/json'};
    if (_accessToken != null) headers['authorization'] = 'Bearer $_accessToken';
    if (withRefreshCookie && _refreshCookie != null) {
      headers['cookie'] = 'uml_refresh=$_refreshCookie';
    }
    String? payload;
    if (body != null) {
      headers['content-type'] = 'application/json';
      payload = jsonEncode(body);
    }
    final uri = _uri(path);
    try {
      final future = switch (method) {
        'GET' => http.get(uri, headers: headers),
        'POST' => http.post(uri, headers: headers, body: payload),
        'PUT' => http.put(uri, headers: headers, body: payload),
        'PATCH' => http.patch(uri, headers: headers, body: payload),
        'DELETE' => http.delete(uri, headers: headers, body: payload),
        _ => throw ArgumentError(method),
      };
      return await future.timeout(const Duration(seconds: 25));
    } on TimeoutException {
      throw ApiError(0, 'network', 'El servidor tardó demasiado en responder.');
    } on SocketException {
      throw ApiError(0, 'network', 'No se pudo contactar al servidor. Revisa tu conexión.');
    } on http.ClientException {
      throw ApiError(0, 'network', 'No se pudo contactar al servidor. Revisa tu conexión.');
    } on HandshakeException {
      throw ApiError(0, 'network', 'No se pudo establecer una conexión segura con el servidor.');
    }
  }

  dynamic _decode(http.Response r) {
    if (r.statusCode == 204 || r.body.isEmpty) return null;
    try {
      return jsonDecode(utf8.decode(r.bodyBytes));
    } catch (_) {
      throw ApiError(502, 'invalid_response', 'El servidor devolvió una respuesta inválida.');
    }
  }

  ApiError _toError(http.Response r) {
    dynamic data;
    try {
      data = jsonDecode(utf8.decode(r.bodyBytes));
    } catch (_) {}
    final err = data is Map ? data['error'] : null;
    if (err is Map) {
      return ApiError(
        r.statusCode,
        '${err['code'] ?? 'error'}',
        '${err['message'] ?? 'Error ${r.statusCode}'}',
        err['details'],
      );
    }
    return ApiError(r.statusCode, 'error', 'Error ${r.statusCode} del servidor.');
  }

  void _captureCookie(http.Response r) {
    final setCookie = r.headers['set-cookie'];
    if (setCookie == null) return;
    final m = RegExp(r'uml_refresh=([^;,\s]*)').firstMatch(setCookie);
    if (m == null) return;
    final value = m.group(1)!;
    _saveRefresh(value.isEmpty ? null : value);
  }

  /// Petición autenticada. Ante un 401 renueva el acceso una vez y repite.
  Future<dynamic> request(String method, String path, {Object? body}) async {
    var r = await _send(method, path, body: body);
    if (r.statusCode == 401 && _refreshCookie != null) {
      final ok = await _refresh();
      if (ok) r = await _send(method, path, body: body);
    }
    if (r.statusCode == 401) {
      await forgetSession();
      onSessionExpired?.call();
    }
    if (r.statusCode >= 400) throw _toError(r);
    return _decode(r);
  }

  Future<dynamic> get(String path) => request('GET', path);
  Future<dynamic> post(String path, [Object? body]) => request('POST', path, body: body);
  Future<dynamic> put(String path, [Object? body]) => request('PUT', path, body: body);
  Future<dynamic> patch(String path, [Object? body]) => request('PATCH', path, body: body);
  Future<dynamic> delete(String path) => request('DELETE', path);

  Future<bool> _refresh() => _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<bool> _doRefresh() async {
    final r = await _send('POST', '/auth/refresh', withRefreshCookie: true);
    if (r.statusCode == 200) {
      final data = _decode(r) as Map<String, dynamic>;
      _accessToken = data['accessToken'] as String;
      _captureCookie(r);
      return true;
    }
    if (r.statusCode == 401) await forgetSession();
    return false;
  }

  /// Recupera la sesión guardada. `null` si no hay o ya no es válida.
  /// Un fallo de red se relanza: no equivale a una sesión rechazada.
  Future<Map<String, dynamic>?> restoreSession() async {
    if (_refreshCookie == null) return null;
    final r = await _send('POST', '/auth/refresh', withRefreshCookie: true);
    if (r.statusCode == 200) {
      final data = _decode(r) as Map<String, dynamic>;
      _accessToken = data['accessToken'] as String;
      _captureCookie(r);
      return data['user'] as Map<String, dynamic>;
    }
    if (r.statusCode == 401) {
      await forgetSession();
      return null;
    }
    throw _toError(r);
  }

  Future<Map<String, dynamic>> login(String email, String password) async {
    final r = await _send('POST', '/auth/login', body: {'email': email, 'password': password});
    if (r.statusCode != 200) throw _toError(r);
    final data = _decode(r) as Map<String, dynamic>;
    _accessToken = data['accessToken'] as String;
    _captureCookie(r);
    return data['user'] as Map<String, dynamic>;
  }

  Future<void> logout() async {
    try {
      await _send('POST', '/auth/logout', withRefreshCookie: true);
    } catch (_) {}
    await forgetSession();
  }
}
