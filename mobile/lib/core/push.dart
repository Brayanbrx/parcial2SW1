import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'api.dart';

/// Navegador global: permite abrir una pizarra al tocar una notificación.
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<ScaffoldMessengerState> messengerKey = GlobalKey<ScaffoldMessengerState>();

/// Función que abre la pizarra de una notificación (la define `app.dart`).
void Function(String boardId)? openBoardFromNotification;

/// Notificaciones push (Firebase Cloud Messaging).
///
/// Con la app cerrada o en segundo plano las muestra el sistema. Con la app
/// abierta se muestra un aviso dentro de la pantalla. Si la app se compiló sin
/// `google-services.json`, [init] falla en silencio y el resto funciona igual,
/// solo sin avisos.
class Push {
  Push._();
  static final Push instance = Push._();

  bool _ready = false;
  String? _token;
  StreamSubscription<String>? _refreshSub;

  bool get available => _ready;

  Future<void> init() async {
    if (_ready) return;
    try {
      await Firebase.initializeApp();
    } catch (e) {
      debugPrint('Push desactivado (sin configuración de Firebase): $e');
      return;
    }
    try {
      final messaging = FirebaseMessaging.instance;
      FirebaseMessaging.onMessage.listen(_showForeground);
      FirebaseMessaging.onMessageOpenedApp.listen(_open);
      final initial = await messaging.getInitialMessage();
      if (initial != null) {
        // Espera a que el árbol de widgets exista antes de navegar.
        WidgetsBinding.instance.addPostFrameCallback((_) => _open(initial));
      }
      _ready = true;
    } catch (e) {
      debugPrint('No se pudo preparar las notificaciones: $e');
    }
  }

  void _open(RemoteMessage m) {
    final id = m.data['boardId'];
    if (id is String && id.isNotEmpty) openBoardFromNotification?.call(id);
  }

  void _showForeground(RemoteMessage m) {
    final n = m.notification;
    final boardId = m.data['boardId'];
    if (n == null) return;
    messengerKey.currentState
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 6),
          behavior: SnackBarBehavior.floating,
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (n.title != null)
                Text(n.title!, style: const TextStyle(fontWeight: FontWeight.w600)),
              if (n.body != null) Text(n.body!),
            ],
          ),
          action: boardId is String && boardId.isNotEmpty
              ? SnackBarAction(label: 'Ver', onPressed: () => openBoardFromNotification?.call(boardId))
              : null,
        ),
      );
  }

  /// Pide permiso y registra el dispositivo en el servidor. Llamar tras iniciar sesión.
  Future<void> register() async {
    if (!_ready) return;
    try {
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();
      // ignore: deprecated_member_use
      final token = await messaging.getToken();
      if (token == null) return;
      _token = token;
      await ApiClient.instance.put('/devices', {'token': token, 'platform': 'android'});
      // ignore: deprecated_member_use
      _refreshSub ??= messaging.onTokenRefresh.listen((t) async {
        _token = t;
        try {
          await ApiClient.instance.put('/devices', {'token': t, 'platform': 'android'});
        } catch (_) {}
      });
    } catch (e) {
      debugPrint('No se pudo registrar el dispositivo: $e');
    }
  }

  /// Quita el dispositivo del servidor. Llamar antes de cerrar sesión.
  Future<void> unregister() async {
    final token = _token;
    if (!_ready || token == null) return;
    try {
      await ApiClient.instance.post('/devices/unregister', {'token': token});
    } catch (_) {}
    _token = null;
  }
}
