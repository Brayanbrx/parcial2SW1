import 'package:uuid/uuid.dart';

/// Vocabulario cerrado de `shared/contracts/src/vocabulary.ts`.
const conceptualTypes = ['String', 'Integer', 'Long', 'Decimal', 'Boolean', 'Date', 'DateTime', 'UUID'];
const multiplicities = ['1', '0..1', '0..*', '1..*'];
const relationshipKinds = {
  'ASSOCIATION': 'Asociación',
  'GENERALIZATION': 'Generalización',
  'COMPOSITION': 'Composición',
  'AGGREGATION': 'Agregación',
};

class UmlAttribute {
  UmlAttribute({
    required this.id,
    required this.name,
    required this.type,
    required this.primaryKey,
    required this.nullable,
    required this.unique,
  });
  final String id;
  final String name;
  final String type;
  final bool primaryKey;
  final bool nullable;
  final bool unique;

  factory UmlAttribute.fromJson(Map<String, dynamic> j) => UmlAttribute(
        id: j['id'] as String,
        name: j['displayName'] as String,
        type: j['type'] as String,
        primaryKey: j['primaryKey'] == true,
        nullable: j['nullable'] != false,
        unique: j['unique'] == true,
      );
}

class UmlClass {
  UmlClass({required this.id, required this.name, required this.attributes});
  final String id;
  final String name;
  final List<UmlAttribute> attributes;

  factory UmlClass.fromJson(Map<String, dynamic> j) => UmlClass(
        id: j['id'] as String,
        name: j['displayName'] as String,
        attributes: ((j['attributes'] as List?) ?? [])
            .map((a) => UmlAttribute.fromJson(a as Map<String, dynamic>))
            .toList(),
      );
}

class UmlRelationship {
  UmlRelationship({
    required this.id,
    required this.kind,
    required this.sourceId,
    required this.targetId,
    required this.sourceMultiplicity,
    required this.targetMultiplicity,
  });
  final String id;
  final String kind;
  final String sourceId;
  final String targetId;
  final String sourceMultiplicity;
  final String targetMultiplicity;

  factory UmlRelationship.fromJson(Map<String, dynamic> j) => UmlRelationship(
        id: j['id'] as String,
        kind: (j['kind'] as String?) ?? 'ASSOCIATION',
        sourceId: j['sourceClassId'] as String,
        targetId: j['targetClassId'] as String,
        sourceMultiplicity: j['sourceMultiplicity'] as String,
        targetMultiplicity: j['targetMultiplicity'] as String,
      );
}

class SemanticModel {
  SemanticModel({required this.classes, required this.relationships});
  final List<UmlClass> classes;
  final List<UmlRelationship> relationships;

  factory SemanticModel.empty() => SemanticModel(classes: [], relationships: []);

  factory SemanticModel.fromJson(dynamic json) {
    if (json is! Map) return SemanticModel.empty();
    return SemanticModel(
      classes: ((json['classes'] as List?) ?? [])
          .map((c) => UmlClass.fromJson(c as Map<String, dynamic>))
          .toList(),
      relationships: ((json['relationships'] as List?) ?? [])
          .map((r) => UmlRelationship.fromJson(r as Map<String, dynamic>))
          .toList(),
    );
  }

  String className(String id) {
    for (final c in classes) {
      if (c.id == id) return c.name;
    }
    return '(tabla eliminada)';
  }
}

const _uuid = Uuid();
String newId() => _uuid.v4();

/// Construye lotes de comandos con el formato de `commandBatchSchema`.
class BatchBuilder {
  BatchBuilder(this.actorId);
  final String actorId;
  final List<Map<String, dynamic>> _commands = [];
  final String _issuedAt = DateTime.now().toUtc().toIso8601String();

  BatchBuilder add(String type, Map<String, dynamic> payload) {
    _commands.add({
      'commandId': newId(),
      'origin': 'GUI',
      'actorId': actorId,
      'issuedAt': _issuedAt,
      'type': type,
      'payload': payload,
    });
    return this;
  }

  Map<String, dynamic> build() => {
        'batchId': newId(),
        'origin': 'GUI',
        'actorId': actorId,
        'issuedAt': _issuedAt,
        'commands': _commands,
      };
}

/// Resumen en español de los tipos de comando del historial de auditoría.
String commandLabel(String type) => switch (type) {
      'CREATE_CLASS' => 'creó una tabla',
      'RENAME_CLASS' => 'renombró una tabla',
      'DELETE_CLASS' => 'eliminó una tabla',
      'MOVE_CLASS' => 'movió una tabla',
      'ADD_ATTRIBUTE' => 'agregó un campo',
      'UPDATE_ATTRIBUTE' => 'modificó un campo',
      'DELETE_ATTRIBUTE' => 'eliminó un campo',
      'CREATE_RELATIONSHIP' => 'creó una relación',
      'UPDATE_RELATIONSHIP' => 'modificó una relación',
      'DELETE_RELATIONSHIP' => 'eliminó una relación',
      'CHANGE_MULTIPLICITY' => 'cambió una multiplicidad',
      _ => 'hizo un cambio',
    };
