import 'package:flutter/material.dart';

import 'model.dart';

class AttributeInput {
  AttributeInput(this.name, this.type, this.primaryKey, this.nullable, this.unique);
  final String name;
  final String type;
  final bool primaryKey;
  final bool nullable;
  final bool unique;
}

Future<AttributeInput?> editAttribute(
  BuildContext context, {
  required String title,
  UmlAttribute? current,
}) {
  final name = TextEditingController(text: current?.name ?? '');
  var type = current?.type ?? 'String';
  var pk = current?.primaryKey ?? false;
  var nullable = current?.nullable ?? true;
  var unique = current?.unique ?? false;
  return showDialog<AttributeInput>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => AlertDialog(
        title: Text(title),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                autofocus: true,
                decoration: const InputDecoration(labelText: 'Nombre del campo'),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: type,
                decoration: const InputDecoration(labelText: 'Tipo'),
                items: [for (final t in conceptualTypes) DropdownMenuItem(value: t, child: Text(t))],
                onChanged: (v) => set(() => type = v ?? type),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Clave primaria'),
                value: pk,
                onChanged: (v) => set(() {
                  pk = v;
                  if (v) nullable = false;
                }),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Admite nulos'),
                value: nullable,
                onChanged: pk ? null : (v) => set(() => nullable = v),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Único'),
                value: unique,
                onChanged: (v) => set(() => unique = v),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () {
              final n = name.text.trim();
              if (n.isEmpty) return;
              Navigator.pop(ctx, AttributeInput(n, type, pk, nullable, unique));
            },
            child: const Text('Guardar'),
          ),
        ],
      ),
    ),
  );
}

class RelationshipInput {
  RelationshipInput(this.kind, this.sourceId, this.targetId, this.sourceMultiplicity, this.targetMultiplicity);
  final String kind;
  final String sourceId;
  final String targetId;
  final String sourceMultiplicity;
  final String targetMultiplicity;
}

Future<RelationshipInput?> editRelationship(BuildContext context, List<UmlClass> classes) {
  var kind = 'ASSOCIATION';
  var source = classes[0].id;
  var target = classes[1].id;
  var sm = '1';
  var tm = '0..*';
  Widget classDropdown(String label, String value, void Function(String) onChanged) =>
      DropdownButtonFormField<String>(
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(labelText: label),
        items: [for (final c in classes) DropdownMenuItem(value: c.id, child: Text(c.name))],
        onChanged: (v) => onChanged(v ?? value),
      );
  Widget multDropdown(String label, String value, void Function(String) onChanged) =>
      DropdownButtonFormField<String>(
        initialValue: value,
        decoration: InputDecoration(labelText: label),
        items: [for (final m in multiplicities) DropdownMenuItem(value: m, child: Text(m))],
        onChanged: (v) => onChanged(v ?? value),
      );
  return showDialog<RelationshipInput>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => AlertDialog(
        title: const Text('Nueva relación'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: kind,
                decoration: const InputDecoration(labelText: 'Tipo'),
                items: [
                  for (final e in relationshipKinds.entries)
                    DropdownMenuItem(value: e.key, child: Text(e.value)),
                ],
                onChanged: (v) => set(() => kind = v ?? kind),
              ),
              const SizedBox(height: 12),
              classDropdown('Origen', source, (v) => set(() => source = v)),
              const SizedBox(height: 12),
              multDropdown('Multiplicidad origen', sm, (v) => set(() => sm = v)),
              const SizedBox(height: 12),
              classDropdown('Destino', target, (v) => set(() => target = v)),
              const SizedBox(height: 12),
              multDropdown('Multiplicidad destino', tm, (v) => set(() => tm = v)),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, RelationshipInput(kind, source, target, sm, tm)),
            child: const Text('Crear'),
          ),
        ],
      ),
    ),
  );
}

Future<(String, String)?> editMultiplicities(BuildContext context, UmlRelationship r) {
  var sm = r.sourceMultiplicity;
  var tm = r.targetMultiplicity;
  return showDialog<(String, String)>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => AlertDialog(
        title: const Text('Multiplicidades'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: sm,
              decoration: const InputDecoration(labelText: 'Origen'),
              items: [for (final m in multiplicities) DropdownMenuItem(value: m, child: Text(m))],
              onChanged: (v) => set(() => sm = v ?? sm),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: tm,
              decoration: const InputDecoration(labelText: 'Destino'),
              items: [for (final m in multiplicities) DropdownMenuItem(value: m, child: Text(m))],
              onChanged: (v) => set(() => tm = v ?? tm),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, (sm, tm)), child: const Text('Guardar')),
        ],
      ),
    ),
  );
}
