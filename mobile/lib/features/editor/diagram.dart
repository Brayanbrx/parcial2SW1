import 'dart:math' as math;
import 'dart:ui' show PointMode;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme.dart';
import 'class_box.dart';
import 'geometry.dart';
import 'model.dart';

/// Permite a la pantalla pedir el centro de la vista (para crear una clase
/// donde está mirando el usuario, como `onCreateClass` de la web).
class DiagramController {
  _DiagramViewState? _state;

  /// Centro visible en coordenadas del diagrama.
  Offset? get viewportCenter => _state?._viewportCenterInFlow();

  void fit() => _state?._fit(animate: true);
}

/// Lienzo de la pizarra: el mismo dibujo que `BoardCanvas.tsx`.
///
/// Se desplaza y amplía con los dedos. Tocar una clase la selecciona; una
/// pulsación larga la levanta para moverla, y al soltarla se envía `MOVE_CLASS`.
class DiagramView extends StatefulWidget {
  const DiagramView({
    super.key,
    required this.model,
    required this.layout,
    required this.onTapClass,
    required this.onMoveClass,
    this.selectedId,
    this.canWrite = false,
    this.controller,
    this.onTapBackground,
  });

  final SemanticModel model;
  final BoardLayout layout;
  final String? selectedId;
  final bool canWrite;
  final DiagramController? controller;
  final void Function(UmlClass c) onTapClass;
  final void Function(String classId, Offset position) onMoveClass;
  final VoidCallback? onTapBackground;

  @override
  State<DiagramView> createState() => _DiagramViewState();
}

class _DiagramViewState extends State<DiagramView> with SingleTickerProviderStateMixin {
  /// Aire alrededor del dibujo: deja arrastrar una clase fuera de lo que hay.
  static const double _margin = 1200;
  static const double _minScale = 0.2;
  static const double _maxScale = 2;

