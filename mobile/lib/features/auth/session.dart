import 'package:flutter/foundation.dart';

import '../../core/api.dart';
import '../../core/push.dart';

class SessionUser {
  SessionUser(this.id, this.email, this.displayName);
  final String id;
  final String email;
  final String displayName;

  factory SessionUser.fromJson(Map<String, dynamic> j) =>
      SessionUser(j['id'] as String, j['email'] as String, j['displayName'] as String);
}

/// Estado de sesión de la app (equivale a `features/auth/session.tsx`).
class Session extends ChangeNotifier {
  Session() {
    ApiClient.instance.onSessionExpired = () {
      user = null;
      notifyListeners();
    };
  }

  SessionUser? user;
  bool loading = true;

  /// Mensaje si no se pudo comprobar la sesión por falta de conexión.
  String? offlineNotice;

  Future<void> init() async {
    await ApiClient.instance.load();
    await Push.instance.init();
    try {
      final json = await ApiClient.instance.restoreSession();
      if (json != null) {
        user = SessionUser.fromJson(json);
        Push.instance.register();
      }
    } on ApiError catch (e) {
      offlineNotice = e.message;
    }
    loading = false;
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    final json = await ApiClient.instance.login(email.trim(), password);
    user = SessionUser.fromJson(json);
    offlineNotice = null;
    notifyListeners();
    Push.instance.register();
  }

  Future<void> logout() async {
    await Push.instance.unregister();
    await ApiClient.instance.logout();
    user = null;
    notifyListeners();
  }
}
