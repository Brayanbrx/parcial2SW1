import 'dart:math' as math;
import 'dart:ui';

import 'model.dart';

// Medidas de `frontend/src/features/editor/BoardCanvas.tsx`: si la web cambia
// el tamaño de una tarjeta, el diagrama del teléfono tiene que cambiar igual.
const double kNodeWidth = 240;
const double kHeaderHeight = 34;
const double kRowHeight = 22;
const double kListPadding = 10;

/// Alto de la tarjeta según cuántos atributos tiene (`altoDeNodo`).
double nodeHeight(int attributes) => math.max(80, kHeaderHeight + kListPadding + attributes * kRowHeight);

double _nodeWidth(int lineLength) => math.max(kNodeWidth, math.min(760.0, lineLength * 7.0 + 32));

enum Side { left, right, top, bottom, loopSource, loopTarget }

/// Punto de un lado donde se ancla la línea (los `Handle` de React Flow).
Offset anchorOf(Rect r, Side side) => switch (side) {
  Side.left => Offset(r.left, r.center.dy),
  Side.right => Offset(r.right, r.center.dy),
  Side.top => Offset(r.center.dx, r.top),
  Side.bottom => Offset(r.center.dx, r.bottom),
  // Los dos anclajes del bucle de una asociación recursiva (42 % y 58 %).
  Side.loopSource => Offset(r.left + r.width * 0.42, r.bottom),
  Side.loopTarget => Offset(r.left + r.width * 0.58, r.bottom),
};

/// `ladosMasCortos`: el eje dominante decide por dónde sale la línea.
(Side, Side) shortestSides(Rect source, Rect target, {required bool recursive}) {
  if (recursive) return (Side.loopSource, Side.loopTarget);
  final d = target.center - source.center;
  if (d.dx.abs() >= d.dy.abs()) {
    return d.dx >= 0 ? (Side.right, Side.left) : (Side.left, Side.right);
  }
  return d.dy >= 0 ? (Side.bottom, Side.top) : (Side.top, Side.bottom);
}

/// Una relación ya colocada: trazo, marcadores y etiquetas.
class EdgeRoute {
  EdgeRoute({
    required this.relationship,
    required this.points,
    required this.sourceToward,
    required this.targetToward,
    required this.sourceLabel,
    required this.targetLabel,
    required this.sourceRoleLabel,
    required this.targetRoleLabel,
    this.associationClassBounds,
  });

  final UmlRelationship relationship;

  /// Polilínea desde el anclaje de origen hasta el de destino.
  final List<Offset> points;

  /// Primer punto después del origen y último antes del destino: orientan
  /// los marcadores cuando la línea no es recta.
  final Offset sourceToward;
  final Offset targetToward;
  final Offset sourceLabel;
  final Offset targetLabel;
  final Offset sourceRoleLabel;
  final Offset targetRoleLabel;
  final Rect? associationClassBounds;

  Offset get source => points.first;
  Offset get target => points.last;
  Offset get midpoint => (sourceToward + targetToward) / 2;

  (Offset, Offset)? get associationClassConnector {
    final box = associationClassBounds;
    if (box == null) return null;
    final delta = midpoint - box.center;
    final fraction = math.min(box.width / 2 / delta.dx.abs(), box.height / 2 / delta.dy.abs());
    return fraction >= 1 ? null : (midpoint, box.center + delta * fraction);
  }
}

/// Disposición completa del diagrama a partir del modelo y el layout.
class DiagramGeometry {
  DiagramGeometry(this.model, this.layout, {Map<String, Offset> overrides = const {}}) {
    for (final c in model.classes) {
      final position = overrides[c.id] ?? layout.positions[c.id] ?? Offset.zero;
      final lines = [
        c.name,
        ...c.attributes.map((a) => a.notation),
        ...c.operations.map((o) => o.notation),
        ...c.literals,
      ];
      final naturalWidth = _nodeWidth(lines.map((s) => s.length).reduce(math.max));
      final naturalHeight = math.max(
        80.0,
        44.0 +
            (c.keyword == null ? 0 : 24) +
            (c.attributes.length + c.operations.length + c.literals.length) * 22 +
            (c.operations.isEmpty ? 0 : 12) +
            (c.kind == 'ENUMERATION' ? 12 : 0),
      );
      final size = layout.sizes[c.id] ?? Size(naturalWidth, naturalHeight);
      rects[c.id] = position & size;
    }
    edges = _route();
  }

  final SemanticModel model;
  final BoardLayout layout;
  final Map<String, Rect> rects = {};
  late final List<EdgeRoute> edges;

