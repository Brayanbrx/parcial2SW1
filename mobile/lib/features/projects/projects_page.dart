import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../auth/session.dart';
import 'project_page.dart';

class ProjectsPage extends StatefulWidget {
  const ProjectsPage({super.key, required this.session});
  final Session session;

  @override
  State<ProjectsPage> createState() => _ProjectsPageState();
}

class _ProjectsPageState extends State<ProjectsPage> {
  List<Map<String, dynamic>>? _projects;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
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

  Future<void> _create() async {
    final name = await askText(context, title: 'Nuevo proyecto', action: 'Crear');
    if (name == null) return;
    try {
      await ApiClient.instance.post('/projects', {'displayName': name});
      await _load();
    } catch (e) {
      if (mounted) showMessage(context, errorText(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.session.user!;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mis proyectos'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.account_circle_outlined),
            onSelected: (v) async {
              if (v == 'logout') {
                final ok = await confirm(
                  context,
                  title: 'Cerrar sesión',
                  message: 'Dejarás de recibir notificaciones en este teléfono.',
                  action: 'Salir',
                );
                if (ok) await widget.session.logout();
              }
            },
            itemBuilder: (_) => [
              PopupMenuItem(
                enabled: false,
                child: Text('${user.displayName}\n${user.email}'),
              ),
              const PopupMenuItem(value: 'logout', child: Text('Cerrar sesión')),
            ],
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _create,
        icon: const Icon(Icons.add),
        label: const Text('Proyecto'),
      ),
      body: _body(),
    );
  }

  Widget _body() {
    if (_error != null) return ErrorView(message: _error!, onRetry: _load);
    final projects = _projects;
    if (projects == null) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: _load,
      child: projects.isEmpty
          ? ListView(
              children: const [
                SizedBox(height: 120),
                Center(child: Text('Aún no tienes proyectos.')),
              ],
            )
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              itemCount: projects.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                final p = projects[i];
                return Card(
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    title: Text(
                      p['displayName'] as String,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      '${p['boardCount']} pizarras · ${p['memberCount']} miembros · ${roleLabel(p['role'] as String)}',
                      style: const TextStyle(color: Paleta.textoSuave),
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () async {
                      await Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => ProjectPage(
                            projectId: p['id'] as String,
                            title: p['displayName'] as String,
                          ),
                        ),
                      );
                      _load();
                    },
                  ),
                );
              },
            ),
    );
  }
}
