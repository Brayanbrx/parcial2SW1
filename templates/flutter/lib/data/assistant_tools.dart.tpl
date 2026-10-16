import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:uuid/uuid.dart';
import '../domain/assistant_ports.dart';
import '../domain/proposal.dart';
import '../domain/schema.dart';
import 'repository.dart';

/// Read-only tools. Writes are performed exclusively by the confirmation use case.
class LocalAssistantTools implements AssistantTools {
  final Repository repository;
  final void Function() checkActive;
  final Map<String, Map<String, dynamic>> _observed = {};
  static const scanLimit = 5000;
  LocalAssistantTools(this.repository, this.checkActive);

  @override
  List<Map<String, dynamic>> get catalog => repository.schema.resources
      .map(
        (r) => {
          'resource': r.resource,
          'name': r.className,
          'primaryKey': r.primaryKey,
          'primaryKeyMutable': false,
          'fields': [
            for (final field in r.fields.take(24))
              {
                'name': field.name,
                'type': field.javaType,
                'required': !field.nullable,
              },
          ],
          if (r.fields.length > 24) 'moreFields': 'Usa describe_resource',
        },
      )
      .toList();

  @override
  Future<Map<String, dynamic>> execute(
    String name,
    Map<String, dynamic> arguments,
  ) async {
    checkActive();
    try {
      final allowed = switch (name) {
        'describe_resource' => ['resource'],
        'get_record' => ['resource', 'id'],
        'search_records' => ['resource', 'filters', 'limit', 'cursor'],
        'aggregate_records' => ['resource', 'filters', 'operation', 'field'],
        'prepare_change' => ['resource', 'action', 'id', 'data'],
        _ => throw const FormatException('Herramienta desconocida'),
      };
      if (arguments.keys.any((k) => !allowed.contains(k)))
        throw const FormatException('Argumento desconocido');
      final resourceName = arguments['resource'];
      final resource = repository.schema.resources
          .where((r) => r.resource == resourceName)
          .firstOrNull;
      if (resource == null)
        throw const FormatException('Recurso fuera del contrato');
      dynamic data;
      var complete = true;
      String? revision;
      String? nextCursor;
      if (name == 'describe_resource') {
        data = {
          'resource': resource.resource,
          'primaryKey': resource.primaryKey,
          'fields': [
            for (final f in resource.fields)
              {
                'name': f.name,
                'type': f.javaType,
                'nullable': f.nullable,
                if (f.references != null) 'references': f.references,
                if (f.maxLength != null) 'maxLength': f.maxLength,
                if (f.precision != null) 'precision': f.precision,
                if (f.scale != null) 'scale': f.scale,
              },
          ],
        };
      } else if (name == 'get_record') {
        final row = await _read(resource, arguments['id']);
        checkActive();
        if (row != null) _remember(resource, row);
        data = {'record': row};
      } else if (name == 'prepare_change') {
        data = await _prepare(resource, arguments);
      } else {
        final filters = _filters(resource, arguments['filters']);
        final snapshot = await repository.local.db.transaction(
          (tx) async => tx.query(
            'records',
            columns: ['id', 'payload'],
            where: 'resource=? AND deleted=0',
            whereArgs: [resource.resource],
            orderBy: 'id',
            limit: scanLimit + 1,
          ),
        );
        checkActive();
        complete = snapshot.length <= scanLimit;
        final encoded = jsonEncode(snapshot);
        if (encoded.length > 2000000)
          throw const FormatException(
            'La coleccion es demasiado grande para esta consulta local',
          );
        revision = sha256.convert(utf8.encode(encoded)).toString();
        final rows = <Map<String, dynamic>>[];
        for (final stored in snapshot.take(scanLimit)) {
          checkActive();
          final row = resource.normalize(
            Map<String, dynamic>.from(jsonDecode(stored['payload'] as String)),
          );
          if (filters.every((f) => _matches(row[f['field']], f))) rows.add(row);
        }
        if (name == 'aggregate_records') {
          data = _aggregate(resource, arguments, rows, complete);
        } else {
          final limit = arguments['limit'] ?? 20;
          if (limit is! int || limit < 1 || limit > 50)
            throw const FormatException('limit debe ser de 1 a 50');
          final signature = sha256
              .convert(
                utf8.encode(jsonEncode([resource.resource, filters, revision])),
              )
              .toString();
          var offset = 0;
          if (arguments.containsKey('cursor')) {
            try {
              final cursor = jsonDecode(
                utf8.decode(base64Url.decode(arguments['cursor'] as String)),
              );
              if (cursor is! Map ||
                  cursor['signature'] != signature ||
                  cursor['offset'] is! int) {
                throw const FormatException('Cursor vencido');
              }
              offset = cursor['offset'];
              if (offset < 0 || offset > rows.length)
                throw const FormatException('Cursor fuera de rango');
            } catch (_) {
              throw const FormatException(
                'Cursor invalido o datos cambiaron; repite sin cursor',
              );
            }
          }
          final page = <Map<String, dynamic>>[];
          var size = 0;
          for (final row in rows.skip(offset).take(limit)) {
            final bytes = utf8.encode(jsonEncode(row)).length;
            if (bytes > 2400 && page.isEmpty)
              throw const FormatException(
                'Registro demasiado extenso para el contexto del modelo',
              );
            if (size + bytes > 2400) break;
            page.add(row);
            size += bytes;
            _remember(resource, row);
          }
          final next = offset + page.length;
          if (next < rows.length)
            nextCursor = base64Url.encode(
              utf8.encode(jsonEncode({'signature': signature, 'offset': next})),
            );
          data = {
            'records': page,
            'matchedInScan': rows.length,
            'scanned': snapshot.length.clamp(0, scanLimit),
          };
        }
      }
      checkActive();
      if (utf8.encode(jsonEncode(data)).length > 5000)
        throw const FormatException(
          'Resultado demasiado extenso; acota el recurso',
        );
      return {
        'ok': true,
        'data': data,
        'coverage': {'source': 'local', 'complete': complete},
        if (revision != null) 'revision': revision,
        if (nextCursor != null) 'nextCursor': nextCursor,
      };
    } on _TerminalToolError catch (error) {
      return {
        'ok': false,
        'error': {
          'code': error.code,
          'message': error.message,
          'retryable': false,
        },
      };
    } on FormatException catch (error) {
      return {
        'ok': false,
        'error': {
          'code': 'invalid_arguments',
          'message': error.message,
          'retryable': true,
        },
      };
    }
  }

