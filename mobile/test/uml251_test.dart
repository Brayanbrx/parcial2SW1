import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uml_mobile/core/theme.dart';
import 'package:uml_mobile/features/editor/class_box.dart';
import 'package:uml_mobile/features/editor/model.dart';

void main() {
  test('lee y representa firmas UML con parámetros, retorno y multiplicidad', () {
    final operation = UmlOperation({
      'id': 'op',
      'displayName': 'calcular',
      'visibility': 'protected',
      'isStatic': true,
      'parameters': [
        {'name': 'impuesto', 'type': 'Decimal', 'direction': 'inout', 'multiplicity': '0..1'},
      ],
      'returnType': 'Decimal',
      'returnMultiplicity': '2..5',
    });
    expect(operation.notation, '# calcular(inout impuesto: Decimal [0..1]): Decimal [2..5]');
    expect(operation.isStatic, isTrue);
  });
  test('valida rangos generales sin aceptar límites invertidos', () {
    for (final value in ['1', '0..1', '2..5', '3..*', '*', '0']) {
      expect(validMultiplicity(value), isTrue);
    }
    for (final value in ['5..2', '-1', 'a', '01', '1...2']) {
      expect(validMultiplicity(value), isFalse);
    }
  });
  testWidgets('muestra interfaz, operación abstracta y literales de enumeración', (tester) async {
    final contract = UmlClass.fromJson({
      'id': 'i',
      'displayName': 'Facturable',
      'kind': 'INTERFACE',
      'attributes': [],
      'operations': [
        {'id': 'op', 'displayName': 'facturar', 'visibility': 'public', 'isAbstract': true, 'parameters': []},
      ],
    });
    final enumeration = UmlClass.fromJson({
      'id': 'e',
      'displayName': 'Estado',
      'kind': 'ENUMERATION',
      'attributes': [],
      'literals': ['PENDIENTE', 'PAGADO'],
    });
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.light),
        home: Scaffold(
          body: Column(
            children: [
              ClassBox(umlClass: contract),
              ClassBox(umlClass: enumeration),
            ],
          ),
        ),
      ),
    );
    expect(find.text('«interface»\nFacturable', findRichText: true), findsOneWidget);
    expect(find.text('+ facturar()'), findsOneWidget);
    expect(find.text('PENDIENTE'), findsOneWidget);
    expect(find.text('PAGADO'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
