import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/brand.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../auth/session.dart';
import 'class_box.dart';
import 'diagram.dart';
import 'dialogs.dart';
import 'uml_dialogs.dart';
import 'geometry.dart';
import 'model.dart';

/// Pizarra: el diagrama como en la web, y listas para editar con el dedo.
class BoardPage extends StatefulWidget {
  const BoardPage({super.key, required this.boardId, this.session, this.projectName, this.title});
  final String boardId;

  /// Nombre ya conocido, para no mostrar «Pizarra» mientras carga.
  final String? title;

  /// Sesión actual, para firmar los comandos con el usuario.
  final Session? session;

  /// Para la miga «Proyecto › Pizarra» de la barra.
  final String? projectName;

  @override
  State<BoardPage> createState() => _BoardPageState();
}

class _BoardPageState extends State<BoardPage> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 4, vsync: this)..addListener(_onTab);
  final _diagram = DiagramController();

  /// Avisa a la hoja de una clase abierta de que el modelo cambió.
  final _revision = ValueNotifier<int>(0);

  late String _title = widget.title ?? 'Pizarra';
  String _role = 'VIEWER';
  SemanticModel _model = SemanticModel.empty();
  BoardLayout _layout = BoardLayout.empty;

  /// `false` con un servidor sin `GET /boards/:id/state`: el diagrama se
  /// dibuja en rejilla y no se puede mover nada.
  bool _liveLayout = true;
  List<Map<String, dynamic>> _activity = [];
  Map<String, String> _names = {};
  String? _error;
  bool _loaded = false;
  bool _saving = false;
  bool _loading = false;
  bool _foreground = true;
  int _generation = 0;
  String? _selectedId;
  bool _sheetOpen = false;
  String? _actorId;
  Timer? _timer;
  late final AppLifecycleListener _lifecycle;

  bool get _canWrite => _role == 'OWNER' || _role == 'EDITOR';

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(
      onStateChange: (state) {
        final active = state == AppLifecycleState.resumed;
        if (active && !_foreground) _load(silent: true);
        _foreground = active;
      },
    );
    _resolveActor().then((_) => _load());
    // Sin WebSocket: se consulta cada 10 s, solo con la app en primer plano.
    _timer = Timer.periodic(const Duration(seconds: 10), (_) {
      if (_foreground && !_saving) _load(silent: true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _lifecycle.dispose();
    _tabs.dispose();
    _revision.dispose();
    super.dispose();
  }

  void _onTab() {
    if (!_tabs.indexIsChanging) setState(() {});
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
    if (_loading) return;
    _loading = true;
    final generation = _generation;
    try {
      final api = ApiClient.instance;
      final board = await api.get('/boards/${widget.boardId}') as Map<String, dynamic>;
      final projectId = board['projectId'] as String;
      if (_names.isEmpty) {
        final members = await api.get('/projects/$projectId/members') as List;
        _names = {for (final m in members) (m as Map)['id'] as String: m['displayName'] as String};
      }

      BoardState? state;
      if (_liveLayout) {
        try {
          state = BoardState.fromJson(await api.get('/boards/${widget.boardId}/state') as Map<String, dynamic>);
        } on ApiError catch (e) {
          // 404: servidor anterior a esta ruta. Se dibuja en rejilla.
          if (e.status == 404) _liveLayout = false;
          if (e.status != 404 && e.status != 503) rethrow;
        }
      }
      if (state == null) {
        final snapshot = board['snapshot'];
        final model = SemanticModel.fromJson(snapshot is Map ? snapshot['canonicalJson'] : null);
        state = BoardState(model, BoardLayout.grid(model.classes));
      }

      final audit = await api.get('/boards/${widget.boardId}/audit?limit=60') as List;
      // Un cambio propio llegó mientras tanto: esta lectura ya es vieja.
      if (!mounted || _saving || generation != _generation) return;
      setState(() {
        _title = board['displayName'] as String;
        _role = board['role'] as String;
        _model = state!.model;
        _layout = state.layout;
        _activity = audit.cast<Map<String, dynamic>>();
        _error = null;
        _loaded = true;
      });
      _revision.value++;
    } catch (e) {
      if (!mounted) return;
      if (!_loaded) setState(() => _error = errorText(e));
      if (_loaded && !silent) showMessage(context, errorText(e), error: true);
    } finally {
      _loading = false;
    }
  }

  /// Aplica un lote en el servidor. Devuelve `true` si se aceptó.
  Future<bool> _apply(BatchBuilder Function(BatchBuilder b) build) async {
    final actor = _actorId;
    if (actor == null) {
      showMessage(context, 'No se pudo identificar tu usuario. Vuelve a iniciar sesión.', error: true);
      return false;
    }
    _generation++;
    setState(() => _saving = true);
    try {
      final result =
          await ApiClient.instance.post('/boards/${widget.boardId}/commands', build(BatchBuilder(actor)).build())
              as Map<String, dynamic>;
      if (!mounted) return true;
      setState(() {
        if (result['model'] != null) {
          _model = SemanticModel.fromJson(result['model']);
        }
        _layout = result['layout'] != null && _liveLayout
            ? BoardLayout.fromJson(result['layout'])
            : (_liveLayout ? _layout : BoardLayout.grid(_model.classes));
      });
      _revision.value++;
      return true;
    } on ApiError catch (e) {
      if (mounted) _report(_explain(e));
      return false;
    } finally {
      if (mounted) setState(() => _saving = false);
      unawaited(_load(silent: true));
    }
  }

  /// Con la hoja de una clase abierta, un snackbar quedaría debajo de ella:
  /// el error se muestra en un diálogo que sí se ve.
  void _report(String message) {
    if (!_sheetOpen) return showMessage(context, message, error: true);
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('No se pudo guardar'),
        content: Text(message),
        actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('Entendido'))],
      ),
    );
  }

  String _explain(ApiError e) {
    if (e.code == 'batch_rejected' && e.details is List && (e.details as List).isNotEmpty) {
      final first = (e.details as List).first;
      if (first is Map && first['message'] is String) {
        return first['message'] as String;
      }
    }
    return e.message;
  }

  // --- Clases -----------------------------------------------------------------

  Future<void> _createClass() async {
    final name = await askText(
      context,
      title: 'Nueva clase',
      label: 'Nombre de la clase',
      hint: 'Cliente',
      action: 'Crear',
    );
    if (name == null) return;
    // Donde está mirando el usuario, como `onCreateClass` de la web.
    final center = _tabs.index == 0 ? _diagram.viewportCenter : null;
    final n = _model.classes.length;
    final position = center != null
        ? center - const Offset(kNodeWidth / 2, kHeaderHeight)
        : Offset(40.0 + (n % 3) * 300, 40.0 + (n ~/ 3) * 260);
    final id = newId();
    final ok = await _apply(
      (b) => b.add('CREATE_CLASS', {
        'classId': id,
        'displayName': name,
        'position': {'x': position.dx.roundToDouble(), 'y': position.dy.roundToDouble()},
      }),
    );
    if (ok && mounted) setState(() => _selectedId = id);
  }

  Future<void> _moveClass(String classId, Offset position) async {
    // Optimista: la caja se queda donde la soltaste mientras se guarda.
    setState(() => _layout = _layout.withPosition(classId, position));
    await _apply(
      (b) => b.add('MOVE_CLASS', {
        'classId': classId,
        'position': {'x': position.dx, 'y': position.dy},
      }),
    );
  }

  Future<void> _renameClass(UmlClass c) async {
    final name = await askText(context, title: 'Renombrar clase', label: 'Nombre de la clase', initial: c.name);
    if (name == null || name == c.name) return;
    await _apply((b) => b.add('RENAME_CLASS', {'classId': c.id, 'displayName': name}));
  }

  Future<void> _classifierProperties(UmlClass c) async {
    final properties = await editClassifier(context, c);
    if (properties != null) {
      await _apply((b) => b.add('UPDATE_CLASS', {'classId': c.id, ...properties}));
    }
  }

  Future<void> _operation(UmlClass c, [UmlOperation? current]) async {
    final operation = await editOperation(context, c, current);
    if (operation == null) return;
    await _apply((b) {
      if (operation['isAbstract'] == true && c.kind != 'INTERFACE' && !c.isAbstract) {
        b.add('UPDATE_CLASS', {'classId': c.id, 'isAbstract': true});
      }
      if (current == null) {
        return b.add('ADD_OPERATION', {'classId': c.id, 'operation': operation});
      }
      final changes = Map<String, dynamic>.from(operation)..remove('id');
      return b.add('UPDATE_OPERATION', {'classId': c.id, 'operationId': current.id, 'changes': changes});
    });
  }

  Future<void> _deleteOperation(UmlClass c, UmlOperation operation) async {
    if (await confirm(context, title: 'Eliminar operación', message: '¿Eliminar ${operation.name} de ${c.name}?')) {
      await _apply((b) => b.add('DELETE_OPERATION', {'classId': c.id, 'operationId': operation.id}));
    }
  }

  Future<bool> _deleteClass(UmlClass c) async {
    final ok = await confirm(
      context,
      title: 'Eliminar clase',
      message: 'Se eliminará "${c.name}" con sus atributos y relaciones.',
    );
    if (!ok) return false;
    return _apply((b) => b.add('DELETE_CLASS', {'classId': c.id}));
  }

  Future<void> _addAttribute(UmlClass c) async {
    final r = await editAttribute(
      context,
      title: 'Nuevo atributo en ${c.name}',
      defaultVisibility: c.kind == 'INTERFACE' ? 'public' : 'private',
    );
    if (r == null) return;
    await _apply(
      (b) => b.add('ADD_ATTRIBUTE', {
        'classId': c.id,
        'attributeId': newId(),
        'displayName': r.name,
        'type': r.type,
        'primaryKey': r.primaryKey,
        'nullable': r.nullable,
        'unique': r.unique,
        ...r.properties,
      }),
    );
  }

  Future<void> _editAttribute(UmlClass c, UmlAttribute a) async {
    final r = await editAttribute(context, title: 'Editar atributo', current: a);
    if (r == null) return;
    await _apply(
      (b) => b.add('UPDATE_ATTRIBUTE', {
        'classId': c.id,
        'attributeId': a.id,
        'displayName': r.name,
        'type': r.type,
        'primaryKey': r.primaryKey,
        'nullable': r.nullable,
        'unique': r.unique,
        ...r.properties,
      }),
    );
  }

  Future<void> _deleteAttribute(UmlClass c, UmlAttribute a) async {
    final ok = await confirm(context, title: 'Eliminar atributo', message: '¿Eliminar "${a.name}" de ${c.name}?');
    if (ok) {
      await _apply((b) => b.add('DELETE_ATTRIBUTE', {'classId': c.id, 'attributeId': a.id}));
    }
  }

  // --- Relaciones -------------------------------------------------------------

  Future<void> _createRelationship() async {
    if (_model.classes.length < 2) {
      showMessage(context, 'Necesitas al menos dos clases para crear una relación.');
      return;
    }
    final r = await editRelationship(context, _model.classes);
    if (r == null) return;
    await _apply(
      (b) => b.add('CREATE_RELATIONSHIP', {
        'relationshipId': newId(),
        'kind': r.kind,
        'sourceClassId': r.sourceId,
        'targetClassId': r.targetId,
        'sourceMultiplicity': r.sourceMultiplicity,
        'targetMultiplicity': r.targetMultiplicity,
      }),
    );
  }

  Future<void> _deleteRelationship(UmlRelationship r) async {
    final ok = await confirm(
      context,
      title: 'Eliminar relación',
      message: '${_model.className(r.sourceId)} → ${_model.className(r.targetId)}',
    );
    if (ok) {
      await _apply((b) => b.add('DELETE_RELATIONSHIP', {'relationshipId': r.id}));
    }
  }

  Future<void> _changeMultiplicity(UmlRelationship r) async {
    final fields = await editRelationshipProperties(context, r);
    if (fields == null) return;
    await _apply((b) {
      b.add('UPDATE_RELATIONSHIP', {
        'relationshipId': r.id,
        'name': fields['name'],
        if (r.isStructural) ...{
          'sourceRoleName': fields['sourceRoleName'] == '' ? null : fields['sourceRoleName'],
          'targetRoleName': fields['targetRoleName'] == '' ? null : fields['targetRoleName'],
          'sourceNavigability': fields['sourceNavigability'],
          'targetNavigability': fields['targetNavigability'],
        },
      });
      if (r.isStructural) {
        b.add('CHANGE_MULTIPLICITY', {
          'relationshipId': r.id,
          'sourceMultiplicity': fields['sourceMultiplicity'],
          'targetMultiplicity': fields['targetMultiplicity'],
        });
      }
      return b;
    });
  }

  // --- UI ---------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            Flexible(
              child: Text(
                widget.projectName ?? 'Proyecto',
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w400, color: c.textoSuave),
              ),
            ),
            Icon(Icons.chevron_right, size: 18, color: c.textoTenue),
            Flexible(flex: 2, child: Text(_title, overflow: TextOverflow.ellipsis)),
          ],
        ),
        actions: [
          if (_saving)
            const Padding(
              padding: EdgeInsets.only(right: 16),
              child: Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))),
            )
          else if (_loaded)
            // Las acciones de la AppBar se estiran a todo el alto: sin Center
            // la insignia sería una columna.
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Center(child: RoleBadge(_role)),
            ),
        ],
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabs: [
            const Tab(text: 'Diagrama'),
            Tab(text: 'Clases (${_model.classes.length})'),
            Tab(text: 'Relaciones (${_model.relationships.length})'),
            const Tab(text: 'Actividad'),
          ],
        ),
      ),
      floatingActionButton: _fab(),
      bottomNavigationBar: _loaded && _error == null ? _statusBar() : null,
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _load)
          : !_loaded
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                if (!_canWrite) _banner('Tienes permiso de solo lectura en este proyecto.'),
                if (!_liveLayout) _banner('Este servidor no envía la disposición del diagrama: se muestra en rejilla.'),
                Expanded(
                  child: TabBarView(
                    controller: _tabs,
                    // El lienzo usa el arrastre: deslizar no cambia de pestaña.
                    physics: const NeverScrollableScrollPhysics(),
                    children: [_diagramTab(), _classesTab(), _relationsTab(), _activityTab()],
                  ),
                ),
              ],
            ),
    );
  }

  Widget? _fab() {
    if (!_canWrite || !_loaded || _tabs.index == 3) return null;
    final relations = _tabs.index == 2;
    return FloatingActionButton.extended(
      onPressed: _saving ? null : (relations ? _createRelationship : _createClass),
      icon: const Icon(Icons.add),
      label: Text(relations ? 'Nueva relación' : 'Nueva clase'),
    );
  }

  Widget _banner(String text) {
    final c = context.uml;
    return Container(
      width: double.infinity,
      color: c.superficie2,
      padding: const EdgeInsets.symmetric(vertical: 7, horizontal: 16),
      child: Text(text, style: TextStyle(color: c.textoSuave, fontSize: 13)),
    );
  }

  Widget _diagramTab() {
    final c = context.uml;
    return Column(
      children: [
        Expanded(
          child: _model.classes.isEmpty
              ? ColoredBox(
                  color: c.diagramaFondo,
                  child: const Center(
                    child: EmptyState(
                      icon: Icons.schema_outlined,
                      title: 'La pizarra está vacía',
                      message: 'Crea la primera clase con «Nueva clase».',
                    ),
                  ),
                )
              : DiagramView(
                  controller: _diagram,
                  model: _model,
                  layout: _layout,
                  selectedId: _selectedId,
                  canWrite: _canWrite && _liveLayout && !_saving,
                  onTapClass: _showClass,
                  onMoveClass: _moveClass,
                  onTapBackground: () => setState(() => _selectedId = null),
                ),
        ),
      ],
    );
  }

  /// `.barra-estado` del pie de la web. Va en `bottomNavigationBar`: así el
  /// botón flotante queda encima y el SafeArea la aparta de la barra de gestos.
  Widget _statusBar() {
    final c = context.uml;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: c.superficie,
        border: Border(top: BorderSide(color: c.borde)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 34,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Text(
                  plural(_model.classes.length, 'clase', 'clases'),
                  style: TextStyle(fontSize: 13, color: c.textoSuave),
                ),
                const SizedBox(width: 14),
                Text(
                  plural(_model.relationships.length, 'relación', 'relaciones'),
                  style: TextStyle(fontSize: 13, color: c.textoSuave),
                ),
                const SizedBox(width: 12),
                if (_canWrite && _liveLayout && _tabs.index == 0)
                  Expanded(
                    child: Text(
                      'Mantén pulsada una clase para moverla',
                      textAlign: TextAlign.end,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: c.textoTenue),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _classesTab() {
    if (_model.classes.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          children: const [
            EmptyState(
              icon: Icons.table_chart_outlined,
              title: 'Esta pizarra aún no tiene clases',
              message: 'Crea la primera con «Nueva clase».',
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        itemCount: _model.classes.length,
        separatorBuilder: (_, _) => const SizedBox(height: 14),
        itemBuilder: (context, i) {
          final cls = _model.classes[i];
          return GestureDetector(
            onTap: () => _showClass(cls),
            child: ClassBox(umlClass: cls, selected: _selectedId == cls.id),
          );
        },
      ),
    );
  }

  /// Hoja inferior de una clase: el inspector de la web, a la medida del dedo.
  Future<void> _showClass(UmlClass initial) async {
    setState(() => _selectedId = initial.id);
    _sheetOpen = true;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.55,
        minChildSize: 0.3,
        maxChildSize: 0.92,
        builder: (context, scroll) => ValueListenableBuilder<int>(
          valueListenable: _revision,
          builder: (context, _, _) {
            final cls = _model.findClass(initial.id);
            if (cls == null) {
              return const Center(child: Text('Esta clase ya no existe.'));
            }
            return _ClassSheet(
              umlClass: cls,
              canWrite: _canWrite,
              scroll: scroll,
              onAdd: () => _addAttribute(cls),
              onEdit: (a) => _editAttribute(cls, a),
              onDelete: (a) => _deleteAttribute(cls, a),
              onRename: () => _renameClass(cls),
              onProperties: () => _classifierProperties(cls),
              onAddOperation: () => _operation(cls),
              onEditOperation: (o) => _operation(cls, o),
              onDeleteOperation: (o) => _deleteOperation(cls, o),
              onDeleteClass: () async {
                if (await _deleteClass(cls) && sheetContext.mounted) {
                  Navigator.pop(sheetContext);
                }
              },
            );
          },
        ),
      ),
    );
    _sheetOpen = false;
    if (mounted) setState(() => _selectedId = null);
  }

  Widget _relationsTab() {
    final c = context.uml;
    final rels = _model.relationships;
    return RefreshIndicator(
      onRefresh: _load,
      child: rels.isEmpty
          ? ListView(
              children: const [
                EmptyState(
                  icon: Icons.linear_scale,
                  title: 'No hay relaciones',
                  message: 'Une dos clases con «Nueva relación».',
                ),
              ],
            )
          : ListView.builder(
              padding: const EdgeInsets.only(bottom: 96),
              itemCount: rels.length,
              itemBuilder: (context, i) {
                final r = rels[i];
                final kind = relationshipKinds[r.kind] ?? r.kind;
                return DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border(bottom: BorderSide(color: c.borde)),
                  ),
                  child: ListTile(
                    contentPadding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
                    leading: SizedBox(
                      width: 40,
                      child: CustomPaint(size: const Size(40, 18), painter: RelationGlyph(r.kind, c)),
                    ),
                    title: Text(
                      '${_model.className(r.sourceId)} → ${_model.className(r.targetId)}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      !r.isStructural ? kind : '$kind · ${r.sourceMultiplicity} a ${r.targetMultiplicity}',
                      style: TextStyle(color: c.textoSuave),
                    ),
                    onTap: _canWrite && !_saving ? () => _changeMultiplicity(r) : null,
                    trailing: _canWrite
                        ? IconButton(
                            tooltip: 'Eliminar relación',
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
    final c = context.uml;
    final items = _activity.where((a) {
      final cmds = ((a['commands'] as List?) ?? []).cast<String>();
      return cmds.any((cmd) => cmd != 'MOVE_CLASS');
    }).toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: items.isEmpty
          ? ListView(
              children: const [
                EmptyState(
                  icon: Icons.history,
                  title: 'Sin actividad reciente',
                  message: 'Aquí verás quién cambió qué.',
                ),
              ],
            )
          : ListView.builder(
              itemCount: items.length,
              itemBuilder: (context, i) {
                final a = items[i];
                final who = _names[a['actorId']] ?? 'Alguien';
                final cmds = ((a['commands'] as List?) ?? [])
                    .cast<String>()
                    .where((cmd) => cmd != 'MOVE_CLASS')
                    .map(commandLabel)
                    .toSet()
                    .toList();
                final when = DateTime.tryParse('${a['createdAt']}')?.toLocal();
                return DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border(bottom: BorderSide(color: c.borde)),
                  ),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    leading: Avatar(name: who, seed: a['actorId'] as String?),
                    title: Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: who,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          TextSpan(text: ' ${cmds.take(2).join(' y ')}${cmds.length > 2 ? ' y más' : ''}'),
                        ],
                      ),
                    ),
                    subtitle: Text(when == null ? '' : timeAgo(when), style: TextStyle(color: c.textoSuave)),
                  ),
                );
              },
            ),
    );
  }
}

