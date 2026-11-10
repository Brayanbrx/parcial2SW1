import 'package:flutter/material.dart';

import 'api.dart';
import 'theme.dart';

Future<String?> askText(
  BuildContext context, {
  required String title,
  String initial = '',
  String label = 'Nombre',
  String action = 'Guardar',
}) {
  final controller = TextEditingController(text: initial);
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        textCapitalization: TextCapitalization.sentences,
        decoration: InputDecoration(labelText: label),
        onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
        FilledButton(
          onPressed: () => Navigator.pop(ctx, controller.text.trim()),
          child: Text(action),
        ),
      ],
    ),
  ).then((v) => (v == null || v.isEmpty) ? null : v);
}

Future<bool> confirm(
  BuildContext context, {
  required String title,
  required String message,
  String action = 'Eliminar',
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Paleta.error),
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(action),
        ),
      ],
    ),
  );
  return ok ?? false;
}

void showMessage(BuildContext context, String text, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(text),
        backgroundColor: error ? Paleta.error : null,
      ),
    );
}

String errorText(Object e) => e is ApiError ? e.message : 'Ocurrió un error inesperado.';

/// Pantalla de error con reintento, para cargas fallidas.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 40, color: Paleta.textoSuave),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: onRetry, child: const Text('Reintentar')),
          ],
        ),
      ),
    );
  }
}

String roleLabel(String role) => switch (role) {
      'OWNER' => 'Propietario',
      'EDITOR' => 'Editor',
      _ => 'Lector',
    };

String timeAgo(DateTime date) {
  final d = DateTime.now().difference(date);
  if (d.inSeconds < 60) return 'hace un momento';
  if (d.inMinutes < 60) return 'hace ${d.inMinutes} min';
  if (d.inHours < 24) return 'hace ${d.inHours} h';
  if (d.inDays < 7) return 'hace ${d.inDays} d';
  return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
}
