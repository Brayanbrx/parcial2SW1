import 'package:flutter/material.dart';

import 'features/auth/login_page.dart';
import 'features/auth/session.dart';
import 'features/editor/board_page.dart';
import 'features/projects/projects_page.dart';
import 'core/push.dart';
import 'core/theme.dart';

class App extends StatefulWidget {
  const App({super.key});

  @override
  State<App> createState() => _AppState();
}

class _AppState extends State<App> {
  final Session _session = Session();

  @override
  void initState() {
    super.initState();
    openBoardFromNotification = _openBoard;
    _session.init();
  }

  void _openBoard(String boardId) {
    // Sin sesión no hay a dónde ir: se muestra el acceso y se descarta el aviso.
    if (_session.user == null) return;
    navigatorKey.currentState?.push(
      MaterialPageRoute(builder: (_) => BoardPage(boardId: boardId, session: _session)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'UML Forge',
      debugShowCheckedModeBanner: false,
      navigatorKey: navigatorKey,
      scaffoldMessengerKey: messengerKey,
      theme: buildTheme(),
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
    );
  }
}
