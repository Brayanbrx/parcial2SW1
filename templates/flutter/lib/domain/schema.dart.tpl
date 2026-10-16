import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:crypto/crypto.dart';

class FieldSpec {
  final String name, javaType;
  final bool nullable, primaryKey;
  final String? references;
  final int? maxLength, precision, scale;
  FieldSpec(Map<String, dynamic> j)
    : name = j['name'],
      javaType = j['javaType'],
      nullable = j['nullable'] == true,
      primaryKey = j['primaryKey'] == true,
      references = j['references'],
      maxLength = j['maxLength'],
      precision = j['precision'],
      scale = j['scale'];
  bool get numeric => ['Integer', 'Long', 'BigDecimal'].contains(javaType);
  dynamic normalize(dynamic value) =>
      javaType == 'UUID' && value is String ? value.toLowerCase() : value;
  String identity(dynamic value) => normalize(value).toString();
  dynamic parse(String text) {
    if (text.trim().isEmpty) return null;
    return switch (javaType) {
      'Integer' || 'Long' => int.parse(text.trim()),
      'BigDecimal' => num.parse(text.trim()),
      'UUID' => text.trim().toLowerCase(),
      'Boolean' => switch (text.trim().toLowerCase()) {
        'true' => true,
        'false' => false,
        _ => throw FormatException('Usa true o false'),
      },
      _ => text.trim(),
    };
  }
}

class ResourceSpec {
  final String className, path, primaryKey;
  final List<FieldSpec> fields;
  ResourceSpec(Map<String, dynamic> j)
    : className = j['className'],
      path = j['path'],
      primaryKey = j['primaryKey'],
      fields = List.unmodifiable(
        (j['fields'] as List).map((f) => FieldSpec(f)),
      );
  FieldSpec get key => fields.firstWhere((f) => f.name == primaryKey);
  String get resource => path.substring('/api/'.length);
  Map<String, dynamic> normalize(Map<String, dynamic> value) => {
    for (final entry in value.entries)
      entry.key: fields
          .firstWhere((f) => f.name == entry.key)
          .normalize(entry.value),
  };
  void validate(Map<String, dynamic> value) {
    for (final name in value.keys) {
      if (!fields.any((f) => f.name == name))
        throw FormatException('Campo desconocido: $name');
    }
    for (final f in fields) {
      final v = value[f.name];
      if (v == null) {
        if (!f.nullable || f.primaryKey)
          throw FormatException('${f.name} es obligatorio');
        continue;
      }
      if ((f.numeric && v is! num) ||
          (f.javaType == 'Boolean' && v is! bool) ||
          (!f.numeric && f.javaType != 'Boolean' && v is! String))
        throw FormatException('Tipo incorrecto: ${f.name}');
      if (['Integer', 'Long'].contains(f.javaType) && v is! int)
        throw FormatException('${f.name} requiere entero');
      if (f.javaType == 'Integer' && (v < -2147483648 || v > 2147483647))
        throw FormatException('${f.name}: entero fuera de rango');
      if (v is num && !v.isFinite)
        throw FormatException('${f.name}: numero invalido');
      if (v is String && !f.nullable && v.trim().isEmpty)
        throw FormatException('${f.name} es obligatorio');
      if (v is String && f.maxLength != null && v.length > f.maxLength!)
        throw FormatException('${f.name}: maximo ${f.maxLength} caracteres');
      if (f.javaType == 'UUID' &&
          !RegExp(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
          ).hasMatch(v))
        throw FormatException('${f.name}: UUID invalido');
      if (f.javaType == 'LocalDate' &&
          (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(v) ||
              DateTime.tryParse(v)?.toIso8601String().substring(0, 10) != v))
        throw FormatException('${f.name}: usa YYYY-MM-DD');
      if (f.javaType == 'LocalDateTime' &&
          (!RegExp(
                r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?$',
              ).hasMatch(v) ||
              DateTime.tryParse(v)?.toIso8601String().substring(0, 19) !=
                  v.substring(0, 19)))
        throw FormatException('${f.name}: usa YYYY-MM-DDTHH:mm:ss sin zona');
    }
  }
}

class AppSchema {
  final Map<String, dynamic> contract;
  final List<ResourceSpec> resources;
  AppSchema(Map<String, dynamic> j)
    : contract = Map<String, dynamic>.from(jsonDecode(jsonEncode(j))),
      resources = List.unmodifiable(
        (j['resources'] as List).map((r) => ResourceSpec(r)),
      );
  String get title => contract['project']?.toString() ?? 'Gestion';
  String get fingerprint =>
      sha256.convert(utf8.encode(jsonEncode(_canonical(contract)))).toString();
  static dynamic _canonical(dynamic value) {
    if (value is Map)
      return {
        for (final key in value.keys.cast<String>().toList()..sort())
          key: _canonical(value[key]),
      };
    if (value is List) return value.map(_canonical).toList();
    return value;
  }

  factory AppSchema.fromRemote(dynamic envelope) {
    if (envelope is! Map || envelope['protocolVersion'] != 1)
      throw FormatException(
        'Backend incompatible: requiere protocolo movil 1. Regenera Android + backend.',
      );
    final j = envelope['contract'];
    if (j is! Map<String, dynamic> ||
        j['schemaVersion'] != 1 ||
        j['project'] is! String ||
        j['resources'] is! List)
      throw FormatException('Contrato de backend invalido');
    final resources = j['resources'] as List;
    if (resources.isEmpty || resources.length > 200)
      throw FormatException('Contrato sin recursos o demasiado grande');
    final paths = <String>{};
    for (final r in resources) {
      if (r is! Map ||
          r['className'] is! String ||
          r['path'] is! String ||
          !RegExp(r'^/api/[a-zA-Z][a-zA-Z0-9_-]*$').hasMatch(r['path']) ||
          !paths.add(r['path']) ||
          r['fields'] is! List)
        throw FormatException('Recurso invalido o duplicado');
      final fields = r['fields'] as List;
      if (fields.isEmpty || fields.length > 200)
        throw FormatException('Lista de campos invalida');
      final names = <String>{};
      var keys = 0;
      for (final f in fields) {
        if (f is! Map ||
            f['name'] is! String ||
            !RegExp(r'^[a-zA-Z_$][a-zA-Z0-9_$]*$').hasMatch(f['name']) ||
            !names.add(f['name']) ||
            ![
              'String',
              'UUID',
              'Integer',
              'Long',
              'BigDecimal',
              'Boolean',
              'LocalDate',
              'LocalDateTime',
            ].contains(f['javaType']) ||
            f['nullable'] is! bool ||
            (f['references'] != null && f['references'] is! String))
          throw FormatException('Campo de contrato invalido');
        for (final limit in ['maxLength', 'precision', 'scale']) {
          if (f[limit] != null && (f[limit] is! int || f[limit] < 0))
            throw FormatException('Restriccion invalida');
        }
        if (f['primaryKey'] == true) {
          keys++;
          if (f['name'] != r['primaryKey'] ||
              !['String', 'UUID', 'Integer', 'Long'].contains(f['javaType']) ||
              f['nullable'] == true)
            throw FormatException('Clave de contrato invalida');
        }
      }
      if (keys != 1) throw FormatException('Cada recurso necesita una clave');
    }
    return AppSchema(j);
  }
  static Future<AppSchema> load() async => AppSchema(
    jsonDecode(await rootBundle.loadString('assets/contract.json')),
  );
  ResourceSpec resource(String name) =>
      resources.firstWhere((r) => r.resource == name);
}
