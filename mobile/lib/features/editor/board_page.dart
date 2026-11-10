import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../auth/session.dart';
import 'dialogs.dart';
import 'model.dart';

/// Pizarra: tablas, relaciones y actividad. Equivale a `BoardPage.tsx` del
/// editor web, reducida a lo esencial para uso de emergencia.
class BoardPage extends StatefulWidget {
  const BoardPage({super.key, required this.boardId, this.session});
  final String boardId;

  /// Sesión actual, para firmar los comandos con el usuario.
  final Session? session;

  @override
  State<BoardPage> createState() => _BoardPageState();
}

class _BoardPageState extends State<BoardPage> {
  String _title = 'Pizarra';
  String _role = 'VIEWER';
  SemanticModel _model = SemanticModel.empty();
  List<Map<String, dynamic>> _activity = [];
  Map<String, String> _names = {};
  String? _error;
  bool _loaded = false;
  bool _saving = false;
  Timer? _timer;
  String? _actorId;

  bool get _canWrite => _role == 'OWNER' || _role == 'EDITOR';

  @override
  void initState() {
    super.initState();
    _resolveActor().then((_) => _load());
    _timer = Timer.periodic(const Duration(seconds: 10), (_) {
      if (!_saving) _load(silent: true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _resolveActor() async {
    _actorId = widget.session?.user?.id;
    if (_actorId != null) return;
    try {
      final me = await ApiClient.instance.get('/auth/me') as Map<String, dynamic>;
      _actorId = me['id'] as String;
    } catch (_) {}
  }

  Future<void> _load({bool silent = false}) async {
    try {
      final board = await ApiClient.instance.get('/boards/${widget.boardId}') as Map<String, dynamic>;
      final projectId = board['projectId'] as String;
      if (_names.isEmpty) {
        final members = await ApiClient.instance.get('/projects/$projectId/members') as List;
        _names = {for (final m in members) (m as Map)['id'] as String: m['displayName'] as String};
      }
      final audit = await ApiClient.instance.get('/boards/${widget.boardId}/audit?limit=60') as List;
      if (!mounted || _saving) return;
      final snapshot = board['snapshot'];
      setState(() {
        _title = board['displayName'] as String;
        _role = board['role'] as String;
        _model = SemanticModel.fromJson(snapshot is Map ? snapshot['canonicalJson'] : null);
        _activity = audit.cast<Map<String, dynamic>>();
        _error = null;
        _loaded = true;
      });
    } catch (e) {
      if (!mounted) return;
      if (!_loaded) setState(() => _error = errorText(e));
      if (_loaded && !silent) showMessage(context, errorText(e), error: true);
    }
  }

  /// Aplica un lote en el servidor. Devuelve `true` si se aceptó.
  Future<bool> _apply(BatchBuilder Function(BatchBuilder b) build) async {
    final actor = _actorId;
    if (actor == null) {
      showMessage(context, 'No se pudo identificar tu usuario. Vuelve a iniciar sesión.', error: true);
      return false;
    }
    setState(() => _saving = true);
    try {
      final result = await ApiClient.instance.post(
        '/boards/${widget.boardId}/commands',
        build(BatchBuilder(actor)).build(),
      ) as Map<String, dynamic>;
      if (!mounted) return true;
      setState(() => _model = SemanticModel.fromJson(result['model']));
      return true;
    } on ApiError catch (e) {
      if (mounted) showMessage(context, _explain(e), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _saving = false);
      _load(silent: true);
    }
  }

  String _explain(ApiError e) {
    if (e.code == 'batch_rejected' && e.details is List && (e.details as List).isNotEmpty) {
      final first = (e.details as List).first;
      if (first is Map && first['message'] is String) return first['message'] as String;
    }
    return e.message;
  }

  // --- Tablas ---------------------------------------------------------------

  Future<void> _createClass() async {
    final name = await askText(context, title: 'Nueva tabla', action: 'Crear');
    if (name == null) return;
    final n = _model.classes.length;
    await _apply((b) => b.add('CREATE_CLASS', {
          'classId': newId(),
          'displayName': name,
          'position': {'x': 40.0 + (n % 3) * 280, 'y': 40.0 + (n ~/ 3) * 260},
        }));
  }

  Future<void> _renameClass(UmlClass c) async {
    final name = await askText(context, title: 'Renombrar tabla', initial: c.name);
    if (name == null || name == c.name) return;
    await _apply((b) => b.add('RENAME_CLASS', {'classId': c.id, 'displayName': name}));
  }

  Future<void> _deleteClass(UmlClass c) async {
    final ok = await confirm(
      context,
      title: 'Eliminar tabla',
      message: 'Se eliminará "${c.name}" con sus campos y relaciones.',
    );
    if (ok) await _apply((b) => b.add('DELETE_CLASS', {'classId': c.id}));
  }

  Future<void> _addAttribute(UmlClass c) async {
    final r = await editAttribute(context, title: 'Nuevo campo en ${c.name}');
    if (r == null) return;
    await _apply((b) => b.add('ADD_ATTRIBUTE', {
          'classId': c.id,
          'attributeId': newId(),
          'displayName': r.name,
          'type': r.type,
          'primaryKey': r.primaryKey,
          'nullable': r.nullable,
          'unique': r.unique,
        }));
  }

  Future<void> _editAttribute(UmlClass c, UmlAttribute a) async {
    final r = await editAttribute(context, title: 'Editar campo', current: a);
    if (r == null) return;
    await _apply((b) => b.add('UPDATE_ATTRIBUTE', {
          'classId': c.id,
          'attributeId': a.id,
          'displayName': r.name,
          'type': r.type,
          'primaryKey': r.primaryKey,
          'nullable': r.nullable,
          'unique': r.unique,
        }));
  }

  Future<void> _deleteAttribute(UmlClass c, UmlAttribute a) async {
    final ok = await confirm(
      context,
      title: 'Eliminar campo',
      message: '¿Eliminar "${a.name}" de ${c.name}?',
    );
    if (ok) {
      await _apply((b) => b.add('DELETE_ATTRIBUTE', {'classId': c.id, 'attributeId': a.id}));
    }
  }

  // --- Relaciones -----------------------------------------------------------

  Future<void> _createRelationship() async {
    if (_model.classes.length < 2) {
      showMessage(context, 'Necesitas al menos dos tablas para crear una relación.');
      return;
    }
    final r = await editRelationship(context, _model.classes);
    if (r == null) return;
    await _apply((b) => b.add('CREATE_RELATIONSHIP', {
          'relationshipId': newId(),
          'kind': r.kind,
          'sourceClassId': r.sourceId,
          'targetClassId': r.targetId,
          'sourceMultiplicity': r.sourceMultiplicity,
          'targetMultiplicity': r.targetMultiplicity,
        }));
  }

  Future<void> _deleteRelationship(UmlRelationship r) async {
    final ok = await confirm(
      context,
      title: 'Eliminar relación',
      message: '${_model.className(r.sourceId)} → ${_model.className(r.targetId)}',
    );
    if (ok) await _apply((b) => b.add('DELETE_RELATIONSHIP', {'relationshipId': r.id}));
  }

  Future<void> _changeMultiplicity(UmlRelationship r) async {
    final m = await editMultiplicities(context, r);
    if (m == null) return;
    await _apply((b) => b.add('CHANGE_MULTIPLICITY', {
          'relationshipId': r.id,
          'sourceMultiplicity': m.$1,
          'targetMultiplicity': m.$2,
        }));
  }

  // --- UI -------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Builder(
        builder: (context) {
          final tabs = DefaultTabController.of(context);
          return Scaffold(
            appBar: AppBar(
              title: Text(_title),
              bottom: TabBar(
                tabs: [
                  Tab(text: 'Tablas (${_model.classes.length})'),
                  Tab(text: 'Relaciones (${_model.relationships.length})'),
                  const Tab(text: 'Actividad'),
                ],
              ),
              actions: [
                if (_saving)
                  const Padding(
                    padding: EdgeInsets.only(right: 16),
                    child: Center(
                      child: SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  ),
              ],
            ),
            floatingActionButton: _canWrite && _loaded
                ? ListenableBuilder(
                    listenable: tabs,
                    builder: (context, _) {
                      if (tabs.index == 2) return const SizedBox.shrink();
                      final isTables = tabs.index == 0;
                      return FloatingActionButton.extended(
                        onPressed: _saving ? null : (isTables ? _createClass : _createRelationship),
                        icon: const Icon(Icons.add),
                        label: Text(isTables ? 'Tabla' : 'Relación'),
                      );
                    },
                  )
                : null,
            body: _error != null
                ? ErrorView(message: _error!, onRetry: _load)
                : !_loaded
                    ? const Center(child: CircularProgressIndicator())
                    : Column(
                        children: [
                          if (!_canWrite)
                            Container(
                              width: double.infinity,
                              color: Paleta.superficie2,
                              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 16),
                              child: const Text(
                                'Tienes permiso de solo lectura en este proyecto.',
                                style: TextStyle(color: Paleta.textoSuave, fontSize: 12),
                              ),
                            ),
                          Expanded(
                            child: TabBarView(children: [_classesTab(), _relationsTab(), _activityTab()]),
                          ),
                        ],
                      ),
          );
        },
      ),
    );
  }

  Widget _classesTab() {
    if (_model.classes.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          children: const [SizedBox(height: 120), Center(child: Text('Esta pizarra aún no tiene tablas.'))],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        itemCount: _model.classes.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, i) {
          final c = _model.classes[i];
          return Card(
            clipBehavior: Clip.antiAlias,
            child: ExpansionTile(
              key: PageStorageKey(c.id),
              shape: const Border(),
              collapsedShape: const Border(),
              leading: const Icon(Icons.table_chart_outlined, color: Paleta.acento),
              title: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(
                '${c.attributes.length} campos',
                style: const TextStyle(color: Paleta.textoSuave),
              ),
              children: [
                const Divider(height: 1),
                for (final a in c.attributes)
                  ListTile(
                    dense: true,
                    title: Text(a.name),
                    subtitle: Text(
                      [
                        a.type,
                        if (a.primaryKey) 'PK',
                        if (!a.nullable) 'NOT NULL',
                        if (a.unique) 'ÚNICO',
                      ].join(' · '),
                      style: const TextStyle(color: Paleta.textoSuave),
                    ),
                    leading: Icon(
                      a.primaryKey ? Icons.key : Icons.circle_outlined,
                      size: 18,
                      color: a.primaryKey ? Paleta.acento : Paleta.textoSuave,
                    ),
                    onTap: _canWrite && !_saving ? () => _editAttribute(c, a) : null,
                    trailing: _canWrite
                        ? IconButton(
                            icon: const Icon(Icons.delete_outline, size: 20),
                            onPressed: _saving ? null : () => _deleteAttribute(c, a),
                          )
                        : null,
                  ),
                if (c.attributes.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('Sin campos.', style: TextStyle(color: Paleta.textoSuave)),
                  ),
                if (_canWrite)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                    child: Wrap(
                      spacing: 4,
                      children: [
                        TextButton.icon(
                          onPressed: _saving ? null : () => _addAttribute(c),
                          icon: const Icon(Icons.add, size: 18),
                          label: const Text('Campo'),
                        ),
                        TextButton.icon(
                          onPressed: _saving ? null : () => _renameClass(c),
                          icon: const Icon(Icons.edit_outlined, size: 18),
                          label: const Text('Renombrar'),
                        ),
                        TextButton.icon(
                          onPressed: _saving ? null : () => _deleteClass(c),
                          style: TextButton.styleFrom(foregroundColor: Paleta.error),
                          icon: const Icon(Icons.delete_outline, size: 18),
                          label: const Text('Eliminar'),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _relationsTab() {
    final rels = _model.relationships;
    return RefreshIndicator(
      onRefresh: _load,
      child: rels.isEmpty
          ? ListView(
              children: const [SizedBox(height: 120), Center(child: Text('No hay relaciones.'))],
            )
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              itemCount: rels.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                final r = rels[i];
                return Card(
                  child: ListTile(
                    title: Text(
                      '${_model.className(r.sourceId)} → ${_model.className(r.targetId)}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      '${relationshipKinds[r.kind] ?? r.kind} · ${r.sourceMultiplicity} a ${r.targetMultiplicity}',
                      style: const TextStyle(color: Paleta.textoSuave),
                    ),
                    onTap: _canWrite && !_saving ? () => _changeMultiplicity(r) : null,
                    trailing: _canWrite
                        ? IconButton(
                            icon: const Icon(Icons.delete_outline),
                            onPressed: _saving ? null : () => _deleteRelationship(r),
                          )
                        : null,
                  ),
                );
              },
            ),
    );
  }

  Widget _activityTab() {
    final items = _activity.where((a) {
      final cmds = ((a['commands'] as List?) ?? []).cast<String>();
      return cmds.any((c) => c != 'MOVE_CLASS');
    }).toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: items.isEmpty
          ? ListView(
              children: const [SizedBox(height: 120), Center(child: Text('Sin actividad reciente.'))],
            )
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                final a = items[i];
                final who = _names[a['actorId']] ?? 'Alguien';
                final cmds = ((a['commands'] as List?) ?? [])
                    .cast<String>()
                    .where((c) => c != 'MOVE_CLASS')
                    .map(commandLabel)
                    .toSet()
                    .toList();
                final when = DateTime.tryParse('${a['createdAt']}')?.toLocal();
                return Card(
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: Paleta.acentoSuave,
                      foregroundColor: Paleta.acento,
                      child: Text(who[0].toUpperCase()),
                    ),
                    title: Text('$who ${cmds.take(2).join(' y ')}'
                        '${cmds.length > 2 ? ' y más' : ''}'),
                    subtitle: Text(
                      when == null ? '' : timeAgo(when),
                      style: const TextStyle(color: Paleta.textoSuave),
                    ),
                  ),
                );
              },
            ),
    );
  }
}
