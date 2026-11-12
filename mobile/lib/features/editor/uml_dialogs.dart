import 'package:flutter/material.dart';
import 'model.dart';

Future<Map<String, dynamic>?> editRelationshipProperties(BuildContext context, UmlRelationship r) {
  final fields = <String, dynamic>{
    'name': r.name ?? '',
    'sourceRoleName': r.sourceRole ?? '',
    'targetRoleName': r.targetRole ?? '',
    'sourceNavigability': r.sourceNavigability ?? 'unspecified',
    'targetNavigability': r.targetNavigability ?? 'unspecified',
    'sourceMultiplicity': r.sourceMultiplicity,
    'targetMultiplicity': r.targetMultiplicity,
  };
  String? error;
  return showDialog<Map<String, dynamic>>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => AlertDialog(
        title: const Text('Propiedades de relación'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (r.associationClassId == null)
                TextFormField(
                  initialValue: fields['name'] as String,
                  decoration: const InputDecoration(labelText: 'Nombre de relación'),
                  onChanged: (v) => fields['name'] = v,
                ),
              if (r.isStructural)
                for (final side in ['source', 'target']) ...[
                  Text(side == 'source' ? 'Origen' : 'Destino'),
                  TextFormField(
                    initialValue: fields['${side}Multiplicity'] as String,
                    decoration: const InputDecoration(labelText: 'Multiplicidad'),
                    onChanged: (v) => fields['${side}Multiplicity'] = v.trim(),
                  ),
                  TextFormField(
                    initialValue: fields['${side}RoleName'] as String,
                    decoration: const InputDecoration(labelText: 'Nombre del rol'),
                    onChanged: (v) => fields['${side}RoleName'] = v.trim(),
                  ),
                  DropdownButtonFormField<String>(
                    initialValue: fields['${side}Navigability'] as String,
                    decoration: const InputDecoration(labelText: 'Navegabilidad'),
                    items: const [
                      DropdownMenuItem(value: 'unspecified', child: Text('Sin especificar')),
                      DropdownMenuItem(value: 'navigable', child: Text('Navegable')),
                      DropdownMenuItem(value: 'nonNavigable', child: Text('No navegable')),
                    ],
                    onChanged: (v) => fields['${side}Navigability'] = v,
                  ),
                ],
              if (error != null) Text(error!, style: TextStyle(color: Theme.of(ctx).colorScheme.error)),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () {
              if (r.isStructural &&
                  (!validMultiplicity(fields['sourceMultiplicity'] as String) ||
                      !validMultiplicity(fields['targetMultiplicity'] as String))) {
                set(() => error = 'Revisa las multiplicidades.');
                return;
              }
              Navigator.pop(ctx, fields);
            },
            child: const Text('Guardar'),
          ),
        ],
      ),
    ),
  );
}

Future<Map<String, dynamic>?> editClassifier(BuildContext context, UmlClass c, {bool associationClass = false}) {
  var kind = c.kind;
  var abstract = c.isAbstract;
  var literals = c.literals.join('\n');
  return showDialog<Map<String, dynamic>>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => AlertDialog(
        title: const Text('Propiedades UML'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: kind,
                decoration: const InputDecoration(labelText: 'Tipo de elemento'),
                items: [for (final e in classifierKinds.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
                onChanged: associationClass ? null : (v) => set(() => kind = v!),
              ),
              if (kind == 'CLASS' || kind == 'DATA_TYPE')
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Abstracta'),
                  value: abstract,
                  onChanged: (v) => set(() => abstract = v),
                ),
              if (kind == 'ENUMERATION')
                TextFormField(
                  initialValue: literals,
                  minLines: 3,
                  maxLines: 6,
                  decoration: const InputDecoration(labelText: 'Literales (uno por línea)'),
                  onChanged: (v) => literals = v,
                ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, <String, dynamic>{
              'kind': kind,
              'isAbstract': kind == 'INTERFACE' || kind == 'ENUMERATION' ? false : abstract,
              'literals': kind == 'ENUMERATION'
                  ? literals.split('\n').map((s) => s.trim()).where((s) => s.isNotEmpty).toSet().toList()
                  : <String>[],
            }),
            child: const Text('Guardar'),
          ),
        ],
      ),
    ),
  );
}

