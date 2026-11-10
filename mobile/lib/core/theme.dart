import 'package:flutter/material.dart';

/// Paleta tomada de `frontend/src/design.css` (tema claro).
class Paleta {
  static const fondo = Color(0xFFF5F4F0);
  static const superficie = Color(0xFFFFFEFA);
  static const superficie2 = Color(0xFFEEEEE8);
  static const texto = Color(0xFF252D29);
  static const textoSuave = Color(0xFF59635C);
  static const borde = Color(0xFFDEDFD7);
  static const acento = Color(0xFF35634C);
  static const acentoSuave = Color(0xFFE6EEE6);
  static const error = Color(0xFFB44339);
  static const errorSuave = Color(0xFFF8E9E5);
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: Paleta.acento,
    brightness: Brightness.light,
  ).copyWith(
    primary: Paleta.acento,
    onPrimary: Colors.white,
    surface: Paleta.superficie,
    error: Paleta.error,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Paleta.fondo,
    appBarTheme: const AppBarTheme(
      backgroundColor: Paleta.superficie,
      foregroundColor: Paleta.texto,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      shape: Border(bottom: BorderSide(color: Paleta.borde)),
    ),
    cardTheme: CardThemeData(
      color: Paleta.superficie,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: Paleta.borde),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Paleta.superficie,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: Paleta.borde),
      ),
    ),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: Paleta.acento,
      foregroundColor: Colors.white,
    ),
    dividerColor: Paleta.borde,
  );
}