  void _remember(ResourceSpec resource, Map<String, dynamic> row) {
    if (utf8.encode(jsonEncode(row)).length > 5000)
      throw const FormatException('Registro demasiado extenso');
    _observed['${resource.resource}/${resource.key.identity(row[resource.primaryKey])}'] =
        Map.from(row);
  }

  dynamic _typed(FieldSpec field, dynamic value) {
    if (value == null) return null;
    final type = field.javaType;
    if (['Integer', 'Long'].contains(type) && value is! int ||
        type == 'BigDecimal' && (value is! num || !value.isFinite) ||
        type == 'Boolean' && value is! bool ||
        !field.numeric && type != 'Boolean' && value is! String) {
      throw FormatException('Tipo incorrecto para ${field.name}: $type');
    }
    if (type == 'UUID' &&
        !RegExp(
          r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
        ).hasMatch(value as String)) {
      throw const FormatException('UUID invalido');
    }
    if (['LocalDate', 'LocalDateTime'].contains(type) &&
        DateTime.tryParse(value as String) == null) {
      throw const FormatException('Fecha invalida');
    }
    return field.normalize(value);
  }

  Future<Map<String, dynamic>?> _read(ResourceSpec resource, dynamic id) async {
    if (id == null) throw const FormatException('Falta id');
    final key = resource.key.identity(_typed(resource.key, id));
    final rows = await repository.local.db.query(
      'records',
      columns: ['payload'],
      where: resource.key.javaType == 'UUID'
          ? 'resource=? AND lower(id)=? AND deleted=0'
          : 'resource=? AND id=? AND deleted=0',
      whereArgs: [resource.resource, key],
      limit: 1,
    );
    checkActive();
    return rows.isEmpty
        ? null
        : resource.normalize(
            Map<String, dynamic>.from(
              jsonDecode(rows.single['payload'] as String),
            ),
          );
  }

