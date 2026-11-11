import 'package:flutter/material.dart';

/// Tokens de color de la web (`frontend/src/design.css`), en claro y oscuro.
///
/// Se nombran igual que las variables CSS para que un cambio en la web se
/// traslade aquí sin traducir nada: `--clase-cabecera` es `claseCabecera`.
@immutable
class UmlColors extends ThemeExtension<UmlColors> {
  const UmlColors({
    required this.fondo,
    required this.superficie,
    required this.superficie2,
    required this.superficie3,
    required this.suave,
    required this.texto,
    required this.textoSuave,
    required this.textoTenue,
    required this.borde,
    required this.bordeFuerte,
    required this.acento,
    required this.acentoVivo,
    required this.acentoTexto,
    required this.acentoSuave,
    required this.error,
    required this.errorTexto,
    required this.errorSuave,
    required this.aviso,
    required this.avisoTexto,
    required this.avisoSuave,
    required this.ok,
    required this.okTexto,
    required this.okSuave,
    required this.sombra,
    required this.diagramaFondo,
    required this.diagramaPunto,
    required this.diagramaLinea,
    required this.claseBorde,
    required this.claseCabecera,
    required this.claseCuerpo,
    required this.claseTexto,
    required this.claseTenue,
    required this.claseSeleccion,
  });

  final Color fondo;
  final Color superficie;
  final Color superficie2;
  final Color superficie3;
  final Color suave;
  final Color texto;
  final Color textoSuave;
  final Color textoTenue;
  final Color borde;
  final Color bordeFuerte;
  final Color acento;
  final Color acentoVivo;
  final Color acentoTexto;
  final Color acentoSuave;
  final Color error;
  final Color errorTexto;
  final Color errorSuave;
  final Color aviso;
  final Color avisoTexto;
  final Color avisoSuave;
  final Color ok;
  final Color okTexto;
  final Color okSuave;
  final Color sombra;
  final Color diagramaFondo;
  final Color diagramaPunto;
  final Color diagramaLinea;
  final Color claseBorde;
  final Color claseCabecera;
  final Color claseCuerpo;
  final Color claseTexto;
  final Color claseTenue;
  final Color claseSeleccion;

  /// `:root` de design.css: la paleta mineral.
  static const claro = UmlColors(
    fondo: Color(0xFFF5F4F0),
    superficie: Color(0xFFFFFEFA),
    superficie2: Color(0xFFEEEEE8),
    superficie3: Color(0xFFE7E9E2),
    suave: Color(0x0A212F28),
    texto: Color(0xFF252D29),
    textoSuave: Color(0xFF59635C),
    textoTenue: Color(0xFF657069),
    borde: Color(0xFFDEDFD7),
    bordeFuerte: Color(0xFFA9B4AA),
    acento: Color(0xFF35634C),
    acentoVivo: Color(0xFF284F3C),
    acentoTexto: Color(0xFF2F6047),
    acentoSuave: Color(0xFFE6EEE6),
    error: Color(0xFFB44339),
    errorTexto: Color(0xFFA23731),
    errorSuave: Color(0xFFF8E9E5),
    aviso: Color(0xFFA17627),
    avisoTexto: Color(0xFF805D1C),
    avisoSuave: Color(0xFFF5EFDF),
    ok: Color(0xFF3D7855),
    okTexto: Color(0xFF316648),
    okSuave: Color(0xFFE8F0E7),
    sombra: Color(0x0D1D2A21),
    diagramaFondo: Color(0xFFF5F4EE),
    diagramaPunto: Color(0xFFD4D8CE),
    diagramaLinea: Color(0xFF566659),
    claseBorde: Color(0xFF9BAA9A),
    claseCabecera: Color(0xFFE8EEE2),
    claseCuerpo: Color(0xFFFFFEF8),
    claseTexto: Color(0xFF28352B),
    claseTenue: Color(0xFF5D6A5E),
    claseSeleccion: Color(0xFF397253),
  );

  /// `:root[data-theme='dark']` de design.css.
  static const oscuro = UmlColors(
    fondo: Color(0xFF1E1E1E),
    superficie: Color(0xFF252526),
    superficie2: Color(0xFF2D2D30),
    superficie3: Color(0xFF333333),
    suave: Color(0x0AFFFFFF),
    texto: Color(0xFFD4D4D4),
    textoSuave: Color(0xFFB5B5B5),
    textoTenue: Color(0xFFA0A0A0),
    borde: Color(0xFF3C3C3C),
    bordeFuerte: Color(0xFF606060),
    acento: Color(0xFF0E639C),
    acentoVivo: Color(0xFF1177BB),
    acentoTexto: Color(0xFF9CDCFE),
    acentoSuave: Color(0xFF263B4D),
    error: Color(0xFFF48771),
    errorTexto: Color(0xFFF4A395),
    errorSuave: Color(0xFF3D2927),
    aviso: Color(0xFFCCA700),
    avisoTexto: Color(0xFFD7BA7D),
    avisoSuave: Color(0xFF363225),
    ok: Color(0xFF89B678),
    okTexto: Color(0xFFA5C895),
    okSuave: Color(0xFF29352A),
    sombra: Color(0x24000000),
    diagramaFondo: Color(0xFF1E1E1E),
    diagramaPunto: Color(0xFF363636),
    diagramaLinea: Color(0xFFB0B0B0),
    claseBorde: Color(0xFF737373),
    claseCabecera: Color(0xFF2D2D30),
    claseCuerpo: Color(0xFF252526),
    claseTexto: Color(0xFFD4D4D4),
    claseTenue: Color(0xFFB5B5B5),
    claseSeleccion: Color(0xFF569CD6),
  );

