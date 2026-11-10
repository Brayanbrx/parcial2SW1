import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../editor/board_page.dart';

/// Pizarras y miembros de un proyecto.
class ProjectPage extends StatefulWidget {
  const ProjectPage({super.key, required this.projectId, required this.title});
  final String projectId;
  final String title;

  @override
  State<ProjectPage> createState() => _ProjectPageState();
}

class _ProjectPageState extends State<ProjectPage> {
  Map<String, dynamic>? _project;
  List<Map<String, dynamic>> _members = [];
  String? _error;

  bool get _canWrite => _project?['role'] == 'OWNER' || _project?['role'] == 'EDITOR';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final project = await ApiClient.instance.get('/projects/${widget.projectId}');
      final members = await ApiClient.instance.get('/projects/${widget.projectId}/members');
      if (!mounted) return;
      setState(() {
        _project = project as Map<String, dynamic>;
        _members = (members as List).cast<Map<String, dynamic>>();
        _error = null;
      });
    } catch (e) {
      if (mounted && _project == null) setState(() => _error = errorText(e));
    }
  }

  Future<void> _createBoard() async {
    final name = await askText(context, title: 'Nueva pizarra', action: 'Crear');
    if (name == null) return;
    try {
      await ApiClient.instance.post('/projects/${widget.projectId}/boards', {'displayName': name});
      await _load();
    } catch (e) {
      if (mounted) showMessage(context, errorText(e), error: true);
    }
  }

  Future<void> _renameBoard(Map<String, dynamic> b) async {
    final name = await askText(context, title: 'Renombrar pizarra', initial: b['displayName'] as String);
    if (name == null) return;
    try {
      await ApiClient.instance.patch('/boards/${b['id']}', {'displayName': name});
      await _load();
    } catch (e) {
      if (mounted) showMessage(context, errorText(e), error: true);
    }
  }

  Future<void> _deleteBoard(Map<String, dynamic> b) async {
    final ok = await confirm(
      context,
      title: 'Eliminar pizarra',
      message: 'Se eliminará "${b['displayName']}" con todas sus tablas. No se puede deshacer.',
    );
    if (!ok) return;
    try {
      await ApiClient.instance.delete('/boards/${b['id']}');
      await _load();
    } catch (e) {
      if (mounted) showMessage(context, errorText(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.title),
          bottom: const TabBar(tabs: [Tab(text: 'Pizarras'), Tab(text: 'Miembros')]),
        ),
        floatingActionButton: _canWrite
            ? FloatingActionButton.extended(
                onPressed: _createBoard,
                icon: const Icon(Icons.add),
                label: const Text('Pizarra'),
              )
            : null,
        body: _error != null
            ? ErrorView(message: _error!, onRetry: _load)
            : _project == null
                ? const Center(child: CircularProgressIndicator())
                : TabBarView(children: [_boards(), _membersTab()]),
      ),
    );
  }

  Widget _boards() {
    final boards = (_project!['boards'] as List).cast<Map<String, dynamic>>();
    return RefreshIndicator(
      onRefresh: _load,
      child: boards.isEmpty
          ? ListView(
              children: const [SizedBox(height: 120), Center(child: Text('Este proyecto no tiene pizarras.'))],
            )
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              itemCount: boards.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                final b = boards[i];
                return Card(
                  child: ListTile(
                    leading: const Icon(Icons.table_chart_outlined, color: Paleta.acento),
                    title: Text(
                      b['displayName'] as String,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    trailing: _canWrite
                        ? PopupMenuButton<String>(
                            onSelected: (v) => v == 'rename' ? _renameBoard(b) : _deleteBoard(b),
                            itemBuilder: (_) => const [
                              PopupMenuItem(value: 'rename', child: Text('Renombrar')),
                              PopupMenuItem(value: 'delete', child: Text('Eliminar')),
                            ],
                          )
                        : const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => BoardPage(boardId: b['id'] as String)),
                    ),
                  ),
                );
              },
            ),
    );
  }

  Widget _membersTab() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _members.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, i) {
          final m = _members[i];
          final name = m['displayName'] as String;
          return Card(
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: Paleta.acentoSuave,
                foregroundColor: Paleta.acento,
                child: Text(name.isEmpty ? '?' : name[0].toUpperCase()),
              ),
              title: Text(name),
              subtitle: Text(m['email'] as String),
              trailing: Text(roleLabel(m['role'] as String)),
            ),
          );
        },
      ),
    );
  }
}
