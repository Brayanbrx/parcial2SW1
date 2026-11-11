import 'package:flutter/material.dart';

import 'api.dart';
import 'theme.dart';

/// Etiqueta encima de un campo, como los `<label>` de la web.
class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(
          text,
          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: context.uml.textoSuave),
        ),
      );
}

/// `.encabezado-pagina`: título editorial, subtítulo y, opcionalmente, un
/// botón de volver cuadrado y una insignia.
class PageHeader extends StatelessWidget {
  const PageHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.onBack,
    this.badge,
  });
  final String title;
  final String? subtitle;
  final VoidCallback? onBack;
  final Widget? badge;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    final text = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: editorial(context, size: 32)),
        if (subtitle != null) ...[
          const SizedBox(height: 6),
          Text(subtitle!, style: TextStyle(fontSize: 15, color: c.textoSuave)),
        ],
        if (badge != null) ...[const SizedBox(height: 10), badge!],
      ],
    );
    if (onBack == null) return text;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Tooltip(
          message: 'Volver',
          child: InkWell(
            onTap: onBack,
            borderRadius: BorderRadius.circular(6),
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                border: Border.all(color: c.borde),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Icon(Icons.chevron_left, color: c.texto),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(child: text),
      ],
    );
  }
}

/// `.insignia-rol`: rectángulo con borde fino, en versalitas pequeñas.
class RoleBadge extends StatelessWidget {
  const RoleBadge(this.role, {super.key});
  final String role;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: c.superficie,
        border: Border.all(color: c.borde),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        roleLabel(role),
        style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, letterSpacing: 0.4, color: c.textoSuave),
      ),
    );
  }
}

/// Dato con icono del pie de una tarjeta (`.dato-tarjeta`).
class MetaItem extends StatelessWidget {
  const MetaItem(this.icon, this.text, {super.key});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: c.textoSuave),
        const SizedBox(width: 5),
        Text(text, style: TextStyle(fontSize: 14, color: c.textoSuave)),
      ],
    );
  }
}

/// `.tarjeta-recurso`: fila separada por una línea, icono en un cuadro con
/// borde, nombre y un pie con datos y acciones.
class ResourceRow extends StatelessWidget {
  const ResourceRow({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
    this.footer = const [],
    this.trailing,
  });
  final IconData icon;
  final String title;
  final VoidCallback onTap;
  final List<Widget> footer;

  /// Acción a la derecha del nombre: no salta de línea en pantallas estrechas.
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    return DecoratedBox(
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: c.borde))),
      child: InkWell(
        onTap: onTap,
        hoverColor: c.suave,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 18, 12, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      border: Border.all(color: c.bordeFuerte),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Icon(icon, size: 18, color: c.acentoTexto),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      title,
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c.texto),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  ?trailing,
                ],
              ),
              if (footer.isNotEmpty) ...[
                const SizedBox(height: 12),
                Wrap(spacing: 16, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: footer),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Aviso dentro de un formulario (`.aviso-error` / `.aviso-ok`).
class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.error = true});
  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: error ? c.errorSuave : c.okSuave,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(text, style: TextStyle(color: error ? c.errorTexto : c.okTexto)),
    );
  }
}

/// `.estado-vacio-panel`.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, required this.message});
  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              border: Border.all(color: c.bordeFuerte),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Icon(icon, color: c.acentoTexto),
          ),
          const SizedBox(height: 14),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Text(message, textAlign: TextAlign.center, style: TextStyle(color: c.textoSuave)),
        ],
      ),
    );
  }
}

Future<String?> askText(
  BuildContext context, {
  required String title,
  String initial = '',
  String label = 'Nombre',
  String? hint,
  String action = 'Guardar',
}) {
  final controller = TextEditingController(text: initial);
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FieldLabel(label),
          TextField(
            controller: controller,
            autofocus: true,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(hintText: hint),
            onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
          ),
        ],
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
          style: FilledButton.styleFrom(
            backgroundColor: ctx.uml.error,
            foregroundColor: onError(ctx),
          ),
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(action),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// Texto sobre el rojo de error. En oscuro el rojo es un salmón claro
/// (#F48771): con blanco el contraste no llega a 2,5:1; con el fondo, pasa de 7:1.
Color onError(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark ? context.uml.fondo : Colors.white;

void showMessage(BuildContext context, String text, {bool error = false}) {
  final c = context.uml;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(text, style: TextStyle(color: error ? onError(context) : c.fondo)),
        backgroundColor: error ? c.error : null,
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
            Icon(Icons.cloud_off, size: 40, color: context.uml.textoSuave),
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

/// «1 pizarra», «2 pizarras».
String plural(int n, String singular, String pluralForm) => '$n ${n == 1 ? singular : pluralForm}';

String timeAgo(DateTime date) {
  final d = DateTime.now().difference(date);
  if (d.inSeconds < 60) return 'hace un momento';
  if (d.inMinutes < 60) return 'hace ${d.inMinutes} min';
  if (d.inHours < 24) return 'hace ${d.inHours} h';
  if (d.inDays < 7) return 'hace ${d.inDays} d';
  return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
}