  @override
  UmlColors copyWith() => this;

  @override
  UmlColors lerp(ThemeExtension<UmlColors>? other, double t) =>
      other is UmlColors && t >= 0.5 ? other : this;
}

extension UmlTheme on BuildContext {
  UmlColors get uml => Theme.of(this).extension<UmlColors>() ?? UmlColors.claro;
}

/// Familias de la web: Plex Sans para todo y Plex Serif para los títulos
/// editoriales (`--editorial`).
const String kSans = 'Plex Sans';
const String kSerif = 'Plex Serif';

/// Título editorial: `.encabezado-pagina h1` y `.acceso-titulo h1`.
TextStyle editorial(BuildContext context, {double size = 30}) => TextStyle(
      fontFamily: kSerif,
      fontWeight: FontWeight.w500,
      fontSize: size,
      height: 1.15,
      letterSpacing: size * -0.035,
      color: context.uml.texto,
    );

ThemeData buildTheme(Brightness brightness) {
  final c = brightness == Brightness.dark ? UmlColors.oscuro : UmlColors.claro;
  final scheme = ColorScheme.fromSeed(seedColor: c.acento, brightness: brightness).copyWith(
    primary: c.acento,
    onPrimary: Colors.white,
    primaryContainer: c.acentoSuave,
    onPrimaryContainer: c.acentoTexto,
    surface: c.superficie,
    onSurface: c.texto,
    onSurfaceVariant: c.textoSuave,
    surfaceContainerLowest: c.superficie,
    surfaceContainerLow: c.superficie,
    surfaceContainer: c.superficie,
    surfaceContainerHigh: c.superficie,
    surfaceContainerHighest: c.superficie2,
    outline: c.bordeFuerte,
    outlineVariant: c.borde,
    error: c.error,
  );
  // `--r-md`: 6 px. La web no redondea más que eso en ningún control.
  final radio = BorderRadius.circular(6);
  final base = ThemeData(brightness: brightness, fontFamily: kSans);

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    fontFamily: kSans,
    colorScheme: scheme,
    extensions: [c],
    scaffoldBackgroundColor: c.fondo,
    canvasColor: c.fondo,
    dividerColor: c.borde,
    splashFactory: InkSparkle.splashFactory,
    textTheme: base.textTheme.apply(bodyColor: c.texto, displayColor: c.texto),
    appBarTheme: AppBarTheme(
      backgroundColor: c.superficie,
      foregroundColor: c.texto,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: TextStyle(
        fontFamily: kSans,
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: c.texto,
      ),
      shape: Border(bottom: BorderSide(color: c.borde)),
    ),
    dividerTheme: DividerThemeData(color: c.borde, thickness: 1, space: 1),
    cardTheme: CardThemeData(
      color: c.superficie,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: radio, side: BorderSide(color: c.borde)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.superficie,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      hintStyle: TextStyle(color: c.textoTenue),
      labelStyle: TextStyle(color: c.textoSuave),
      border: OutlineInputBorder(borderRadius: radio, borderSide: BorderSide(color: c.bordeFuerte)),
      enabledBorder:
          OutlineInputBorder(borderRadius: radio, borderSide: BorderSide(color: c.bordeFuerte)),
      focusedBorder:
          OutlineInputBorder(borderRadius: radio, borderSide: BorderSide(color: c.acento, width: 2)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.acento,
        foregroundColor: Colors.white,
        disabledBackgroundColor: c.superficie3,
        minimumSize: const Size(0, 40),
        shape: RoundedRectangleBorder(borderRadius: radio),
        textStyle: const TextStyle(fontFamily: kSans, fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.texto,
        side: BorderSide(color: c.bordeFuerte),
        minimumSize: const Size(0, 40),
        shape: RoundedRectangleBorder(borderRadius: radio),
        textStyle: const TextStyle(fontFamily: kSans, fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: c.acentoTexto,
        shape: RoundedRectangleBorder(borderRadius: radio),
        textStyle: const TextStyle(fontFamily: kSans, fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(foregroundColor: c.textoSuave),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: c.acento,
      foregroundColor: Colors.white,
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: radio),
    ),
    // `.pestanas`: subrayado del acento, sin fondo ni píldora.
    tabBarTheme: TabBarThemeData(
      labelColor: c.texto,
      unselectedLabelColor: c.textoSuave,
      indicatorColor: c.acento,
      indicatorSize: TabBarIndicatorSize.label,
      dividerColor: c.borde,
      labelStyle: const TextStyle(fontFamily: kSans, fontWeight: FontWeight.w600, fontSize: 14),
      unselectedLabelStyle: const TextStyle(fontFamily: kSans, fontSize: 14),
      tabAlignment: TabAlignment.start,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: c.superficie,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      titleTextStyle: TextStyle(
        fontFamily: kSerif,
        fontWeight: FontWeight.w500,
        fontSize: 22,
        letterSpacing: -0.6,
        color: c.texto,
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: c.superficie,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: c.bordeFuerte,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(12))),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: c.superficie,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: radio, side: BorderSide(color: c.borde)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: c.texto,
      contentTextStyle: TextStyle(fontFamily: kSans, color: c.fondo),
      shape: RoundedRectangleBorder(borderRadius: radio),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? Colors.white : c.bordeFuerte,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? c.acento : c.superficie2,
      ),
    ),
    listTileTheme: ListTileThemeData(iconColor: c.textoSuave, textColor: c.texto),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: c.acento),
  );
}
