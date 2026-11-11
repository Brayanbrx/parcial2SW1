import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Preferencia de tema, como el selector «Sistema / Claro / Oscuro» de la web.
enum Appearance {
  system('Sistema', Icons.brightness_auto_outlined, ThemeMode.system),
  light('Claro', Icons.light_mode_outlined, ThemeMode.light),
  dark('Oscuro', Icons.dark_mode_outlined, ThemeMode.dark);

  const Appearance(this.label, this.icon, this.mode);
  final String label;
  final IconData icon;
  final ThemeMode mode;
}

class AppearanceController extends ChangeNotifier {
  AppearanceController._();
  static final AppearanceController instance = AppearanceController._();

  static const _storage = FlutterSecureStorage();
  static const _key = 'appearance';

  Appearance _value = Appearance.system;
  Appearance get value => _value;

  Future<void> load() async {
    try {
      final stored = await _storage.read(key: _key);
      _value = Appearance.values.firstWhere((a) => a.name == stored, orElse: () => Appearance.system);
      notifyListeners();
    } catch (_) {
      // Sin almacenamiento se sigue al sistema.
    }
  }

  Future<void> set(Appearance value) async {
    _value = value;
    notifyListeners();
    try {
      await _storage.write(key: _key, value: value.name);
    } catch (_) {}
  }
}

/// Botón del selector de tema, para barras y la pantalla de acceso.
class AppearanceButton extends StatelessWidget {
  const AppearanceButton({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = AppearanceController.instance;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) => PopupMenuButton<Appearance>(
        tooltip: 'Apariencia: ${controller.value.label}',
        initialValue: controller.value,
        onSelected: controller.set,
        itemBuilder: (_) => [
          for (final a in Appearance.values)
            PopupMenuItem(
              value: a,
              child: Row(children: [Icon(a.icon, size: 18), const SizedBox(width: 10), Text(a.label)]),
            ),
        ],
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(controller.value.icon, size: 18),
              const SizedBox(width: 6),
              Text(controller.value.label, style: const TextStyle(fontWeight: FontWeight.w600)),
              const Icon(Icons.expand_more, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}
