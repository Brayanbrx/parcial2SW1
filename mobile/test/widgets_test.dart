import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uml_mobile/core/brand.dart';
import 'package:uml_mobile/core/theme.dart';
import 'package:uml_mobile/features/editor/class_box.dart';
import 'package:uml_mobile/features/editor/diagram.dart';
import 'package:uml_mobile/features/editor/model.dart';

final _model = SemanticModel(
  classes: [
    UmlClass(id: 'a', name: 'Pedido', attributes: [
      UmlAttribute(id: 'a1', name: 'id', type: 'UUID', primaryKey: true, nullable: false, unique: false),
      UmlAttribute(id: 'a2', name: 'fecha', type: 'DateTime', primaryKey: false, nullable: false, unique: false),
      UmlAttribute(id: 'a3', name: 'codigo', type: 'String', primaryKey: false, nullable: true, unique: true),
    ]),
    UmlClass(id: 'b', name: 'Detalle', attributes: []),
  ],
  relationships: [
    UmlRelationship(
      id: 'r',
      kind: 'COMPOSITION',
      sourceId: 'a',
      targetId: 'b',
      sourceMultiplicity: '1',
      targetMultiplicity: '1..*',
    ),
  ],
);

Widget _app(Widget child, {Brightness brightness = Brightness.light}) =>
    MaterialApp(theme: buildTheme(brightness), home: Scaffold(body: child));

void main() {
  testWidgets('la tarjeta muestra las filas como la web: «- nombre: Tipo», PK, * y U', (tester) async {
    await tester.pumpWidget(_app(ClassBox(umlClass: _model.classes.first)));
    expect(find.text('Pedido'), findsOneWidget);
    expect(find.text('PK'), findsOneWidget);
    expect(find.text('U'), findsOneWidget);
    expect(find.textContaining('fecha: DateTime *', findRichText: true), findsOneWidget);
  });

  testWidgets('una clase sin atributos lo dice', (tester) async {
    await tester.pumpWidget(_app(ClassBox(umlClass: _model.classes.last)));
    expect(find.text('sin atributos'), findsOneWidget);
  });

  for (final brightness in Brightness.values) {
    testWidgets('el diagrama se dibuja y responde al toque (${brightness.name})', (tester) async {
      UmlClass? tapped;
      await tester.pumpWidget(_app(
        DiagramView(
          model: _model,
          layout: BoardLayout(positions: {'a': Offset.zero, 'b': const Offset(400, 0)}),
          onTapClass: (c) => tapped = c,
          onMoveClass: (_, _) {},
        ),
        brightness: brightness,
      ));
      await tester.pumpAndSettle();
      expect(find.text('Detalle'), findsOneWidget);
      expect(find.byTooltip('Ajustar diagrama a la vista'), findsOneWidget);
      await tester.tap(find.text('Detalle'));
      expect(tapped?.id, 'b');
    });
  }

  testWidgets('arrastrar una clase con pulsación larga envía su nueva posición', (tester) async {
    String? moved;
    Offset? to;
    await tester.pumpWidget(_app(
      DiagramView(
        model: _model,
        layout: BoardLayout(positions: {'a': Offset.zero, 'b': const Offset(400, 0)}),
        canWrite: true,
        onTapClass: (_) {},
        onMoveClass: (id, p) {
          moved = id;
          to = p;
        },
      ),
    ));
    await tester.pumpAndSettle();
    final gesture = await tester.startGesture(tester.getCenter(find.text('Detalle')));
    await tester.pump(const Duration(milliseconds: 700));
    await gesture.moveBy(const Offset(0, 40));
    await tester.pump();
    await gesture.moveBy(const Offset(0, 40));
    await gesture.up();
    await tester.pump();
    expect(moved, 'b');
    expect(to!.dx, closeTo(400, 1));
    expect(to!.dy, greaterThan(0));
  });

  testWidgets('con la vista alejada, el centro visible es el centro del diagrama', (tester) async {
    // Regresión: la escala se leía con getMaxScaleOnAxis y valía 1 aunque la
    // vista estuviera al 30 %; una clase nueva aparecía a cientos de px.
    tester.view.physicalSize = const Size(400, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final controller = DiagramController();
    final layout = BoardLayout(positions: {'a': Offset.zero, 'b': const Offset(1400, 900)});
    await tester.pumpWidget(_app(DiagramView(
      controller: controller,
      model: _model,
      layout: layout,
      onTapClass: (_) {},
      onMoveClass: (_, _) {},
    )));
    await tester.pumpAndSettle();
    final center = controller.viewportCenter!;
    // Caja de las dos clases: x 0..1640, y 0..966 (Detalle sin atributos, 66 de alto).
    expect(center.dx, closeTo(1640 / 2, 2));
    expect(center.dy, closeTo((900 + 66) / 2, 2));
  });

  test('iniciales del avatar como en la web', () {
    expect(Avatar.initials('Ana'), 'AN');
    expect(Avatar.initials('Brayan Rojas'), 'BR');
    expect(Avatar.initials('  '), '?');
  });
}