/// Contenido de la hoja de una clase.
class _ClassSheet extends StatelessWidget {
  const _ClassSheet({
    required this.umlClass,
    required this.canWrite,
    required this.scroll,
    required this.onAdd,
    required this.onEdit,
    required this.onDelete,
    required this.onRename,
    required this.onProperties,
    required this.onAddOperation,
    required this.onEditOperation,
    required this.onDeleteOperation,
    required this.onDeleteClass,
  });
  final UmlClass umlClass;
  final bool canWrite;
  final ScrollController scroll;
  final VoidCallback onAdd;
  final void Function(UmlAttribute) onEdit;
  final void Function(UmlAttribute) onDelete;
  final VoidCallback onRename;
  final VoidCallback onProperties, onAddOperation;
  final void Function(UmlOperation) onEditOperation, onDeleteOperation;
  final VoidCallback onDeleteClass;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    return ListView(
      controller: scroll,
      padding: EdgeInsets.fromLTRB(20, 0, 12, 24 + MediaQuery.viewPaddingOf(context).bottom),
      children: [
        Text(
          classifierKinds[umlClass.kind] ?? 'Clase',
          style: TextStyle(fontSize: 11, letterSpacing: 1.2, fontWeight: FontWeight.w600, color: c.textoTenue),
        ),
        const SizedBox(height: 4),
        Text(umlClass.name, style: editorial(context, size: 26)),
        if (umlClass.technicalDiffers)
          Text(
            'Tabla ${umlClass.databaseName}',
            style: TextStyle(fontFamily: 'monospace', fontSize: 12, color: c.textoSuave),
          ),
        const SizedBox(height: 14),
        if (umlClass.kind == 'ENUMERATION') Text('Literales: ${umlClass.literals.join(', ')}'),
        for (final operation in umlClass.operations)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(operation.notation),
            onTap: canWrite ? () => onEditOperation(operation) : null,
            trailing: canWrite
                ? IconButton(
                    tooltip: 'Eliminar operación ${operation.name}',
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () => onDeleteOperation(operation),
                  )
                : null,
          ),
        if (canWrite)
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton(onPressed: onProperties, child: const Text('Propiedades UML')),
              OutlinedButton(onPressed: onAddOperation, child: const Text('+ Operación')),
            ],
          ),
        Text(
          'ATRIBUTOS',
          style: TextStyle(fontSize: 11, letterSpacing: 1.2, fontWeight: FontWeight.w600, color: c.textoTenue),
        ),
        const SizedBox(height: 4),
        if (umlClass.attributes.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Text(
              'sin atributos',
              style: TextStyle(fontStyle: FontStyle.italic, color: c.claseTenue),
            ),
          ),
        for (final a in umlClass.attributes)
          DecoratedBox(
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: c.borde)),
            ),
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: Icon(
                a.primaryKey ? Icons.key : Icons.remove,
                size: 18,
                color: a.primaryKey ? c.avisoTexto : c.claseTenue,
              ),
              title: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(text: a.name, style: const TextStyle(fontSize: 15)),
                    TextSpan(
                      text: ': ${a.type}',
                      style: TextStyle(fontSize: 15, color: c.claseTenue),
                    ),
                  ],
                ),
              ),
              subtitle: Text(
                [
                  if (a.primaryKey) 'Clave primaria',
                  if (!a.nullable && !a.primaryKey) 'Obligatorio',
                  if (a.unique && !a.primaryKey) 'Único',
                  if (a.nullable && !a.unique && !a.primaryKey) 'Opcional',
                ].join(' · '),
                style: TextStyle(color: c.textoSuave),
              ),
              onTap: canWrite ? () => onEdit(a) : null,
              trailing: canWrite
                  ? IconButton(
                      tooltip: 'Eliminar ${a.name}',
                      icon: const Icon(Icons.delete_outline, size: 20),
                      onPressed: () => onDelete(a),
                    )
                  : null,
            ),
          ),
        if (canWrite) ...[
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(onPressed: onAdd, icon: const Icon(Icons.add, size: 18), label: const Text('Atributo')),
              OutlinedButton.icon(
                onPressed: onRename,
                icon: const Icon(Icons.edit_outlined, size: 18),
                label: const Text('Renombrar'),
              ),
              OutlinedButton.icon(
                onPressed: onDeleteClass,
                style: OutlinedButton.styleFrom(
                  foregroundColor: c.errorTexto,
                  side: BorderSide(color: c.error),
                ),
                icon: const Icon(Icons.delete_outline, size: 18),
                label: const Text('Eliminar'),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

/// Icono de cada tipo de relación, como los del toolbox de la web: una línea
/// con su marcador UML.
class RelationGlyph extends CustomPainter {
  RelationGlyph(this.kind, this.c);
  final String kind;
  final UmlColors c;

  @override
  void paint(Canvas canvas, Size size) {
    final y = size.height / 2;
    final stroke = Paint()
      ..color = c.diagramaLinea
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4
      ..strokeJoin = StrokeJoin.round;
    if (kind == 'DEPENDENCY' || kind == 'REALIZATION') {
      for (var x = 2.0; x < size.width - 2; x += 8) {
        canvas.drawLine(Offset(x, y), Offset((x + 5).clamp(2, size.width - 2).toDouble(), y), stroke);
      }
    } else {
      canvas.drawLine(Offset(2, y), Offset(size.width - 2, y), stroke);
    }
    Path? marker;
    var filled = false;
    switch (kind) {
      case 'GENERALIZATION' || 'REALIZATION':
        final x = size.width - 2;
        marker = Path()..addPolygon([Offset(x, y), Offset(x - 11, y - 6), Offset(x - 11, y + 6)], true);
      case 'DEPENDENCY':
        final x = size.width - 2;
        canvas.drawPath(
          Path()
            ..moveTo(x - 10, y - 5)
            ..lineTo(x, y)
            ..lineTo(x - 10, y + 5),
          stroke,
        );
      case 'COMPOSITION' || 'AGGREGATION':
        marker = Path()..addPolygon([Offset(2, y), Offset(9, y - 5), Offset(16, y), Offset(9, y + 5)], true);
        filled = kind == 'COMPOSITION';
    }
    if (marker != null) {
      canvas.drawPath(marker, Paint()..color = filled ? c.diagramaLinea : c.superficie);
      canvas.drawPath(marker, stroke);
    }
  }

  @override
  bool shouldRepaint(RelationGlyph old) => old.kind != kind || old.c != c;
}