Future<Map<String, dynamic>?> editOperation(BuildContext context, UmlClass c, [UmlOperation? current]) {
  final operation = <String, dynamic>{
    'id': current?.id ?? newId(),
    'displayName': current?.name ?? '',
    'visibility': current?.data['visibility'] ?? 'public',
    'isStatic': current?.isStatic ?? false,
    'isAbstract': current?.isAbstract ?? c.kind == 'INTERFACE',
    'returnType': current?.data['returnType'] ?? 'void',
    'returnMultiplicity': current?.data['returnMultiplicity'] ?? '1',
  };
  final parameters = [
    for (final p in (current?.data['parameters'] as List?) ?? []) Map<String, dynamic>.from(p as Map),
  ];
  String? error;
  return showDialog<Map<String, dynamic>>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) {
        Widget text(String label, String key, Map<String, dynamic> object, {String fallback = ''}) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextFormField(
            key: ValueKey('${object['id']}-$key'),
            initialValue: '${object[key] ?? fallback}',
            decoration: InputDecoration(labelText: label),
            onChanged: (v) => object[key] = v.trim(),
          ),
        );
        return AlertDialog(
          title: Text(current == null ? 'Nueva operación' : 'Editar operación'),
          content: SizedBox(
            width: 440,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  text('Nombre de operación', 'displayName', operation),
                  DropdownButtonFormField<String>(
                    initialValue: operation['visibility'] as String,
                    decoration: const InputDecoration(labelText: 'Visibilidad'),
                    items: [
                      for (final e in visibilitySymbols.entries)
                        DropdownMenuItem(value: e.key, child: Text('${e.value} ${e.key}')),
                    ],
                    onChanged: (v) => operation['visibility'] = v,
                  ),
                  text('Tipo de retorno (void: sin retorno)', 'returnType', operation),
                  text('Multiplicidad del retorno', 'returnMultiplicity', operation),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Abstracta'),
                    value: operation['isAbstract'] == true,
                    onChanged: (v) => set(() {
                      operation['isAbstract'] = v;
                      if (v) operation['isStatic'] = false;
                    }),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Estática'),
                    value: operation['isStatic'] == true,
                    onChanged: (v) => set(() {
                      operation['isStatic'] = v;
                      if (v) operation['isAbstract'] = false;
                    }),
                  ),
                  for (final p in parameters)
                    Card(
                      key: ValueKey(p['id']),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          children: [
                            text('Nombre del parámetro', 'name', p),
                            text('Tipo del parámetro', 'type', p),
                            DropdownButtonFormField<String>(
                              initialValue: p['direction'] as String? ?? 'in',
                              decoration: const InputDecoration(labelText: 'Dirección'),
                              items: [
                                for (final d in ['in', 'out', 'inout']) DropdownMenuItem(value: d, child: Text(d)),
                              ],
                              onChanged: (v) => p['direction'] = v,
                            ),
                            text('Multiplicidad', 'multiplicity', p, fallback: '1'),
                            text('Valor predeterminado', 'defaultValue', p),
                            TextButton(
                              onPressed: () => set(() => parameters.remove(p)),
                              child: const Text('Eliminar parámetro'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  TextButton.icon(
                    onPressed: () => set(
                      () => parameters.add({
                        'id': newId(),
                        'name': 'parametro${parameters.length + 1}',
                        'type': 'String',
                        'direction': 'in',
                      }),
                    ),
                    icon: const Icon(Icons.add),
                    label: const Text('Parámetro'),
                  ),
                  if (error != null) Text(error!, style: TextStyle(color: Theme.of(ctx).colorScheme.error)),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
            FilledButton(
              onPressed: () {
                if ((operation['displayName'] as String).isEmpty ||
                    !validMultiplicity(operation['returnMultiplicity'] as String) ||
                    parameters.any(
                      (p) =>
                          '${p['name'] ?? ''}'.isEmpty ||
                          '${p['type'] ?? ''}'.isEmpty ||
                          !validMultiplicity('${p['multiplicity'] ?? '1'}'),
                    )) {
                  set(() => error = 'Revisa los nombres, tipos y multiplicidades.');
                  return;
                }
                if (operation['returnType'] == '') {
                  operation['returnType'] = 'void';
                }
                Navigator.pop(ctx, {...operation, 'parameters': parameters});
              },
              child: const Text('Guardar'),
            ),
          ],
        );
      },
    ),
  );
}
