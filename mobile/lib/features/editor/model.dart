import 'dart:ui' show Offset, Size;

import 'package:uuid/uuid.dart';

/// Vocabulario cerrado de `shared/contracts/src/vocabulary.ts`.
const conceptualTypes = ['String', 'Integer', 'Long', 'Decimal', 'Boolean', 'Date', 'DateTime', 'UUID'];
const multiplicities = ['1', '0..1', '0..*', '1..*'];
const relationshipKinds = {
  'ASSOCIATION': 'Asociación',
  'GENERALIZATION': 'Generalización',
  'COMPOSITION': 'Composición',
  'AGGREGATION': 'Agregación',
  'DEPENDENCY': 'Dependencia',
  'REALIZATION': 'Realización',
};

class UmlAttribute {
  UmlAttribute({
    required this.id,
    required this.name,
    required this.type,
    required this.primaryKey,
    required this.nullable,
    required this.unique,
    this.visibility = 'private',
    this.isStatic = false,
    this.isDerived = false,
    this.isReadOnly = false,
    this.multiplicity,
    this.defaultValue,
  });
  final String id;
  final String name;
  final String type;
  final bool primaryKey;
  final bool nullable;
  final bool unique;
  final String visibility;
  final bool isStatic, isDerived, isReadOnly;
  final String? multiplicity, defaultValue;
  String get notation {
    final range = multiplicity;
    final label = range == null || range == '0..1' || range == '1' ? '' : ' [$range]';
    return '${visibilitySymbols[visibility] ?? '-'} ${isDerived ? '/' : ''}$name: $type$label${defaultValue == null || defaultValue!.isEmpty ? '' : ' = $defaultValue'}${isReadOnly ? ' {readOnly}' : ''}';
  }

  factory UmlAttribute.fromJson(Map<String, dynamic> j) => UmlAttribute(
    id: j['id'] as String,
    name: j['displayName'] as String,
    type: j['type'] as String,
    primaryKey: j['primaryKey'] == true,
    nullable: j['nullable'] != false,
    unique: j['unique'] == true,
    visibility: j['visibility'] as String? ?? 'private',
    isStatic: j['isStatic'] == true,
    isDerived: j['isDerived'] == true,
    isReadOnly: j['isReadOnly'] == true,
    multiplicity: j['multiplicity'] as String?,
    defaultValue: j['defaultValue'] as String?,
  );
}

class UmlClass {
  UmlClass({
    required this.id,
    required this.name,
    required this.attributes,
    this.kind = 'CLASS',
    this.isAbstract = false,
    this.literals = const [],
    this.operations = const [],
    String? codeName,
    String? databaseName,
  }) : codeName = codeName ?? name,
       databaseName = databaseName ?? name;
  final String id;
  final String name;
  final String codeName;
  final String databaseName;
  final List<UmlAttribute> attributes;
  final String kind;
  final bool isAbstract;
  final List<String> literals;
  final List<UmlOperation> operations;
  String? get keyword => switch (kind) {
    'INTERFACE' => 'interface',
    'ENUMERATION' => 'enumeration',
    'DATA_TYPE' => 'dataType',
    _ => null,
  };

  /// La web muestra el nombre de tabla debajo solo cuando el técnico difiere.
  bool get technicalDiffers => codeName != name;

  factory UmlClass.fromJson(Map<String, dynamic> j) => UmlClass(
    id: j['id'] as String,
    name: j['displayName'] as String,
    kind: j['kind'] as String? ?? 'CLASS',
    isAbstract: j['isAbstract'] == true,
    literals: ((j['literals'] as List?) ?? []).cast<String>(),
    operations: ((j['operations'] as List?) ?? [])
        .map((o) => UmlOperation(Map<String, dynamic>.from(o as Map)))
        .toList(),
    codeName: j['codeName'] as String?,
    databaseName: j['databaseName'] as String?,
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
    this.sourceRole,
    this.targetRole,
    this.name,
    this.sourceNavigability,
    this.targetNavigability,
    this.associationClassId,
  });
  final String id;
  final String kind;
  final String sourceId;
  final String targetId;
  final String sourceMultiplicity;
  final String targetMultiplicity;
  final String? sourceRole;
  final String? targetRole;
  final String? name, sourceNavigability, targetNavigability;
  final String? associationClassId;

  bool get isGeneralization => kind == 'GENERALIZATION';
  bool get isStructural => !['GENERALIZATION', 'DEPENDENCY', 'REALIZATION'].contains(kind);

  factory UmlRelationship.fromJson(Map<String, dynamic> j) => UmlRelationship(
    id: j['id'] as String,
    kind: (j['kind'] as String?) ?? 'ASSOCIATION',
    sourceId: j['sourceClassId'] as String,
    targetId: j['targetClassId'] as String,
    sourceMultiplicity: j['sourceMultiplicity'] as String,
    targetMultiplicity: j['targetMultiplicity'] as String,
    sourceRole: j['sourceRoleName'] as String?,
    targetRole: j['targetRoleName'] as String?,
    name: j['name'] as String?,
    sourceNavigability: j['sourceNavigability'] as String?,
    targetNavigability: j['targetNavigability'] as String?,
    associationClassId: j['associationClassId'] as String?,
  );
}

const visibilitySymbols = {'public': '+', 'private': '-', 'protected': '#', 'package': '~'};
const classifierKinds = {
  'CLASS': 'Clase',
  'INTERFACE': 'Interfaz',
  'ENUMERATION': 'Enumeración',
  'DATA_TYPE': 'Tipo de datos',
};

