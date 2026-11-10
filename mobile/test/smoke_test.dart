import 'package:flutter_test/flutter_test.dart';
import 'package:uml_mobile/features/editor/model.dart';

void main() {
  test('el lote de comandos respeta el contrato del servidor', () {
    final batch = BatchBuilder('actor-1')
        .add('CREATE_CLASS', {'classId': newId(), 'displayName': 'Cliente'})
        .build();
    expect(batch['origin'], 'GUI');
    expect(batch['actorId'], 'actor-1');
    expect((batch['commands'] as List).length, 1);
    expect(batch['issuedAt'], endsWith('Z'));
  });

  test('lee el modelo semántico del snapshot', () {
    final model = SemanticModel.fromJson({
      'classes': [
        {
          'id': 'a',
          'displayName': 'Cliente',
          'attributes': [
            {'id': 'x', 'displayName': 'id', 'type': 'UUID', 'primaryKey': true}
          ]
        }
      ],
      'relationships': [],
    });
    expect(model.classes.single.attributes.single.primaryKey, isTrue);
    expect(model.className('a'), 'Cliente');
  });
}
