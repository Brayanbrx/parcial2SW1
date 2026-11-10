import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import 'session.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.session});
  final Session session;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _server = TextEditingController(text: ApiClient.instance.server);
  bool _busy = false;
  bool _showServer = false;
  bool _hide = true;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Escribe tu correo y tu contraseña.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ApiClient.instance.setServer(_server.text);
      await widget.session.login(_email.text, _password.text);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.schema_outlined, size: 48, color: Paleta.acento),
                  const SizedBox(height: 12),
                  Text(
                    'UML Forge',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: Paleta.texto,
                        ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Acceso de emergencia a tus proyectos',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Paleta.textoSuave),
                  ),
                  const SizedBox(height: 28),
                  if (widget.session.offlineNotice != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        widget.session.offlineNotice!,
                        style: const TextStyle(color: Paleta.textoSuave),
                      ),
                    ),
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    decoration: const InputDecoration(labelText: 'Correo'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _password,
                    obscureText: _hide,
                    autofillHints: const [AutofillHints.password],
                    onSubmitted: (_) => _submit(),
                    decoration: InputDecoration(
                      labelText: 'Contraseña',
                      suffixIcon: IconButton(
                        icon: Icon(_hide ? Icons.visibility : Icons.visibility_off),
                        onPressed: () => setState(() => _hide = !_hide),
                      ),
                    ),
                  ),
                  if (_showServer) ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: _server,
                      keyboardType: TextInputType.url,
                      decoration: const InputDecoration(labelText: 'Servidor'),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Paleta.errorSuave,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(_error!, style: const TextStyle(color: Paleta.error)),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                    child: _busy
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Iniciar sesión'),
                  ),
                  TextButton(
                    onPressed: () => setState(() => _showServer = !_showServer),
                    child: Text(_showServer ? 'Ocultar servidor' : 'Cambiar servidor'),
                  ),
                  const Text(
                    'Si aún no tienes cuenta, créala y actívala desde la versión web.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Paleta.textoSuave, fontSize: 12),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
