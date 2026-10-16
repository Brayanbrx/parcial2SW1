import 'package:flutter/material.dart';
import 'data/api.dart';
import 'domain/schema.dart';
import 'ui/app_model.dart';
import 'ui/screens.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    final model = AppModel(await AppSchema.load(), ApiClient(), SessionStore());
    await model.restore();
    runApp(ManagementApp(model));
  } catch (error) {
    runApp(
      MaterialApp(
        home: Scaffold(
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text('No se pudo abrir el almacenamiento local: $error'),
            ),
          ),
        ),
      ),
    );
  }
}

class ManagementApp extends StatelessWidget {
  final AppModel model;
  const ManagementApp(this.model, {super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: model.schema.title,
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff176b58)),
      scaffoldBackgroundColor: const Color(0xfff5f7f5),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size(48, 48)),
      ),
    ),
    home: ListenableBuilder(
      listenable: model,
      builder: (context, _) =>
          model.session == null ? LoginScreen(model) : HomeScreen(model),
    ),
  );
}
