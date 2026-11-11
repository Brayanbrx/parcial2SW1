import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/appearance.dart';
import '../../core/brand.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'session.dart';

enum _Mode { entrar, registrar, olvide }

/// Pantalla de acceso con la composición de `LoginPage.tsx` en un teléfono:
/// la marca arriba, sobre la superficie gris, y el formulario debajo.
class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.session});
  final Session session;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _name = TextEditingController();
  final _password = TextEditingController();
  final _server = TextEditingController(text: ApiClient.instance.server);
  _Mode _mode = _Mode.entrar;
  bool _busy = false;
  bool _showServer = false;
  bool _hide = true;
  String? _error;
  String? _ok;

  @override
  void dispose() {
    _email.dispose();
    _name.dispose();
    _password.dispose();
    _server.dispose();
    super.dispose();
  }

  void _switch(_Mode mode) => setState(() {
        _mode = mode;
        _error = null;
        _ok = null;
      });

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
      _ok = null;
    });
    try {
      await ApiClient.instance.setServer(_server.text);
      await action();
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    if (email.isEmpty) return setState(() => _error = 'Escribe tu correo.');
    switch (_mode) {
      case _Mode.entrar:
        if (_password.text.isEmpty) return setState(() => _error = 'Escribe tu contraseña.');
        await _run(() => widget.session.login(email, _password.text));
      case _Mode.registrar:
        if (_name.text.trim().isEmpty) return setState(() => _error = 'Escribe cómo te verán los demás.');
        if (_password.text.length < 8) {
          return setState(() => _error = 'La contraseña necesita al menos 8 caracteres.');
        }
        await _run(() async {
          final r = await ApiClient.instance.publicPost('/auth/register', {
            'email': email,
            'displayName': _name.text.trim(),
            'password': _password.text,
          });
          final sent = r is Map && r['emailSent'] == true;
          if (!mounted) return;
          setState(() {
            _mode = _Mode.entrar;
            _ok = sent
                ? 'Revisa tu correo $email. Te enviamos un enlace para activar la cuenta; caduca en 24 horas. Revisa también spam.'
                : 'Tu cuenta está creada, pero no pudimos enviar el correo. Solicita otro enlace de activación.';
          });
        });
      case _Mode.olvide:
        await _run(() async {
          await ApiClient.instance.publicPost('/auth/password/forgot', {'email': email});
          if (mounted) {
            setState(() => _ok = 'Si hay una cuenta con ese correo, te enviamos un enlace para elegir una contraseña nueva.');
          }
        });
    }
  }

  Future<void> _resend() async {
    final email = _email.text.trim();
    if (email.isEmpty) return setState(() => _error = 'Escribe tu correo para reenviarte el enlace.');
    await _run(() async {
      await ApiClient.instance.publicPost('/auth/verification/resend', {'email': email});
      if (mounted) setState(() => _ok = 'Si la cuenta está pendiente de activar, te enviamos otro enlace.');
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    final dark = Theme.of(context).brightness == Brightness.dark;
    // Sin AppBar nadie fija el color de los iconos del sistema: en oscuro
    // quedarían negros sobre negro.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
      child: Scaffold(
        body: Stack(
          children: [
            SafeArea(
              // La marca se extiende bajo la barra de estado, como la cabecera
              // gris de la web llega al borde superior.
              top: false,
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _brand(c),
                    Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 440),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(22, 40, 22, 32),
                          child: _form(c),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            // Franja fija del color de la marca bajo la hora y los iconos: al
            // desplazar con el teclado abierto, el texto pasa por debajo.
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: MediaQuery.paddingOf(context).top,
              child: ColoredBox(color: c.superficie2),
            ),
          ],
        ),
      ),
    );
  }

  /// `.acceso-marca`.
  Widget _brand(UmlColors c) => Container(
        decoration: BoxDecoration(
          color: c.superficie2,
          border: Border(bottom: BorderSide(color: c.borde)),
        ),
        padding: EdgeInsets.fromLTRB(28, 20 + MediaQuery.paddingOf(context).top, 16, 36),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Align(alignment: Alignment.centerRight, child: AppearanceButton()),
            const Isotipo(size: 44),
            const SizedBox(height: 22),
            const Wordmark(size: 13),
            const SizedBox(height: 26),
            Text(
              'Diagramas de clases en equipo.',
              style: editorial(context, size: 34).copyWith(letterSpacing: -1.5, height: 1.12),
            ),
            const SizedBox(height: 16),
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Text(
                'Edita diagramas UML, comparte pizarras y genera un proyecto Java a partir del modelo.',
                style: TextStyle(fontSize: 15, height: 1.7, color: c.textoSuave),
              ),
            ),
          ],
        ),
      );

  Widget _form(UmlColors c) {
    final (title, subtitle, action) = switch (_mode) {
      _Mode.entrar => ('Bienvenido de nuevo', 'Entra para seguir con tus diagramas.', 'Entrar'),
      _Mode.registrar => ('Crea tu cuenta', 'Te enviaremos un enlace para activar tu cuenta.', 'Crear cuenta'),
      _Mode.olvide => (
          'Recupera tu acceso',
          'Te enviamos un enlace para elegir una contraseña nueva.',
          'Enviarme el enlace'
        ),
    };
    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: editorial(context, size: 30)),
          const SizedBox(height: 4),
          Text(subtitle, style: TextStyle(fontSize: 15, color: c.textoSuave)),
          const SizedBox(height: 24),
          if (_mode != _Mode.olvide) ...[
            _Tabs(
              active: _mode,
              onChanged: _busy ? null : _switch,
            ),
            const SizedBox(height: 20),
          ],
          const FieldLabel('Correo'),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(hintText: 'tu@correo.com'),
          ),
          if (_mode == _Mode.registrar) ...[
            const SizedBox(height: 16),
            const FieldLabel('Nombre'),
            TextField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.name],
              decoration: const InputDecoration(hintText: 'Cómo te verán los demás'),
            ),
          ],
          if (_mode != _Mode.olvide) ...[
            const SizedBox(height: 16),
            const FieldLabel('Contraseña'),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _password,
                    obscureText: _hide,
                    autofillHints: [
                      _mode == _Mode.registrar ? AutofillHints.newPassword : AutofillHints.password,
                    ],
                    onSubmitted: (_) => _submit(),
                  ),
                ),
                TextButton(
                  onPressed: () => setState(() => _hide = !_hide),
                  style: TextButton.styleFrom(foregroundColor: c.textoSuave),
                  child: Text(_hide ? 'Mostrar' : 'Ocultar'),
                ),
              ],
            ),
            if (_mode == _Mode.registrar)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('Al menos 8 caracteres.', style: TextStyle(fontSize: 13, color: c.textoTenue)),
              ),
          ],
          if (_mode == _Mode.entrar)
            Center(
              child: TextButton(
                onPressed: _busy ? null : _resend,
                style: TextButton.styleFrom(foregroundColor: c.textoSuave),
                child: const Text('¿No recibiste el enlace de activación?',
                    style: TextStyle(fontWeight: FontWeight.w400)),
              ),
            ),
          if (_showServer) ...[
            const SizedBox(height: 16),
            const FieldLabel('Servidor'),
            TextField(
              controller: _server,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(hintText: 'https://uml.asiscarretera.online'),
            ),
          ],
          if (_error != null) ...[const SizedBox(height: 14), Notice(_error!)],
          if (_ok != null) ...[const SizedBox(height: 14), Notice(_ok!, error: false)],
          const SizedBox(height: 22),
          FilledButton(
            onPressed: _busy ? null : _submit,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(46)),
            child: Text(_busy ? 'Un momento…' : action),
          ),
          const SizedBox(height: 10),
          Center(
            child: TextButton(
              onPressed: _busy ? null : () => _switch(_mode == _Mode.olvide ? _Mode.entrar : _Mode.olvide),
              style: TextButton.styleFrom(foregroundColor: c.textoSuave),
              child: Text(_mode == _Mode.olvide ? 'Volver a entrar' : '¿Olvidaste tu contraseña?'),
            ),
          ),
          Center(
            child: TextButton(
              onPressed: () => setState(() => _showServer = !_showServer),
              style: TextButton.styleFrom(foregroundColor: c.textoTenue),
              child: Text(_showServer ? 'Ocultar servidor' : 'Cambiar servidor',
                  style: const TextStyle(fontWeight: FontWeight.w400, fontSize: 13)),
            ),
          ),
        ],
      ),
    );
  }
}

/// `.pestanas`: «Entrar» y «Crear cuenta», subrayadas con el acento.
class _Tabs extends StatelessWidget {
  const _Tabs({required this.active, required this.onChanged});
  final _Mode active;
  final void Function(_Mode)? onChanged;

  @override
  Widget build(BuildContext context) {
    final c = context.uml;
    Widget tab(_Mode mode, String label) {
      final selected = active == mode;
      return Expanded(
        child: InkWell(
          onTap: onChanged == null ? null : () => onChanged!(mode),
          child: Container(
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(color: selected ? c.acento : Colors.transparent, width: 3),
              ),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: selected ? c.texto : c.textoSuave,
              ),
            ),
          ),
        ),
      );
    }

    return DecoratedBox(
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: c.borde))),
      child: Row(children: [tab(_Mode.entrar, 'Entrar'), tab(_Mode.registrar, 'Crear cuenta')]),
    );
  }
}
