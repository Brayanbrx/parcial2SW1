import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/brand.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../auth/session.dart';
import '../editor/board_page.dart';
import '../shell/top_bar.dart';

/// Pizarras, invitaciones y colaboradores de un proyecto (`ProjectPage` de la web).
class ProjectPage extends StatefulWidget {
  const ProjectPage({super.key, required this.projectId, required this.session, this.title});
  final String projectId;
  final Session session;

  /// Nombre ya conocido, para no mostrar el título vacío mientras carga.
  final String? title;

  @override
  State<ProjectPage> createState() => _ProjectPageState();
}

class _ProjectPageState extends State<ProjectPage> {
  final _boardName = TextEditingController();
  Map<String, dynamic>? _project;
  List<Map<String, dynamic>> _members = [];
  String? _error;
  String? _formError;
  String? _inviteCode;
  bool _busy = false;

  String get _role => _project?['role'] as String? ?? 'VIEWER';
  bool get _canWrite => _role == 'OWNER' || _role == 'EDITOR';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _boardName.dispose();
    super.dispose();
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

  Future<void> _createBoard() async {
    final name = _boardName.text.trim();
    if (name.isEmpty) return setState(() => _formError = 'Escribe el nombre de la pizarra.');
    await _guard(() async {
      await ApiClient.instance.post('/projects/${widget.projectId}/boards', {'displayName': name});
      _boardName.clear();
      await _load();
    });
  }

  Future<void> _invite(String role) => _guard(() async {
        final r = await ApiClient.instance.post('/projects/${widget.projectId}/invites', {'role': role});
        if (mounted && r is Map) setState(() => _inviteCode = r['code'] as String?);
      });

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
      message: 'Se eliminará "${b['displayName']}" con todas sus clases. No se puede deshacer.',
    );
    if (!ok) return;
    try {
      await ApiClient.instance.delete('/boards/${b['id']}');
      await _load();
    } catch (e) {
      if (mounted) showMessage(context, errorText(e), error: true);
    }
  }

  void _openBoard(Map<String, dynamic> b) => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => BoardPage(
            boardId: b['id'] as String,
            session: widget.session,
            projectName: _project?['displayName'] as String? ?? widget.title,
            title: b['displayName'] as String?,
          ),
        ),
      );

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
    final project = _project;
    final boards = ((project?['boards'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 40),
      children: [
        PageHeader(
          title: project?['displayName'] as String? ?? widget.title ?? 'Proyecto',
          subtitle: project == null ? null : '${plural(boards.length, 'pizarra', 'pizarras')} en este proyecto',
          onBack: () => Navigator.of(context).maybePop(),
          badge: project == null ? null : RoleBadge(_role),
        ),
        if (project == null)
          const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
        else ...[
          if (_canWrite) ...[
            const SizedBox(height: 28),
            const FieldLabel('Nueva pizarra'),
            TextField(
              controller: _boardName,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(hintText: 'Diagrama de clases'),
              onSubmitted: (_) => _createBoard(),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _busy ? null : _createBoard,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(44)),
              icon: const Icon(Icons.add, size: 20),
              label: const Text('Nueva pizarra'),
            ),
          ],
          if (_role == 'OWNER') ...[
            const SizedBox(height: 22),
            const FieldLabel('Invitar al proyecto'),
            Row(
              children: [
                for (final (role, label) in [('EDITOR', 'Editor'), ('VIEWER', 'Lector')]) ...[
                  if (role == 'VIEWER') const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : () => _invite(role),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(44),
                        backgroundColor: c.superficie2,
                      ),
                      icon: const Icon(Icons.person_add_alt_outlined, size: 18),
                      label: Text(label),
                    ),
                  ),
                ],
              ],
            ),
            if (_inviteCode != null) ...[
              const SizedBox(height: 10),
              _InviteCode(code: _inviteCode!),
            ],
          ],
          if (_formError != null) ...[const SizedBox(height: 12), Notice(_formError!)],
          const SizedBox(height: 22),
          _Collaborators(members: _members),
          const SizedBox(height: 22),
          Divider(color: c.borde),
          if (boards.isEmpty)
            EmptyState(
              icon: Icons.desktop_windows_outlined,
              title: 'Este proyecto no tiene pizarras',
              message: _canWrite ? 'Crea la primera para empezar el diagrama.' : 'Aún nadie creó una pizarra.',
            )
          else
            for (final b in boards)
              ResourceRow(
                icon: Icons.desktop_windows_outlined,
                title: b['displayName'] as String,
                onTap: () => _openBoard(b),
                footer: [
                  Text('Abrir el editor', style: TextStyle(fontSize: 14, color: c.textoSuave)),
                  if (_canWrite) ...[
                    IconButton(
                      tooltip: 'Renombrar pizarra',
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.edit_outlined, size: 19),
                      onPressed: () => _renameBoard(b),
                    ),
                    IconButton(
                      tooltip: 'Eliminar pizarra',
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.delete_outline, size: 20),
                      onPressed: () => _deleteBoard(b),
                    ),
                  ],
                ],
              ),
        ],
      ],
    );
  }
}

/// `.codigo`: el código recién generado, para copiar y compartir.
class _InviteCode extends StatelessWidget {
  const _InviteCode({required this.code});
  final String code;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    return Container(
      padding: const EdgeInsets.only(left: 14),
      decoration: BoxDecoration(
        color: c.superficie,
        border: Border.all(color: c.borde),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        children: [
          Expanded(
            child: SelectableText(
              code,
              style: TextStyle(fontFamily: 'monospace', fontSize: 15, color: c.texto, letterSpacing: 0.5),
            ),
          ),
          IconButton(
            tooltip: 'Copiar código',
            icon: const Icon(Icons.copy_outlined, size: 19),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: code));
              showMessage(context, 'Código copiado. Compártelo con quien quieras invitar.');
            },
          ),
        ],
      ),
    );
  }
}

/// Tarjeta plegable «Colaboradores» de la web.
class _Collaborators extends StatelessWidget {
  const _Collaborators({required this.members});
  final List<Map<String, dynamic>> members;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    return Container(
      decoration: BoxDecoration(
        color: c.superficie,
        border: Border.all(color: c.borde),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
          title: const Text('Colaboradores', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
          subtitle: Text(plural(members.length, 'miembro', 'miembros'),
              style: TextStyle(fontSize: 14, color: c.textoSuave)),
          children: [
            for (final m in members)
              ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                leading: Avatar(name: m['displayName'] as String? ?? '?', seed: m['id'] as String?),
                title: Text(m['displayName'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(m['email'] as String? ?? '', style: TextStyle(color: c.textoSuave)),
                trailing: RoleBadge(m['role'] as String? ?? 'VIEWER'),
              ),
          ],
        ),
      ),
    );
  }
}
