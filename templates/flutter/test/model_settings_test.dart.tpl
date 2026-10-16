import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/data/model_library.dart';
import '../lib/ui/local_model_settings.dart';

ModelLibrary populatedLibrary() {
  final library = ModelLibrary(Directory('unused-widget-models'));
  library.models.addAll([
    const LocalModelFile(
      '11111111-1111-4111-8111-111111111111',
      'gemma-4-E2B-it-modelo-con-nombre-muy-largo.litertlm',
      ModelRuntime.litertlm,
      2500000000,
    ),
    const LocalModelFile(
      '22222222-2222-4222-8222-222222222222',
      'ggml-small-multilingue-cuantizado-q5_1.bin',
      ModelRuntime.whisper,
      180000000,
    ),
  ]);
  library.textId = library.models.first.id;
  library.speechId = library.models.last.id;
  return library;
}

Future<void> showSettings(
  WidgetTester tester,
  ModelLibrary library, {
  double width = 320,
  double scale = 1,
  bool disabled = false,
  double keyboard = 0,
}) async {
  tester.view.physicalSize = Size(width, 640);
  tester.view.devicePixelRatio = 1;
  tester.view.viewInsets = FakeViewPadding(bottom: keyboard);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetViewInsets);
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: Scaffold(
        body: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: LocalModelSettings(
              library: library,
              disabled: disabled,
              run: (action) => action(),
            ),
          ),
        ),
      ),
    ),
  );
}

Future<void> reveal(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
}

void main() {
  for (final width in [320.0, 360.0, 768.0, 1024.0, 1440.0]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets('modelos y menus sin overflow a $width px, escala $scale', (
        tester,
      ) async {
        final library = populatedLibrary();
        await showSettings(tester, library, width: width, scale: scale);
        expect(find.text('Texto'), findsOneWidget);
        expect(find.text('Voz'), findsOneWidget);
        expect(find.text('Cambiar archivo'), findsNWidgets(2));
        expect(find.text('CPU'), findsNothing);
        expect(tester.takeException(), isNull);

        // Long file names must fit both the field and its open menu.
        await tester.tap(find.byType(DropdownButtonFormField<String>).first);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        Navigator.of(tester.element(find.text('Texto'))).pop();
        await tester.pumpAndSettle();

        await reveal(tester, find.text('Opciones'));
        await tester.tap(find.text('Opciones'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await reveal(tester, find.text('CPU'));
        await tester.tap(find.text('CPU'));
        await tester.pumpAndSettle();
        expect(find.text('GPU'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets('inicio simple y carga bloqueada mientras se procesa', (
    tester,
  ) async {
    await showSettings(
      tester,
      ModelLibrary(Directory('unused')),
      disabled: true,
      scale: 2,
    );
    expect(find.text('Cargar modelo'), findsNWidgets(2));
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    expect(find.text('Origen de texto'), findsNothing);
    for (final button in tester.widgetList<OutlinedButton>(
      find.byType(OutlinedButton),
    )) {
      expect(button.onPressed, isNull);
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('opciones remotas accesibles con teclado y texto grande', (
    tester,
  ) async {
    final library = populatedLibrary();
    library.textMode = 'remote';
    library.speechMode = 'remote';
    await showSettings(tester, library, scale: 2, keyboard: 260);
    await reveal(tester, find.text('Opciones'));
    await tester.tap(find.text('Opciones'));
    await tester.pumpAndSettle();
    final keyField = find.byType(TextField).last;
    await reveal(tester, keyField);
    await tester.enterText(keyField, 'clave-de-prueba');
    await reveal(tester, find.text('Guardar'));
    expect(find.text('Guardar').hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
