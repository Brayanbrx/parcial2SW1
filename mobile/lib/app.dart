import 'package:flutter/material.dart';

import 'core/appearance.dart';
import 'core/push.dart';
import 'core/theme.dart';
import 'features/auth/login_page.dart';
import 'features/auth/session.dart';
import 'features/editor/board_page.dart';
import 'features/projects/projects_page.dart';

class App extends StatefulWidget {
  const App({super.key});

  @override
  State<App> createState() => _AppState();
}

class _AppState extends State<App> {
  final Session _session = Session();
  final AppearanceController _appearance = AppearanceController.instance;

  /// Aviso tocado con la app cerrada: llega antes de restaurar la sesión.
  String? _pendingBoard;
  bool _wasSignedIn = false;

  @override
  void initState() {
    super.initState();
    openBoardFromNotification = _openBoard;
    _session.addListener(_onSession);
    _appearance.load();
    _session.init();
  }

  @override
  void dispose() {
    _session.removeListener(_onSession);
    super.dispose();
  }

  void _onSession() {
    final signedIn = _session.user != null;
    // La sesión caducó con pantallas abiertas encima: se vuelve al acceso,
    // que es la raíz, en lugar de dejar al usuario en una pizarra sin permiso.
    if (_wasSignedIn && !signedIn) {
      navigatorKey.currentState?.popUntil((route) => route.isFirst);
    }
    _wasSignedIn = signedIn;
    if (!_session.loading) {
      final pending = _pendingBoard;
      _pendingBoard = null;
      if (pending != null && signedIn) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _openBoard(pending));
      }
    }
  }

  void _openBoard(String boardId) {
    if (_session.loading) {
      _pendingBoard = boardId;
      return;
    }
    // Sin sesión no hay a dónde ir: se muestra el acceso y se descarta el aviso.
    if (_session.user == null) return;
    navigatorKey.currentState?.push(
      MaterialPageRoute(builder: (_) => BoardPage(boardId: boardId, session: _session)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _appearance,
      builder: (context, _) => MaterialApp(
        title: 'UMLFORGE AI',
        debugShowCheckedModeBanner: false,
        navigatorKey: navigatorKey,
        scaffoldMessengerKey: messengerKey,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
        themeMode: _appearance.value.mode,
        home: ListenableBuilder(
          listenable: _session,
          builder: (context, _) {
            if (_session.loading) {
              return const Scaffold(body: Center(child: CircularProgressIndicator()));
            }
            if (_session.user == null) return LoginPage(session: _session);
            return ProjectsPage(session: _session);
          },
        ),
      ),
    );
  }
}