  List<Map<String, dynamic>> _filters(ResourceSpec resource, dynamic raw) {
    if (raw == null) return [];
    if (raw is! List || raw.length > 8)
      throw const FormatException('filters debe tener hasta 8 condiciones');
    return raw.map((value) {
      if (value is! Map ||
          value.keys.any((k) => !['field', 'op', 'value'].contains(k)))
        throw const FormatException('Filtro invalido');
      final f = resource.fields
          .where((f) => f.name == value['field'])
          .firstOrNull;
      if (f == null)
        throw FormatException(
          'Campo de filtro desconocido. Campos validos: ${resource.fields.map((f) => f.name).join(', ')}',
        );
      final op = value['op'];
      if (!['eq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_null'].contains(op))
        throw const FormatException('Operador desconocido');
      if (op == 'contains' && f.javaType != 'String')
        throw const FormatException('contains requiere texto');
      if (op == 'is_null') {
        if (value.containsKey('value') && value['value'] is! bool)
          throw const FormatException('is_null acepta un booleano');
        return <String, dynamic>{
          'field': f.name,
          'op': op,
          'value': value['value'] ?? true,
        };
      }
      if (!value.containsKey('value'))
        throw const FormatException('Falta value en filtro');
      var supplied = value['value'];
      // Numeric strings from tool adapters are unambiguous only in read filters.
      // Do not coerce identifiers or proposed writes.
      if (f.javaType == 'BigDecimal' &&
          supplied is String &&
          RegExp(r'^-?(0|[1-9][0-9]*)(\.[0-9]+)?$').hasMatch(supplied)) {
        supplied = num.tryParse(supplied);
      }
      final v = _typed(f, supplied);
      if (op != 'eq' && (v == null || v is bool))
        throw const FormatException('Comparacion no soportada');
      return <String, dynamic>{'field': f.name, 'op': op, 'value': v};
    }).toList();
  }

  bool _matches(dynamic value, Map<String, dynamic> filter) {
    final wanted = filter['value'];
    final op = filter['op'];
    if (op == 'is_null') return (value == null) == wanted;
    if (op == 'eq') return value == wanted;
    if (value == null) return false;
    if (op == 'contains')
      return value.toString().toLowerCase().contains(
        wanted.toString().toLowerCase(),
      );
    final cmp = value is num && wanted is num
        ? value.compareTo(wanted)
        : value.toString().compareTo(wanted.toString());
    return switch (op) {
      'gt' => cmp > 0,
      'gte' => cmp >= 0,
      'lt' => cmp < 0,
      'lte' => cmp <= 0,
      _ => false,
    };
  }

  Map<String, dynamic> _aggregate(
    ResourceSpec resource,
    Map<String, dynamic> args,
    List<Map<String, dynamic>> rows,
    bool complete,
  ) {
    final op = args['operation'];
    if (!['count', 'sum', 'min', 'max', 'avg'].contains(op))
      throw const FormatException('Agregacion desconocida');
    if (!complete)
      return {
        'operation': op,
        'value': null,
        'message':
            'Se supero el limite de 5000 registros; no es un total completo.',
      };
    if (op == 'count') {
      // Counting a non-null primary key is exactly counting rows. Other fields
      // can contain nulls and must not silently change the requested meaning.
      if (args.containsKey('field') && args['field'] != resource.primaryKey)
        throw const FormatException('count cuenta registros; omite field');
      return {'operation': op, 'value': rows.length, 'records': rows.length};
    }
    final field = resource.fields
        .where((f) => f.name == args['field'])
        .firstOrNull;
    if (field == null || !field.numeric)
      throw const FormatException('Se requiere un campo numerico');
    // Decimal arithmetic over the serialized local values, never binary sums.
    final numbers = rows
        .where((r) => r[field.name] != null)
        .map((r) => _Decimal.parse(r[field.name].toString()))
        .toList();
    if (numbers.isEmpty)
      return {
        'operation': op,
        'field': field.name,
        'value': null,
        'nonNull': 0,
      };
    var scale = field.scale ?? 0;
    if (scale < 0 || scale > 100)
      throw const FormatException('Escala decimal fuera de limites');
    for (final number in numbers) {
      if (number.scale > scale) scale = number.scale;
    }
    final units = numbers.map((n) => n.at(scale)).toList();
    final sum = units.fold(BigInt.zero, (a, b) => a + b);
    final value = switch (op) {
      'min' => _Decimal(units.reduce((a, b) => a < b ? a : b), scale),
      'max' => _Decimal(units.reduce((a, b) => a > b ? a : b), scale),
      'avg' => _Decimal(sum, scale).divide(numbers.length, field.scale ?? 6),
      _ => _Decimal(sum, scale),
    };
    return {
      'operation': op,
      'field': field.name,
      'value': value.toString(),
      'nonNull': numbers.length,
      if (op == 'avg') 'rounding': 'half_away_from_zero',
      'representation': 'decimal de los valores almacenados localmente',
    };
  }

