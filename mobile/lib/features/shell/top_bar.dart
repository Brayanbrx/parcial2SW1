import 'package:flutter/material.dart';

import '../../core/appearance.dart';
import '../../core/brand.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../auth/session.dart';

/// `.app-bar` de la web: isotipo a la izquierda; tema y usuario a la derecha.
class TopBar extends StatelessWidget implements PreferredSizeWidget {
  const TopBar({super.key, required this.session});
  final Session session;

  @override
  Size get preferredSize => const Size.fromHeight(60);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      toolbarHeight: 60,
      automaticallyImplyLeading: false,
      titleSpacing: 16,
      title: Tooltip(
        message: 'UMLFORGE AI, ir a mis proyectos',
        child: InkWell(
          borderRadius: BorderRadius.circular(4),
          onTap: () => Navigator.of(context).popUntil((r) => r.isFirst),
          child: const Isotipo(size: 32),
        ),
      ),
      actions: [
        const AppearanceButton(),
        const SizedBox(width: 4),
        _UserMenu(session: session),
        const SizedBox(width: 8),
      ],
    );
  }
}

class _UserMenu extends StatelessWidget {
  const _UserMenu({required this.session});
  final Session session;

  @override
  Widget build(BuildContext context) {
    final user = session.user;
    if (user == null) return const SizedBox.shrink();
    final c = context.uml;
    return PopupMenuButton<String>(
      tooltip: 'Cuenta de ${user.displayName}',
      position: PopupMenuPosition.under,
      onSelected: (v) async {
        if (v != 'logout') return;
        final ok = await confirm(
          context,
          title: 'Cerrar sesión',
          message: 'Dejarás de recibir notificaciones en este teléfono.',
          action: 'Salir',
        );
        if (ok) {
          if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
          await session.logout();
        }
      },
      itemBuilder: (_) => [
        PopupMenuItem(
          enabled: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(user.displayName, style: TextStyle(fontWeight: FontWeight.w600, color: c.texto)),
              Text(user.email, style: TextStyle(fontSize: 13, color: c.textoSuave)),
              Text('Sesión iniciada', style: TextStyle(fontSize: 12, color: c.textoTenue)),
            ],
          ),
        ),
        const PopupMenuDivider(),
        const PopupMenuItem(
          value: 'logout',
          child: Row(children: [Icon(Icons.logout, size: 18), SizedBox(width: 10), Text('Cerrar sesión')]),
        ),
      ],
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Avatar(name: user.displayName, seed: user.id),
            Icon(Icons.expand_more, size: 18, color: c.textoSuave),
          ],
        ),
      ),
    );
  }
}
