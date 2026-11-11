import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_mobile/features/editor/geometry.dart';
import 'package:uml_mobile/features/editor/model.dart';

UmlClass clase(String id, {int atributos = 0}) => UmlClass(
  id: id,
  name: id,
  attributes: [
    for (var i = 0; i < atributos; i++)
      UmlAttribute(id: '$id-$i', name: 'a$i', type: 'String', primaryKey: false, nullable: true, unique: false),
  ],
);

UmlRelationship rel(String id, String s, String t, {String kind = 'ASSOCIATION'}) =>
    UmlRelationship(id: id, kind: kind, sourceId: s, targetId: t, sourceMultiplicity: '1', targetMultiplicity: '0..*');

void main() {
  test('el alto de una tarjeta sigue la fórmula de la web', () {
    // altoDeNodo: max(80, 34 + 10 + n * 22)
    expect(nodeHeight(0), 80);
    expect(nodeHeight(1), 80);
    expect(nodeHeight(3), 110);
  });

  test('la línea sale por el lado que queda enfrente (ladosMasCortos)', () {
    const a = Rect.fromLTWH(0, 0, 240, 66);
    expect(shortestSides(a, const Rect.fromLTWH(400, 10, 240, 66), recursive: false), (Side.right, Side.left));
    expect(shortestSides(a, const Rect.fromLTWH(-400, 10, 240, 66), recursive: false), (Side.left, Side.right));
    expect(shortestSides(a, const Rect.fromLTWH(20, 300, 240, 66), recursive: false), (Side.bottom, Side.top));
    expect(shortestSides(a, const Rect.fromLTWH(20, -300, 240, 66), recursive: false), (Side.top, Side.bottom));
    expect(shortestSides(a, a, recursive: true), (Side.loopSource, Side.loopTarget));
  });

  test('usa las posiciones y tamaños del layout, y el tamaño calculado si no hay', () {
    final model = SemanticModel(classes: [clase('A', atributos: 2), clase('B')], relationships: []);
    final layout = BoardLayout(
      positions: {'A': const Offset(10, 20), 'B': const Offset(400, 20)},
      sizes: {'B': const Size(300, 120)},
    );
    final g = DiagramGeometry(model, layout);
    expect(g.rects['A'], const Rect.fromLTWH(10, 20, kNodeWidth, 88));
    expect(g.rects['B'], const Rect.fromLTWH(400, 20, 300, 120));
  });

  test('una clase sin posición queda en el origen, como en la web', () {
    final g = DiagramGeometry(SemanticModel(classes: [clase('A')], relationships: []), BoardLayout.empty);
    expect(g.rects['A']!.topLeft, Offset.zero);
  });

  test('las relaciones paralelas van en carriles separados 24 px', () {
    final model = SemanticModel(
      classes: [clase('A'), clase('B')],
      relationships: [rel('r1', 'A', 'B'), rel('r2', 'A', 'B')],
    );
    final layout = BoardLayout(positions: {'A': Offset.zero, 'B': const Offset(500, 0)});
    final edges = DiagramGeometry(model, layout).edges;
    expect(edges, hasLength(2));
    // Línea horizontal anclada a media altura (33): los carriles se separan
    // en vertical, ±12 px.
    expect(edges[0].points, hasLength(4));
    expect(edges[0].sourceToward.dy, closeTo(40 - 12, 0.001));
    expect(edges[1].sourceToward.dy, closeTo(40 + 12, 0.001));
  });

  test('una relación sola es una línea recta entre los anclajes', () {
    final model = SemanticModel(classes: [clase('A'), clase('B')], relationships: [rel('r', 'A', 'B')]);
    final layout = BoardLayout(positions: {'A': Offset.zero, 'B': const Offset(500, 0)});
    final e = DiagramGeometry(model, layout).edges.single;
    expect(e.points, [const Offset(240, 40), const Offset(500, 40)]);
    // Multiplicidad del origen: 18 px hacia el destino y 6 px por encima.
    expect(e.sourceLabel, const Offset(258, 34));
  });

  test('una asociación recursiva dibuja un bucle por debajo', () {
    final model = SemanticModel(classes: [clase('A')], relationships: [rel('r', 'A', 'A')]);
    final e = DiagramGeometry(model, BoardLayout(positions: {'A': Offset.zero})).edges.single;
    expect(e.points.first, Offset(240 * 0.42, 80));
    expect(e.points[1], Offset(240 * 0.42, 80 + 58));
  });

  test('ignora relaciones hacia clases que ya no existen', () {
    final model = SemanticModel(classes: [clase('A')], relationships: [rel('r', 'A', 'X')]);
    expect(DiagramGeometry(model, BoardLayout.empty).edges, isEmpty);
  });

  test('lee el estado de GET /boards/:id/state', () {
    final s = BoardState.fromJson({
      'schemaVersion': '1.0.0',
      'semantic': {
        'classes': [
          {'id': 'A', 'displayName': 'Cliente', 'codeName': 'Cliente', 'databaseName': 'cliente', 'attributes': []},
        ],
        'relationships': [],
      },
      'layout': {
        'positions': {
          'A': {'x': 12, 'y': -4.5},
        },
        'sizes': {
          'A': {'width': 260, 'height': 90},
        },
      },
    });
    expect(s.model.classes.single.databaseName, 'cliente');
    expect(s.layout.positions['A'], const Offset(12, -4.5));
    expect(s.layout.sizes['A'], const Size(260, 90));
  });
}
