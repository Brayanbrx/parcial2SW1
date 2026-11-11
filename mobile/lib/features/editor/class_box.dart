import 'package:flutter/material.dart';

import '../../core/theme.dart';
import 'geometry.dart';
import 'model.dart';

/// Caja UML de una clase, como `ClassNode.tsx`: rectángulo de esquinas rectas,
/// compartimento del nombre centrado y en negrita, y `- nombre: Tipo` por fila.
///
/// Con [height] se ajusta a la medida del lienzo; sin él crece con su
/// contenido (lista de tablas).
class ClassBox extends StatelessWidget {
  const ClassBox({
    super.key,
    required this.umlClass,
    this.width,
    this.height,
    this.selected = false,
    this.lifted = false,
  });

  final UmlClass umlClass;
  final double? width;
  final double? height;
  final bool selected;

  /// Mientras se arrastra: sombra más marcada, como una tarjeta levantada.
  final bool lifted;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    final rows = Padding(
      padding: const EdgeInsets.symmetric(vertical: kListPadding / 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (umlClass.attributes.isEmpty)
            SizedBox(
              height: kRowHeight,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'sin atributos',
                    style: TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic, color: c.claseTenue),
                  ),
                ),
              ),
            ),
          for (final a in umlClass.attributes) _AttributeRow(a),
        ],
      ),
    );

    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: c.claseCuerpo,
        border: Border.all(color: selected ? c.claseSeleccion : c.claseBorde, width: selected ? 1.5 : 1),
        boxShadow: [
          if (selected) BoxShadow(color: c.claseSeleccion.withValues(alpha: 0.35), spreadRadius: 2),
          BoxShadow(
            color: lifted ? Colors.black.withValues(alpha: 0.22) : c.sombra,
            blurRadius: lifted ? 18 : 2,
            offset: Offset(0, lifted ? 8 : 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: height == null ? MainAxisSize.min : MainAxisSize.max,
        children: [
          Container(
            constraints: const BoxConstraints(minHeight: kHeaderHeight),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: BoxDecoration(
              color: c.claseCabecera,
              border: Border(bottom: BorderSide(color: c.claseBorde)),
            ),
            alignment: Alignment.center,
            child: Text.rich(
              TextSpan(children: [
                TextSpan(
                  text: umlClass.name,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.claseTexto),
                ),
                if (umlClass.technicalDiffers)
                  TextSpan(
                    text: '  ${umlClass.databaseName}',
                    style: TextStyle(fontSize: 10, fontFamily: 'monospace', color: c.claseTenue),
                  ),
              ]),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          // En el lienzo la caja mide lo que dice el layout: lo que no cabe
          // se recorta, como hace la web con `overflow: hidden`.
          if (height == null)
            rows
          else
            Expanded(
              child: ClipRect(
                child: SingleChildScrollView(physics: const NeverScrollableScrollPhysics(), child: rows),
              ),
            ),
        ],
      ),
    );
  }
}

class _AttributeRow extends StatelessWidget {
  const _AttributeRow(this.attribute);
  final UmlAttribute attribute;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    final a = attribute;
    final dim = TextStyle(color: c.claseTenue);
    return SizedBox(
      height: kRowHeight,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 7),
        child: Row(
          children: [
            SizedBox(width: 12, child: Text('-', textAlign: TextAlign.center, style: dim)),
            const SizedBox(width: 4),
            Expanded(
              child: Text.rich(
                TextSpan(
                  style: TextStyle(fontSize: 12.5, color: c.claseTexto),
                  children: [
                    TextSpan(text: a.name),
                    TextSpan(text: ': ${a.type}', style: dim),
                    if (!a.nullable && !a.primaryKey)
                      TextSpan(
                        text: ' *',
                        style: TextStyle(color: c.avisoTexto, fontWeight: FontWeight.w600),
                      ),
                  ],
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (a.primaryKey)
              Text('PK', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w600, color: c.avisoTexto, letterSpacing: 0.2))
            else if (a.unique)
              Text('U', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w600, color: c.claseTenue)),
          ],
        ),
      ),
    );
  }
}
