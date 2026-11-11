import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../auth/session.dart';
import '../shell/top_bar.dart';
import 'project_page.dart';

/// «Mis proyectos», con la estructura de `ProjectsPage.tsx`.
class ProjectsPage extends StatefulWidget {
  const ProjectsPage({super.key, required this.session});
  final Session session;

  @override
  State<ProjectsPage> createState() => _ProjectsPageState();
}

class _ProjectsPageState extends State<ProjectsPage> {
  final _newName = TextEditingController();
  final _code = TextEditingController();
  List<Map<String, dynamic>>? _projects;
  String? _error;
  String? _formError;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _newName.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await ApiClient.instance.get('/projects') as List;
      if (!mounted) return;
      setState(() {
        _projects = data.cast<Map<String, dynamic>>();
        _error = null;
      });
    } catch (e) {
      if (mounted && _projects == null) setState(() => _error = errorText(e));
    }
  }

  Future<void> _guard(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _formError = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => _formError = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _create() async {
    final name = _newName.text.trim();
    if (name.isEmpty) return setState(() => _formError = 'Escribe el nombre del proyecto.');
    await _guard(() async {
      await ApiClient.instance.post('/projects', {'displayName': name});
      _newName.clear();
      await _load();
    });
  }

  Future<void> _join() async {
    final code = _code.text.trim();
    if (code.isEmpty) return setState(() => _formError = 'Escribe el código de invitación.');
    await _guard(() async {
      final r = await ApiClient.instance.post('/invites/${Uri.encodeComponent(code)}/accept');
      _code.clear();
      await _load();
      if (r is Map && r['projectId'] is String && mounted) {
        _open(r['projectId'] as String, null);
      }
    });
  }

  Future<void> _delete(Map<String, dynamic> p) async {
    final ok = await confirm(
      context,
      title: 'Eliminar proyecto',
      message: 'Se eliminará "${p['displayName']}" con todas sus pizarras. No se puede deshacer.',
    );
    if (!ok) return;
    try {
      await ApiClient.instance.delete('/projects/${p['id']}');
      await _load();
    } catch (e) {
      if (mounted) showMessage(context, errorText(e), error: true);
    }
  }

  Future<void> _open(String id, String? title) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ProjectPage(projectId: id, title: title, session: widget.session),
      ),
    );
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: TopBar(session: widget.session),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _load)
          : RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    final c = context.uml;
    final projects = _projects;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 28, 20, 40),
      children: [
        const PageHeader(title: 'Mis proyectos', subtitle: 'Tus diagramas y proyectos compartidos.'),
        const SizedBox(height: 28),
        const FieldLabel('Nuevo proyecto'),
        TextField(
          controller: _newName,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(hintText: 'Sistema de ventas'),
          onSubmitted: (_) => _create(),
        ),
        const SizedBox(height: 8),
        FilledButton.icon(
          onPressed: _busy ? null : _create,
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(44)),
          icon: const Icon(Icons.add, size: 20),
          label: const Text('Crear proyecto'),
        ),
        const SizedBox(height: 22),
        const FieldLabel('Unirme con un código'),
        TextField(
          controller: _code,
          decoration: const InputDecoration(hintText: 'Código de invitación'),
          onSubmitted: (_) => _join(),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _busy ? null : _join,
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(44),
            backgroundColor: c.superficie2,
          ),
          icon: const Icon(Icons.vpn_key_outlined, size: 18),
          label: const Text('Unirme'),
        ),
        if (_formError != null) ...[const SizedBox(height: 12), Notice(_formError!)],
        const SizedBox(height: 24),
        Divider(color: c.borde),
        if (projects == null)
          const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
        else if (projects.isEmpty)
          const EmptyState(
            icon: Icons.folder_outlined,
            title: 'Aún no tienes proyectos',
            message: 'Crea un proyecto o únete con un código de invitación.',
          )
        else
          for (final p in projects)
            ResourceRow(
              icon: Icons.folder_outlined,
              title: p['displayName'] as String,
              onTap: () => _open(p['id'] as String, p['displayName'] as String),
              trailing: p['role'] == 'OWNER'
                  ? IconButton(
                      tooltip: 'Eliminar proyecto',
                      icon: const Icon(Icons.delete_outline, size: 20),
                      onPressed: () => _delete(p),
                    )
                  : null,
              footer: [
                MetaItem(Icons.desktop_windows_outlined,
                    plural((p['boardCount'] as num?)?.toInt() ?? 0, 'pizarra', 'pizarras')),
                MetaItem(Icons.group_outlined,
                    plural((p['memberCount'] as num?)?.toInt() ?? 0, 'miembro', 'miembros')),
                RoleBadge(p['role'] as String),
              ],
            ),
      ],
    );
  }
}
