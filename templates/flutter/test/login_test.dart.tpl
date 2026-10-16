import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import '../lib/domain/schema.dart';
import '../lib/data/api.dart';
import '../lib/ui/app_model.dart';
import '../lib/main.dart';

void main() {
  testWidgets(
    'connection failure remains visible and login can be retried without losing input',
    (tester) async {
      final model = FailingLoginModel();
      await tester.pumpWidget(ManagementApp(model));
      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).at(2), 'kept-password');
      await tester.ensureVisible(find.text('Iniciar sesion'));
      await tester.tap(find.text('Iniciar sesion'));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 8));
      expect(find.textContaining('cable USB'), findsOneWidget);
      expect(find.byType(SnackBar), findsNothing);
      expect(
        tester.widget<TextField>(find.byType(TextField).at(2)).controller!.text,
        'kept-password',
      );
      await tester.ensureVisible(find.text('Iniciar sesion'));
      await tester.tap(find.text('Iniciar sesion'));
      await tester.pumpAndSettle();
      expect(model.attempts, 2);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      model.dispose();
    },
  );
  testWidgets('login local por defecto a 360px y servidor opcional', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final schema = AppSchema({
      'resources': [
        {
          'className': 'Cliente',
          'path': '/api/clientes',
          'primaryKey': 'id',
          'fields': [
            {
              'name': 'id',
              'javaType': 'String',
              'nullable': false,
              'primaryKey': true,
            },
          ],
        },
      ],
    });
    final model = AppModel(schema, ApiClient(), SessionStore());
    await tester.pumpWidget(ManagementApp(model));
    expect(find.text('Iniciar sesion'), findsOneWidget);
    final password = tester
        .widgetList<TextField>(find.byType(TextField))
        .firstWhere((f) => f.obscureText);
    expect(password.controller!.text, isEmpty);
    expect(find.text('Direccion del backend'), findsNothing);
    expect(find.textContaining('Usuario: admin'), findsOneWidget);
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    expect(find.text('Direccion del backend'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    model.dispose();
  });
}

class FailingLoginModel extends AppModel {
  FailingLoginModel()
    : super(
        AppSchema({
          'resources': [
            {
              'className': 'Cliente',
              'path': '/api/clientes',
              'primaryKey': 'id',
              'fields': [
                {
                  'name': 'id',
                  'javaType': 'String',
                  'primaryKey': true,
                  'nullable': false,
                },
              ],
            },
          ],
        }),
        ApiClient(),
        SessionStore(),
      );
  int attempts = 0;
  @override
  Future<void> login(String url, String username, String password) async {
    attempts++;
    throw http.ClientException('connection refused');
  }
}