bool validMultiplicity(String value) {
  if (value == '*') return true;
  if (!RegExp(r'^(0|[1-9]\d*)(?:\.\.(?:0|[1-9]\d*|\*))?$').hasMatch(value)) {
    return false;
  }
  final parts = value.split('..');
  final lower = int.tryParse(parts.first);
  final upper = parts.last == '*' ? null : int.tryParse(parts.last);
  return lower != null &&
      lower <= 9007199254740991 &&
      (parts.last == '*' || upper != null && upper <= 9007199254740991 && lower <= upper);
}

class UmlOperation {
  UmlOperation(this.data);
  final Map<String, dynamic> data;
  String get id => data['id'] as String;
  String get name => data['displayName'] as String;
  bool get isStatic => data['isStatic'] == true;
  bool get isAbstract => data['isAbstract'] == true;
  String get notation {
    final params = ((data['parameters'] as List?) ?? [])
        .map(
          (p) =>
              '${p['direction'] == 'out' || p['direction'] == 'inout' ? "${p['direction']} " : ''}${p['name']}: ${p['type']}${p['multiplicity'] != null && p['multiplicity'] != '1' ? " [${p['multiplicity']}]" : ''}${p['defaultValue'] != null && p['defaultValue'] != '' ? " = ${p['defaultValue']}" : ''}',
        )
        .join(', ');
    final type = data['returnType'];
    return '${visibilitySymbols[data['visibility']] ?? '+'} $name($params)${type == null || type == 'void' ? '' : ': $type'}${type == null || type == 'void' || data['returnMultiplicity'] == null || data['returnMultiplicity'] == '1' ? '' : " [${data['returnMultiplicity']}]"}';
  }
}

class SemanticModel {
  SemanticModel({required this.classes, required this.relationships});
  final List<UmlClass> classes;
  final List<UmlRelationship> relationships;

  factory SemanticModel.empty() => SemanticModel(classes: [], relationships: []);

  factory SemanticModel.fromJson(dynamic json) {
    if (json is! Map) return SemanticModel.empty();
    return SemanticModel(
      classes: ((json['classes'] as List?) ?? []).map((c) => UmlClass.fromJson(c as Map<String, dynamic>)).toList(),
      relationships: ((json['relationships'] as List?) ?? [])
          .map((r) => UmlRelationship.fromJson(r as Map<String, dynamic>))
          .toList(),
    );
  }

  UmlClass? findClass(String id) {
    for (final c in classes) {
      if (c.id == id) return c;
    }
    return null;
  }

  String className(String id) => findClass(id)?.name ?? '(clase eliminada)';
}

/// Posiciones y tamaños del lienzo (`layoutSchema` del contrato).
class BoardLayout {
  const BoardLayout({this.positions = const {}, this.sizes = const {}});
  final Map<String, Offset> positions;
  final Map<String, Size> sizes;

  static const empty = BoardLayout();

  factory BoardLayout.fromJson(dynamic json) {
    if (json is! Map) return empty;
    final positions = <String, Offset>{};
    final sizes = <String, Size>{};
    final p = json['positions'];
    if (p is Map) {
      p.forEach((id, v) {
        if (v is Map && v['x'] is num && v['y'] is num) {
          positions['$id'] = Offset((v['x'] as num).toDouble(), (v['y'] as num).toDouble());
        }
      });
    }
    final s = json['sizes'];
    if (s is Map) {
      s.forEach((id, v) {
        if (v is Map && v['width'] is num && v['height'] is num) {
          sizes['$id'] = Size((v['width'] as num).toDouble(), (v['height'] as num).toDouble());
        }
      });
    }
    return BoardLayout(positions: positions, sizes: sizes);
  }

  BoardLayout withPosition(String classId, Offset position) =>
      BoardLayout(positions: {...positions, classId: position}, sizes: sizes);

  /// Para servidores sin `GET /boards/:id/state`: una rejilla de tres columnas.
  factory BoardLayout.grid(List<UmlClass> classes) => BoardLayout(
    positions: {
      for (var i = 0; i < classes.length; i++) classes[i].id: Offset(40.0 + (i % 3) * 300, 40.0 + (i ~/ 3) * 260),
    },
  );
}

/// Lo que devuelve `GET /boards/:id/state`: modelo y layout vivos.
class BoardState {
  const BoardState(this.model, this.layout);
  final SemanticModel model;
  final BoardLayout layout;

  factory BoardState.fromJson(Map<String, dynamic> json) =>
      BoardState(SemanticModel.fromJson(json['semantic']), BoardLayout.fromJson(json['layout']));
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
  'CREATE_CLASS' => 'creó una clase',
  'RENAME_CLASS' => 'renombró una clase',
  'DELETE_CLASS' => 'eliminó una clase',
  'MOVE_CLASS' => 'movió una clase',
  'ADD_ATTRIBUTE' => 'agregó un atributo',
  'UPDATE_ATTRIBUTE' => 'modificó un atributo',
  'DELETE_ATTRIBUTE' => 'eliminó un atributo',
  'CREATE_RELATIONSHIP' => 'creó una relación',
  'UPDATE_RELATIONSHIP' => 'modificó una relación',
  'DELETE_RELATIONSHIP' => 'eliminó una relación',
  'CHANGE_MULTIPLICITY' => 'cambió una multiplicidad',
  _ => 'hizo un cambio',
};