  Offset associationClassPosition(UmlRelationship relationship, String name) {
    final sourceId = relationship.sourceId;
    final source = rects[sourceId];
    final target = rects[relationship.targetId];
    if (source == null || target == null) return const Offset(80, 80);
    final union = source.expandToInclude(target);
    final delta = target.center - source.center;
    final below = delta.dx.abs() >= delta.dy.abs();
    final loops = model.relationships.where((r) => r.sourceId == sourceId && r.targetId == sourceId).length;
    final gap = relationship.sourceId == relationship.targetId ? 100 + math.max(0, loops - 1) * 28 : 100;
    final size = Size(_nodeWidth(name.length), nodeHeight(0));
    var position = below
        ? Offset((source.center.dx + target.center.dx) / 2 - size.width / 2, union.bottom + gap)
        : Offset(union.right + 100, (source.center.dy + target.center.dy) / 2 - size.height / 2);
    final ordered = rects.values.toList()..sort((a, b) => below ? a.top.compareTo(b.top) : a.left.compareTo(b.left));
    for (final box in ordered) {
      if (!(position & size).overlaps(box.inflate(24))) continue;
      position = below ? Offset(position.dx, box.bottom + 24) : Offset(box.right + 24, position.dy);
    }
    return position;
  }

  /// Caja que contiene todas las clases, con aire para bucles y etiquetas.
  Rect get bounds {
    if (rects.isEmpty) return const Rect.fromLTWH(0, 0, kNodeWidth, 200);
    var r = rects.values.first;
    for (final rect in rects.values.skip(1)) {
      r = r.expandToInclude(rect);
    }
    return r.inflate(80);
  }

  List<EdgeRoute> _route() {
    final drawable = model.relationships
        .where((r) => rects.containsKey(r.sourceId) && rects.containsKey(r.targetId))
        .toList();
    final lanes = _parallelLanes(drawable);
    return [for (final r in drawable) _routeOne(r, lanes[r.id] ?? (index: 0, count: 1))];
  }

  EdgeRoute _routeOne(UmlRelationship r, ({int index, int count}) lane) {
    final recursive = r.sourceId == r.targetId;
    final sides = shortestSides(rects[r.sourceId]!, rects[r.targetId]!, recursive: recursive);
    final s = anchorOf(rects[r.sourceId]!, sides.$1);
    final t = anchorOf(rects[r.targetId]!, sides.$2);
    final carril = (lane.index - (lane.count - 1) / 2) * 24;

    if (recursive) {
      final depth = 58.0 + lane.index * 28;
      final sT = Offset(s.dx, s.dy + depth);
      final tT = Offset(t.dx, t.dy + depth);
      return EdgeRoute(
        relationship: r,
        points: [s, sT, tT, t],
        sourceToward: sT,
        targetToward: tT,
        sourceLabel: Offset(s.dx - 18, s.dy + 18 + lane.index * 10),
        targetLabel: Offset(t.dx + 18, t.dy + 18 + lane.index * 10),
        sourceRoleLabel: Offset(s.dx - 24, s.dy + 38 + lane.index * 14),
        targetRoleLabel: Offset(t.dx + 24, t.dy + 38 + lane.index * 14),
        associationClassBounds: rects[r.associationClassId],
      );
    }

    final d = t - s;
    final length = d.distance == 0 ? 1.0 : d.distance;
    final dir = d / length;
    final normal = Offset(-dir.dy, dir.dx);
    final List<Offset> points;
    final Offset sT;
    final Offset tT;
    if (carril == 0) {
      points = [s, t];
      sT = t;
      tT = s;
    } else {
      final guide = math.min(32.0, length / 3);
      sT = s + dir * guide + normal * carril;
      tT = t - dir * guide + normal * carril;
      points = [s, sT, tT, t];
    }
    Offset shifted(Offset p) => p + normal * carril;
    return EdgeRoute(
      relationship: r,
      points: points,
      sourceToward: sT,
      targetToward: tT,
      sourceLabel: shifted(_labelNear(s, t)),
      targetLabel: shifted(_labelNear(t, s)),
      sourceRoleLabel: shifted(_labelNear(s, t, separation: 42, vertical: 8)),
      targetRoleLabel: shifted(_labelNear(t, s, separation: 42, vertical: 8)),
      associationClassBounds: rects[r.associationClassId],
    );
  }

  /// `extremo`: separada de la clase y por encima de la línea, salvo cuando la
  /// línea es casi vertical; ahí estorbaría y se aparta al lado.
  static Offset _labelNear(Offset from, Offset toward, {double separation = 18, double vertical = -6}) {
    final d = toward - from;
    final length = d.distance == 0 ? 1.0 : d.distance;
    final ux = d.dx / length;
    final uy = d.dy / length;
    return Offset(from.dx + ux * separation, from.dy + uy * separation + (uy.abs() > 0.8 ? 0 : vertical));
  }

  /// Relaciones entre el mismo par de clases: cada una va en su carril.
  static Map<String, ({int index, int count})> _parallelLanes(List<UmlRelationship> rels) {
    final groups = <String, List<String>>{};
    for (final r in rels) {
      final pair = [r.sourceId, r.targetId]..sort();
      groups.putIfAbsent(pair.join('|'), () => []).add(r.id);
    }
    return {
      for (final ids in groups.values)
        for (var i = 0; i < ids.length; i++) ids[i]: (index: i, count: ids.length),
    };
  }
}

/// Ángulo en radianes de `from` hacia `to`.
double angleBetween(Offset from, Offset to) => math.atan2(to.dy - from.dy, to.dx - from.dx);
