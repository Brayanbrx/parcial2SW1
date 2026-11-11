import 'package:flutter/material.dart';

import 'theme.dart';

/// Isotipo de la web (`.isotipo` con `IconoDiagrama`): dos cajas unidas sobre
/// un cuadrado del color de acento.
class Isotipo extends StatelessWidget {
  const Isotipo({super.key, this.size = 32});
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: context.uml.acento,
        borderRadius: BorderRadius.circular(size >= 40 ? 8 : 4),
      ),
      alignment: Alignment.center,
      child: CustomPaint(size: Size.square(size * 0.56), painter: _DiagramIconPainter()),
    );
  }
}

/// `IconoDiagrama` (viewBox 24, trazo 1.75): `rect 3,3 8x6`, `rect 13,15 8x6` y
/// el conector `M7 9v5a2 2 0 0 0 2 2h4`.
class _DiagramIconPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final k = size.width / 24;
    canvas.scale(k);
    final paint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.9
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawRRect(RRect.fromLTRBR(3, 3, 11, 9, const Radius.circular(1.5)), paint);
    canvas.drawRRect(RRect.fromLTRBR(13, 15, 21, 21, const Radius.circular(1.5)), paint);
    final path = Path()
      ..moveTo(7, 9)
      ..lineTo(7, 14)
      ..arcToPoint(const Offset(9, 16), radius: const Radius.circular(2), clockwise: false)
      ..lineTo(13, 16);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// «UMLFORGE AI»: versalitas espaciadas, como `.nombre-producto`.
class Wordmark extends StatelessWidget {
  const Wordmark({super.key, this.size = 12});
  final double size;

  @override
  Widget build(BuildContext context) => Text(
        'UMLFORGE AI',
        style: TextStyle(
          fontSize: size,
          fontWeight: FontWeight.w600,
          letterSpacing: size * 0.12,
          color: context.uml.texto,
        ),
      );
}

/// Avatar con iniciales, como `.avatar` de la barra de la web.
class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.name, this.seed, this.size = 32});
  final String name;
  final String? seed;
  final double size;

  static const _palette = [
    Color(0xFF5C6BC0),
    Color(0xFFE8590C),
    Color(0xFF2B8A3E),
    Color(0xFF8E44AD),
    Color(0xFF1C7ED6),
    Color(0xFFC2255C),
    Color(0xFF0B7285),
  ];

  static String initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) {
      final w = parts.first;
      return (w.length >= 2 ? w.substring(0, 2) : w).toUpperCase();
    }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final key = seed ?? name;
    final color = _palette[key.codeUnits.fold<int>(0, (a, b) => a + b) % _palette.length];
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Text(
        initials(name),
        style: TextStyle(color: Colors.white, fontSize: size * 0.38, fontWeight: FontWeight.w600),
      ),
    );
  }
}