  final _transform = TransformationController();
  late final AnimationController _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 260));
  Animation<Matrix4>? _tween;

  Size _viewport = Size.zero;
  Offset? _origin;
  bool _fitted = false;

  String? _dragId;
  Offset _dragDelta = Offset.zero;

  @override
  void initState() {
    super.initState();
    widget.controller?._state = this;
    _anim.addListener(() {
      final t = _tween;
      if (t != null) _transform.value = t.value;
    });
  }

  @override
  void didUpdateWidget(DiagramView old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      old.controller?._state = null;
      widget.controller?._state = this;
    }
  }

  @override
  void dispose() {
    widget.controller?._state = null;
    _anim.dispose();
    _transform.dispose();
    super.dispose();
  }

  // La vista solo traslada y escala, sin rotar: la escala es el primer
  // elemento. `getMaxScaleOnAxis` mira también el eje Z y, si este no se
  // escala, devuelve 1 aunque la vista esté al 40 %.
  double get _scale => _transform.value.storage[0];
  Offset get _translation => Offset(_transform.value.storage[12], _transform.value.storage[13]);

  /// Igual que las matrices de InteractiveViewer: escala uniforme en los tres
  /// ejes, para que sus límites de zoom lean la escala correcta.
  static Matrix4 _matrix(double s, Offset t) => Matrix4(s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, t.dx, t.dy, 0, 1);

  void _animateTo(Matrix4 target) {
    _tween = Matrix4Tween(
      begin: _transform.value,
      end: target,
    ).animate(CurvedAnimation(parent: _anim, curve: Curves.easeOutCubic));
    _anim.forward(from: 0);
  }

  /// `fitView` con `maxZoom: 1`: todo el diagrama a la vista, sin ampliar.
  void _fit({bool animate = false}) {
    final origin = _origin;
    if (origin == null || _viewport.isEmpty) return;
    final b = DiagramGeometry(widget.model, widget.layout).bounds;
    final s = math
        .min(1.0, math.min(_viewport.width / b.width, _viewport.height / b.height))
        .clamp(_minScale, _maxScale);
    final centerScene = b.center - origin;
    final m = _matrix(s, _viewport.center(Offset.zero) - centerScene * s);
    animate ? _animateTo(m) : _transform.value = m;
  }

  void _zoom(double factor) {
    final s = _scale;
    final next = (s * factor).clamp(_minScale, _maxScale);
    final center = _viewport.center(Offset.zero);
    final focus = (center - _translation) / s;
    _animateTo(_matrix(next, center - focus * next));
  }

  Offset? _viewportCenterInFlow() {
    final origin = _origin;
    if (origin == null || _viewport.isEmpty) return null;
    return (_viewport.center(Offset.zero) - _translation) / _scale + origin;
  }

  /// Si el dibujo crece hacia arriba o a la izquierda cambia el origen de la
  /// escena; se compensa la traslación para que la vista no salte.
  Offset _syncOrigin(Rect bounds) {
    final next = bounds.topLeft - const Offset(_margin, _margin);
    final previous = _origin;
    if (previous != null && previous != next && _fitted) {
      final shift = (previous - next) * _scale;
      _transform.value = _matrix(_scale, _translation - shift);
    }
    _origin = next;
    return next;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    final dragId = _dragId;
    final overrides = dragId == null
        ? const <String, Offset>{}
        : {dragId: (widget.layout.positions[dragId] ?? Offset.zero) + _dragDelta};
    final geometry = DiagramGeometry(widget.model, widget.layout, overrides: overrides);
    final stable = DiagramGeometry(widget.model, widget.layout);
    final bounds = stable.bounds;
    final origin = _syncOrigin(bounds);
    final sceneSize = bounds.size + const Offset(_margin * 2, _margin * 2);

    return LayoutBuilder(
      builder: (context, constraints) {
        _viewport = constraints.biggest;
        if (!_fitted && !_viewport.isEmpty) {
          _fitted = true;
          WidgetsBinding.instance.addPostFrameCallback((_) => _fit());
        }
        return ClipRect(
          child: Stack(
            children: [
              Positioned.fill(
                child: ColoredBox(
                  color: c.diagramaFondo,
                  child: AnimatedBuilder(
                    animation: _transform,
                    builder: (context, _) => CustomPaint(painter: _DotsPainter(_scale, _translation, c.diagramaPunto)),
                  ),
                ),
              ),
              InteractiveViewer(
                transformationController: _transform,
                constrained: false,
                minScale: _minScale,
                maxScale: _maxScale,
                boundaryMargin: const EdgeInsets.all(400),
                child: SizedBox.fromSize(
                  size: sceneSize,
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: widget.onTapBackground,
                          child: CustomPaint(
                            painter: _EdgesPainter(geometry.edges, origin, c, Theme.of(context).textTheme),
                          ),
                        ),
                      ),
                      for (final cls in _paintOrder())
                        if (geometry.rects[cls.id] case final rect?)
                          Positioned(
                            left: rect.left - origin.dx,
                            top: rect.top - origin.dy,
                            width: rect.width,
                            height: rect.height,
                            // La clave conserva el estado del gesto aunque la
                            // clase cambie de lugar en el orden de dibujo.
                            key: ValueKey(cls.id),
                            child: _classNode(cls, rect),
                          ),
                    ],
                  ),
                ),
              ),
              Positioned(
                left: 12,
                bottom: 12,
                child: _ZoomControls(
                  onIn: () => _zoom(1.25),
                  onOut: () => _zoom(0.8),
                  onFit: () => _fit(animate: true),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  /// La clase seleccionada o arrastrada se dibuja la última, encima de las
  /// demás, como React Flow con el nodo seleccionado.
  List<UmlClass> _paintOrder() {
    final top = _dragId ?? widget.selectedId;
    if (top == null) return widget.model.classes;
    return [
      for (final c in widget.model.classes)
        if (c.id != top) c,
      for (final c in widget.model.classes)
        if (c.id == top) c,
    ];
  }

  Widget _classNode(UmlClass cls, Rect rect) {
    final dragging = _dragId == cls.id;
    return Semantics(
      button: true,
      label: 'Clase ${cls.name}, ${cls.attributes.length} atributos',
      child: GestureDetector(
        onTap: () => widget.onTapClass(cls),
        onLongPressStart: widget.canWrite
            ? (_) {
                HapticFeedback.mediumImpact();
                setState(() {
                  _dragId = cls.id;
                  _dragDelta = Offset.zero;
                });
              }
            : null,
        onLongPressMoveUpdate: widget.canWrite ? (d) => setState(() => _dragDelta = d.localOffsetFromOrigin) : null,
        onLongPressEnd: widget.canWrite
            ? (_) {
                final start = widget.layout.positions[cls.id] ?? Offset.zero;
                final delta = _dragDelta;
                setState(() {
                  _dragId = null;
                  _dragDelta = Offset.zero;
                });
                if (delta.distance > 2) {
                  final p = start + delta;
                  widget.onMoveClass(cls.id, Offset(p.dx.roundToDouble(), p.dy.roundToDouble()));
                }
              }
            : null,
        child: ClassBox(
          umlClass: cls,
          width: rect.width,
          height: rect.height,
          selected: widget.selectedId == cls.id || dragging,
          lifted: dragging,
        ),
      ),
    );
  }
}

/// `<Background gap={16} size={1} />`: la rejilla se mueve y escala con la vista.
class _DotsPainter extends CustomPainter {
  _DotsPainter(this.scale, this.translation, this.color);
  final double scale;
  final Offset translation;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final gap = 16 * scale;
    if (gap < 3) return;
    // Una sola llamada para todos los puntos: con el diagrama alejado son
    // miles, y se repintan en cada cuadro del desplazamiento.
    final paint = Paint()
      ..color = color
      ..strokeWidth = math.max(1.4, 1.5 * scale)
      ..strokeCap = StrokeCap.round;
    final startX = translation.dx % gap;
    final startY = translation.dy % gap;
    final points = <Offset>[
      for (var x = startX; x < size.width; x += gap)
        for (var y = startY; y < size.height; y += gap) Offset(x, y),
    ];
    canvas.drawPoints(PointMode.points, points, paint);
  }

  @override
  bool shouldRepaint(_DotsPainter old) => old.scale != scale || old.translation != translation || old.color != color;
}

/// Líneas rectas, rombo en el origen (composición y agregación), triángulo
/// hueco en el destino (generalización) y multiplicidades en cada extremo.
class _EdgesPainter extends CustomPainter {
  _EdgesPainter(this.edges, this.origin, this.c, this.text);
  final List<EdgeRoute> edges;
  final Offset origin;
  final UmlColors c;
  final TextTheme text;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.translate(-origin.dx, -origin.dy);
    final line = Paint()
      ..color = c.diagramaLinea
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    final markerStroke = Paint()
      ..color = c.diagramaLinea
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.35
      ..strokeJoin = StrokeJoin.round;

    for (final e in edges) {
      final path = Path()..moveTo(e.points.first.dx, e.points.first.dy);
      for (final p in e.points.skip(1)) {
        path.lineTo(p.dx, p.dy);
      }
      final kind = e.relationship.kind;
      if (kind == 'DEPENDENCY' || kind == 'REALIZATION') {
        _drawDashedPath(canvas, path, line);
      } else {
        canvas.drawPath(path, line);
      }
      if (kind == 'GENERALIZATION' || kind == 'REALIZATION') {
        _marker(
          canvas,
          e.target,
          angleBetween(e.target, e.targetToward),
          const [Offset(0, 0), Offset(18, -9), Offset(18, 9)],
          markerStroke,
          filled: false,
        );
      } else if (kind == 'COMPOSITION' || kind == 'AGGREGATION') {
        _marker(
          canvas,
          e.source,
          angleBetween(e.source, e.sourceToward),
          const [Offset(0, 0), Offset(10, -7), Offset(20, 0), Offset(10, 7)],
          markerStroke,
          filled: kind == 'COMPOSITION',
        );
      }

      if (kind == 'DEPENDENCY') {
        _openArrow(canvas, e.target, e.targetToward, markerStroke);
      }
      if (e.associationClassConnector case (final start, final end)) {
        final connector = Path()
          ..moveTo(start.dx, start.dy)
          ..lineTo(end.dx, end.dy);
        _drawDashedPath(canvas, connector, line);
      }
      if (e.relationship.name case final name? when e.relationship.associationClassId == null) {
        _label(canvas, name, e.midpoint - const Offset(0, 12), italic: true);
      }
      if (e.relationship.isStructural) {
        _navigation(canvas, e.source, e.sourceToward, e.relationship.sourceNavigability, markerStroke);
        _navigation(canvas, e.target, e.targetToward, e.relationship.targetNavigability, markerStroke);
        _label(canvas, e.relationship.sourceMultiplicity, e.sourceLabel, italic: false);
        _label(canvas, e.relationship.targetMultiplicity, e.targetLabel, italic: false);
        if (e.relationship.sourceRole case final role?) {
          _label(canvas, role, e.sourceRoleLabel, italic: true);
        }
        if (e.relationship.targetRole case final role?) {
          _label(canvas, role, e.targetRoleLabel, italic: true);
        }
      }
    }
  }

  void _drawDashedPath(Canvas canvas, Path path, Paint paint) {
    for (final metric in path.computeMetrics()) {
      for (var offset = 0.0; offset < metric.length; offset += 11) {
        canvas.drawPath(metric.extractPath(offset, math.min(offset + 7, metric.length)), paint);
      }
    }
  }

  void _openArrow(Canvas canvas, Offset at, Offset toward, Paint stroke) {
    canvas.save();
    canvas.translate(at.dx, at.dy);
    canvas.rotate(angleBetween(at, toward));
    canvas.drawPath(
      Path()
        ..moveTo(12, -6)
        ..lineTo(0, 0)
        ..lineTo(12, 6),
      stroke,
    );
    canvas.restore();
  }

  void _navigation(Canvas canvas, Offset at, Offset toward, String? value, Paint stroke) {
    if (value == 'navigable') _openArrow(canvas, at, toward, stroke);
    if (value == 'nonNavigable') {
      canvas.save();
      canvas.translate(at.dx, at.dy);
      canvas.rotate(angleBetween(at, toward));
      canvas.drawPath(
        Path()
          ..moveTo(2, -4)
          ..lineTo(10, 4)
          ..moveTo(2, 4)
          ..lineTo(10, -4),
        stroke,
      );
      canvas.restore();
    }
  }

  void _marker(Canvas canvas, Offset at, double angle, List<Offset> points, Paint stroke, {required bool filled}) {
    canvas.save();
    canvas.translate(at.dx, at.dy);
    canvas.rotate(angle);
    final path = Path()..addPolygon(points, true);
    canvas.drawPath(path, Paint()..color = filled ? c.diagramaLinea : c.diagramaFondo);
    canvas.drawPath(path, stroke);
    canvas.restore();
  }

  /// Texto con un halo del color del fondo (`paint-order: stroke`), para que
  /// se lea aunque cruce una línea.
  void _label(Canvas canvas, String value, Offset center, {required bool italic}) {
    final base = TextStyle(fontFamily: kSans, fontSize: 11, fontStyle: italic ? FontStyle.italic : FontStyle.normal);
    final halo = TextPainter(
      text: TextSpan(
        text: value,
        style: base.copyWith(
          foreground: Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 3
            ..strokeJoin = StrokeJoin.round
            ..color = c.diagramaFondo,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final fill = TextPainter(
      text: TextSpan(
        text: value,
        style: base.copyWith(color: italic ? c.claseTenue : c.claseTexto),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final topLeft = center - Offset(fill.width / 2, fill.height / 2);
    halo.paint(canvas, topLeft);
    fill.paint(canvas, topLeft);
  }

  @override
  bool shouldRepaint(_EdgesPainter old) => old.edges != edges || old.origin != origin || old.c != c;
}

/// Los tres botones de `<Controls>` de React Flow, apilados.
class _ZoomControls extends StatelessWidget {
  const _ZoomControls({required this.onIn, required this.onOut, required this.onFit});
  final VoidCallback onIn;
  final VoidCallback onOut;
  final VoidCallback onFit;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    Widget button(IconData icon, String tooltip, VoidCallback onTap) => Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(width: 40, height: 40, child: Icon(icon, size: 20, color: c.texto)),
      ),
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: c.superficie,
        border: Border.all(color: c.bordeFuerte),
        borderRadius: BorderRadius.circular(6),
        boxShadow: [BoxShadow(color: c.sombra, blurRadius: 2, offset: const Offset(0, 1))],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: Material(
          type: MaterialType.transparency,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              button(Icons.add, 'Acercar', onIn),
              Divider(height: 1, color: c.borde),
              button(Icons.remove, 'Alejar', onOut),
              Divider(height: 1, color: c.borde),
              button(Icons.fit_screen_outlined, 'Ajustar diagrama a la vista', onFit),
            ],
          ),
        ),
      ),
    );
  }
}
