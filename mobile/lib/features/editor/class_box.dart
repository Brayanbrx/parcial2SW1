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
          if (umlClass.kind == 'ENUMERATION')
            for (final literal in umlClass.literals)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Text(literal, style: TextStyle(fontSize: 12.5, color: c.claseTexto)),
              ),
          for (final a in umlClass.attributes) _AttributeRow(a),
          if (umlClass.operations.isNotEmpty) Divider(height: 8, color: c.claseBorde),
          for (final operation in umlClass.operations)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Text(
                operation.notation,
                style: TextStyle(
                  fontSize: 12.5,
                  color: c.claseTexto,
                  fontStyle: operation.isAbstract ? FontStyle.italic : FontStyle.normal,
                  decoration: operation.isStatic ? TextDecoration.underline : TextDecoration.none,
                ),
              ),
            ),
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
              TextSpan(
                children: [
                  TextSpan(
                    text: '${umlClass.keyword == null ? '' : '«${umlClass.keyword}»\n'}${umlClass.name}',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      fontStyle: umlClass.isAbstract ? FontStyle.italic : FontStyle.normal,
                      color: c.claseTexto,
                    ),
                  ),
                ],
              ),
              textAlign: TextAlign.center,
              maxLines: 2,
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
    return SizedBox(
      height: kRowHeight,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: Text(
          a.notation,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 12.5,
            color: c.claseTexto,
            decoration: a.isStatic ? TextDecoration.underline : TextDecoration.none,
          ),
        ),
      ),
    );
  }
}
