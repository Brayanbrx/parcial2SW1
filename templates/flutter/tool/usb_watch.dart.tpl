import 'dart:async';
import 'dart:convert';
import 'dart:io';

typedef AdbCommand = Future<String?> Function(List<String> arguments);

/// Returns a status for logging; never changes another device or port.
Future<String> repairUsb(AdbCommand command, String serial, int port) async {
  final prefix = ['-s', serial];
  if ((await command([...prefix, 'get-state']))?.trim() != 'device') {
    return 'Esperando el telefono autorizado $serial';
  }
  final listing = await command([...prefix, 'reverse', '--list']);
  if (listing == null) return 'No se pudo comprobar el tunel USB';
  final endpoint = 'tcp:$port';
  final connected = listing.split('\n').any((line) {
    final parts = line.trim().split(RegExp(r'\s+'));
    return parts.length >= 3 &&
        parts[parts.length - 2] == endpoint &&
        parts.last == endpoint;
  });
  if (!connected &&
      await command([...prefix, 'reverse', endpoint, endpoint]) == null) {
    return 'No se pudo restablecer el tunel USB';
  }
  return 'USB conectado: http://127.0.0.1:$port';
}

Future<void> watchUsb(String adb, String serial, int port) async {
  final directory = Directory('.dart_tool')..createSync(recursive: true);
  final key = base64Url.encode(utf8.encode('$serial:$port'));
  final lock = await File(
    '${directory.path}/usb-$key.lock',
  ).open(mode: FileMode.append);
  try {
    await lock.lock(FileLock.exclusive);
  } on FileSystemException {
    await lock.close();
    stdout.writeln('La reconexion USB de este telefono ya esta activa.');
    return;
  }
  Future<String?> command(List<String> args) async {
    Process? process;
    try {
      process = await Process.start(adb, args);
      final output = process.stdout.transform(utf8.decoder).join();
      final errors = process.stderr.drain<void>();
      final code = await process.exitCode.timeout(const Duration(seconds: 8));
      await errors;
      final text = await output;
      return code == 0 ? text : null;
    } on Exception {
      process?.kill();
      return null;
    }
  }

  try {
    String? previous;
    while (true) {
      final status = await repairUsb(command, serial, port);
      if (status != previous) stdout.writeln(status);
      previous = status;
      await Future<void>.delayed(const Duration(seconds: 2));
    }
  } finally {
    await lock.close();
  }
}
