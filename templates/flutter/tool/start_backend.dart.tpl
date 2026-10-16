import 'dart:convert';
import 'dart:io';
import 'dart:math';

/// Run from mobile/: dart run tool/start_backend.dart [apiPort] [databasePort]
Future<void> main(List<String> args) async {
  try {
    final port = await startBackend(args);
    stdout.writeln('Backend listo: http://127.0.0.1:$port');
  } on Exception catch (error) {
    stderr.writeln(error);
    exitCode = 1;
  }
}

Future<int> startBackend(List<String> args) async {
  if (args.length > 2)
    throw ArgumentError('Uso: dart run tool/start_backend.dart [8082] [5435]');
  final apiPort = int.parse(args.isEmpty ? '8082' : args[0]);
  final dbPort = int.parse(args.length < 2 ? '5435' : args[1]);
  if ([apiPort, dbPort].any((p) => p < 1024 || p > 65535) || apiPort == dbPort)
    throw ArgumentError('Usa puertos distintos entre 1024 y 65535');
  final root = Directory('../backend').absolute;
  final example = File('${root.path}/.env.example');
  if (!await example.exists() ||
      !await File('${root.path}/compose.yaml').exists())
    throw StateError('Ejecuta desde mobile/ junto a backend/ del ZIP');
  final env = File('${root.path}/.env');
  if (!await env.exists()) {
    String secret() =>
        base64UrlEncode(List.generate(32, (_) => Random.secure().nextInt(256)));
    var text = await example.readAsString();
    for (final entry in {
      'DB_PASSWORD': secret(),
      'AUTH_PASSWORD': 'admin',
      'AUTH_TOKEN_SECRET': secret(),
      'APP_PORT': '$apiPort',
      'DB_PORT': '$dbPort',
    }.entries) {
      text = text.replaceAll(
        RegExp('^${entry.key}=.*\$', multiLine: true),
        '${entry.key}=${entry.value}',
      );
    }
    await env.writeAsString(text);
    stdout.writeln(
      'Semilla admin/admin lista. Claves de base de datos y firma aleatorias guardadas en ${env.path}. Cambia AUTH_PASSWORD al desplegar.',
    );
  } else {
    stdout.writeln(
      'Se conserva .env existente, incluidos sus puertos y credenciales.',
    );
  }
  final process = await Process.start(
    'docker',
    ['compose', 'up', '-d', '--build', '--wait', '--wait-timeout', '180'],
    workingDirectory: root.path,
    mode: ProcessStartMode.inheritStdio,
    runInShell: Platform.isWindows,
  );
  final code = await process.exitCode;
  if (code != 0) {
    throw ProcessException(
      'docker',
      ['compose', 'up'],
      'El backend no esta listo. Revisa docker compose logs en backend/.',
      code,
    );
  }
  // Consultar el puerto publicado real: respeta .env y el entorno de Compose.
  final published = await Process.run(
    'docker',
    ['compose', 'port', 'api', '8080'],
    workingDirectory: root.path,
    runInShell: Platform.isWindows,
  );
  final port = published.exitCode == 0
      ? int.tryParse(
          published.stdout.toString().trim().split('\n').first.split(':').last,
        )
      : null;
  if (port == null || port < 1 || port > 65535) {
    throw StateError(
      'No se pudo obtener el puerto del backend con docker compose port api 8080.',
    );
  }
  return port;
}