  Future<Map<String, dynamic>> _prepare(
    ResourceSpec resource,
    Map<String, dynamic> args,
  ) async {
    final action = args['action'];
    if (!['CREATE', 'UPDATE', 'DELETE'].contains(action))
      throw const FormatException('Accion desconocida');
    if (action != 'DELETE' && args['data'] is! Map)
      throw const FormatException('data debe ser un objeto');
    if (action == 'DELETE' && args.containsKey('data'))
      throw const FormatException('DELETE no admite data');
    if (action == 'CREATE' && args.containsKey('id'))
      throw const FormatException('En CREATE la clave va en data');
    Map<String, dynamic>? expected;
    dynamic id;
    if (action != 'CREATE') {
      id = _typed(resource.key, args['id']);
      if (id == null) throw const FormatException('Falta id');
      expected = _observed['${resource.resource}/${resource.key.identity(id)}'];
      if (expected == null)
        throw const FormatException(
          'Consulta primero el registro con get_record o search_records',
        );
      final current = await _read(resource, id);
      if (jsonEncode(current) != jsonEncode(expected))
        throw const FormatException('El registro cambio; vuelve a consultarlo');
      if (action == 'UPDATE' &&
          (args['data'] as Map).containsKey(resource.primaryKey)) {
        final nextKey = _typed(resource.key, args['data'][resource.primaryKey]);
        if (nextKey == null ||
            resource.key.identity(nextKey) != resource.key.identity(id)) {
          throw _TerminalToolError(
            'immutable_primary_key',
            'No se puede cambiar la clave primaria ${resource.primaryKey} del registro $id. El registro existe y no se modifico. Puedes editar sus otros campos.',
          );
        }
      }
    }
    final proposal = Proposal.parse(
      jsonEncode({
        'action': action,
        'resource': resource.resource,
        if (id != null) 'id': id,
        if (args.containsKey('data')) 'data': args['data'],
      }),
      repository.schema,
      records: expected == null ? [] : [expected],
    );
    if (action == 'CREATE' &&
        await _read(resource, proposal.data![resource.primaryKey]) != null) {
      throw const FormatException('Ya existe esa clave');
    }
    if (action == 'UPDATE' &&
        resource.fields.every(
          (field) => proposal.data![field.name] == expected![field.name],
        )) {
      throw const _TerminalToolError(
        'no_changes',
        'El cambio propuesto no modifica ningun campo. No se ha guardado nada.',
      );
    }
    checkActive();
    return {
      'draftId': const Uuid().v4(),
      'proposal': proposal.toJson(),
      'expected': expected,
    };
  }
}

class _TerminalToolError implements Exception {
  final String code, message;
  const _TerminalToolError(this.code, this.message);
}

class _Decimal {
  final BigInt units;
  final int scale;
  _Decimal(this.units, this.scale);
  factory _Decimal.parse(String input) {
    final match = RegExp(
      r'^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$',
    ).firstMatch(input);
    if (match == null) throw const FormatException('Numero decimal invalido');
    final fraction = match[3] ?? '';
    final exponent = int.parse(match[4] ?? '0');
    if (exponent.abs() > 100 || fraction.length > 100)
      throw const FormatException('Decimal fuera de limites');
    final units = BigInt.parse('${match[1]}${match[2]}$fraction');
    final scale = fraction.length - exponent;
    return scale >= 0
        ? _Decimal(units, scale)
        : _Decimal(units * BigInt.from(10).pow(-scale), 0);
  }
  BigInt at(int target) => units * BigInt.from(10).pow(target - scale);
  _Decimal divide(int count, int target) {
    if (target < 0 || target > 100)
      throw const FormatException('Escala fuera de limites');
    final numerator = target >= scale ? at(target) : units;
    final denominator =
        BigInt.from(count) *
        BigInt.from(10).pow(target < scale ? scale - target : 0);
    var quotient = numerator ~/ denominator;
    if ((numerator.remainder(denominator)).abs() * BigInt.two >= denominator) {
      quotient += numerator.isNegative ? -BigInt.one : BigInt.one;
    }
    return _Decimal(quotient, target);
  }

  @override
  String toString() {
    final digits = units.abs().toString().padLeft(scale + 1, '0');
    final body = scale == 0
        ? digits
        : '${digits.substring(0, digits.length - scale)}.${digits.substring(digits.length - scale)}';
    return '${units.isNegative ? '-' : ''}$body';
  }
}
