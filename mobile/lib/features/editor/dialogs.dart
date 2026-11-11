import 'package:flutter/material.dart';

import '../../core/ui.dart';
import 'model.dart';

class AttributeInput {
  AttributeInput(this.name, this.type, this.primaryKey, this.nullable, this.unique);
  final String name;
  final String type;
  final bool primaryKey;
  final bool nullable;
  final bool unique;
}

/// Desplegable con la etiqueta encima, como los `<label>` de la web.
Widget _labeled(String label, Widget field) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [FieldLabel(label), field],
    );

Widget _choice<T>({
  required T value,
  required List<(T, String)> options,
  required void Function(T) onChanged,
}) =>
    DropdownButtonFormField<T>(
      initialValue: value,
      isExpanded: true,
      items: [for (final (v, label) in options) DropdownMenuItem(value: v, child: Text(label))],
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
    );

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
  String? error;
  return showDialog<AttributeInput>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) {
        void save() {
          final n = name.text.trim();
          if (n.isEmpty) return set(() => error = 'Escribe el nombre del atributo.');
          Navigator.pop(ctx, AttributeInput(n, type, pk, nullable, unique));
        }

        return AlertDialog(
          title: Text(title),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _labeled(
                  'Nombre del atributo',
                  TextField(
                    controller: name,
                    autofocus: current == null,
                    decoration: InputDecoration(hintText: 'email', errorText: error),
                    onSubmitted: (_) => save(),
                  ),
                ),
                const SizedBox(height: 14),
                _labeled(
                  'Tipo',
                  _choice(
                    value: type,
                    options: [for (final t in conceptualTypes) (t, t)],
                    onChanged: (v) => set(() => type = v),
                  ),
                ),
                const SizedBox(height: 6),
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
                  subtitle: pk ? const Text('Una clave primaria nunca es nula.') : null,
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
            FilledButton(onPressed: save, child: const Text('Guardar')),
          ],
        );
      },
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
  final classOptions = [for (final c in classes) (c.id, c.name)];
  final multOptions = [for (final m in multiplicities) (m, m)];
  return showDialog<RelationshipInput>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) {
        // La generalización no lleva multiplicidades: en UML no tienen sentido.
        final general = kind == 'GENERALIZATION';
        return AlertDialog(
          title: const Text('Nueva relación'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _labeled(
                  'Tipo',
                  _choice(
                    value: kind,
                    options: [for (final e in relationshipKinds.entries) (e.key, e.value)],
                    onChanged: (v) => set(() => kind = v),
                  ),
                ),
                const SizedBox(height: 14),
                _labeled(
                  general ? 'Subclase' : 'Origen',
                  _choice(value: source, options: classOptions, onChanged: (v) => set(() => source = v)),
                ),
                if (!general) ...[
                  const SizedBox(height: 14),
                  _labeled('Multiplicidad del origen',
                      _choice(value: sm, options: multOptions, onChanged: (v) => set(() => sm = v))),
                ],
                const SizedBox(height: 14),
                _labeled(
                  general ? 'Superclase' : 'Destino',
                  _choice(value: target, options: classOptions, onChanged: (v) => set(() => target = v)),
                ),
                if (!general) ...[
                  const SizedBox(height: 14),
                  _labeled('Multiplicidad del destino',
                      _choice(value: tm, options: multOptions, onChanged: (v) => set(() => tm = v))),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
            FilledButton(
              onPressed: () => Navigator.pop(
                ctx,
                RelationshipInput(kind, source, target, general ? '1' : sm, general ? '1' : tm),
              ),
              child: const Text('Crear'),
            ),
          ],
        );
      },
    ),
  );
}

Future<(String, String)?> editMultiplicities(BuildContext context, UmlRelationship r) {
  var sm = r.sourceMultiplicity;
  var tm = r.targetMultiplicity;
  final options = [for (final m in multiplicities) (m, m)];
  return showDialog<(String, String)>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => AlertDialog(
        title: const Text('Multiplicidades'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _labeled('Origen', _choice(value: sm, options: options, onChanged: (v) => set(() => sm = v))),
            const SizedBox(height: 14),
            _labeled('Destino', _choice(value: tm, options: options, onChanged: (v) => set(() => tm = v))),
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
