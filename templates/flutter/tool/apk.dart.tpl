import 'dart:io';
import 'start_backend.dart' show startBackend;
import 'usb_watch.dart' show watchUsb;

/// Compila, instala y ejecuta el APK con una sola orden.
///
/// Desde la raiz del paquete: `apk.bat install` (Windows) o `sh apk.sh install`.
/// Desde mobile/: `dart tool/apk.dart install`.
///
/// Hace en orden lo que antes habia que buscar a mano: crear el proyecto Android
/// si falta, descargar dependencias, compilar, copiar el APK a dist/ y, si se
/// pide, instalarlo por USB y abrirlo en el telefono.
const usage = '''
Uso:  apk.bat [orden] [opciones]        (Windows, desde la raiz del paquete)
      sh apk.sh [orden] [opciones]      (Linux/macOS)
      dart tool/apk.dart [orden]        (desde mobile/)

Ordenes:
  build     Compila el APK de depuracion y lo deja en mobile/dist/. (por defecto)
  install   build + instala y abre la app en el telefono conectado por USB.
  run       Ejecuta en el telefono con recarga en caliente (flutter run).
  deploy    Levanta backend + PostgreSQL, conecta por USB, compila e instala.
  backend   Levanta backend + PostgreSQL con Docker y espera a que esten sanos.
  usb       Conecta el telefono al backend local por USB (adb reverse).
  check     Prepara Android, ejecuta flutter analyze y flutter test.
  release   Compila el APK de release (firma de depuracion) y lo deja en dist/.
  devices   Lista los telefonos que ve adb.
  doctor    Comprueba Flutter, adb y el telefono sin compilar.

Opciones:
  --api=URL        URL inicial del backend en el login (API_BASE_URL).
                   Ejemplo: --api=http://192.168.1.10:8082
  --device=SERIAL  Telefono concreto cuando hay varios (ver devices).
  --usb           Acceso al backend de la PC por USB en install o run.
  --watch         usb: repara el tunel automaticamente al reconectar el cable.
  --port=8082     Puerto local para usb / --usb o un backend nuevo.
  --skip-build    install: instala el APK debug de dist/ sin recompilar.
  --universal      APK para todas las arquitecturas; por defecto solo ARM64.
  --no-ai-env      No incrustar mobile/ai.env aunque exista.

IA en linea: copia ai.env.example a ai.env, pega las claves de infra/.env y
vuelve a compilar. Tambien se pueden escribir en la app (Asistente > IA en linea).
''';

const appId = '__APP_ID___mobile';
const packageName = 'com.uml.generated.__APP_ID___mobile';

Future<void> main(List<String> args) async {
  try {
    await execute(args);
  } on ProcessException catch (error) {
    fail('No se pudo ejecutar ${error.executable}: ${error.message}');
  } on FileSystemException catch (error) {
    fail('No se pudo acceder a ${error.path}: ${error.message}');
  } on StateError catch (error) {
    fail(error.message);
  }
}

Future<void> execute(List<String> args) async {
  if (args.contains('--help')) {
    stdout.writeln(usage);
    return;
  }
  final orders = args.where((a) => !a.startsWith('--')).toList();
  final options = args.where((a) => a.startsWith('--')).toList();
  final order = orders.isEmpty ? 'build' : orders.first;
  if (orders.length > 1 ||
      ![
        'build',
        'install',
        'run',
        'deploy',
        'backend',
        'usb',
        'check',
        'release',
        'devices',
        'doctor',
        'help',
        '-h',
      ].contains(order)) {
    stdout.writeln(usage);
    exit(order == 'help' || order == '-h' ? 0 : 64);
  }
  if (order == 'help' || order == '-h') {
    stdout.writeln(usage);
    return;
  }
  String? option(String name) => options
      .where((o) => o.startsWith('--$name='))
      .map((o) => o.substring(name.length + 3))
      .firstOrNull;
  var api = option('api');
  final device = option('device');
  final universal = options.contains('--universal');
  final noAiEnv = options.contains('--no-ai-env');
  final usb = options.contains('--usb') || order == 'deploy' || order == 'usb';
  final skipBuild = options.contains('--skip-build');
  final watch = options.contains('--watch');
  var port = int.tryParse(option('port') ?? '8082');
  for (final o in options) {
    if (!RegExp(r'^--(api|device|port)=.+$').hasMatch(o) &&
        ![
          '--universal',
          '--no-ai-env',
          '--usb',
          '--skip-build',
          '--watch',
        ].contains(o)) {
      fail('Opcion desconocida: $o\n$usage');
    }
  }
  if (port == null || port < 1024 || port > 65535) {
    fail('--port debe estar entre 1024 y 65535.');
  }
  if (watch && order != 'usb') fail('--watch solo se usa con usb.');
  if (api != null) {
    final url = Uri.tryParse(api);
    if (url == null ||
        !['http', 'https'].contains(url.scheme) ||
        url.host.isEmpty ||
        url.userInfo.isNotEmpty ||
        url.hasQuery ||
        url.hasFragment) {
      fail(
        '--api requiere una URL http(s) sin credenciales, consulta ni fragmento.',
      );
    }
  }
  if (usb && api != null)
    fail('Usa --usb o --api; USB configura http://127.0.0.1:PUERTO.');
  if (options.contains('--usb') &&
      !['install', 'run', 'deploy', 'usb'].contains(order)) {
    fail('--usb solo se usa con install, run, deploy o usb.');
  }
  if (skipBuild && order != 'install')
    fail('--skip-build solo se usa con install.');
  if (skipBuild &&
      (api != null || option('port') != null || usb || noAiEnv || universal)) {
    fail(
      '--skip-build conserva la configuracion del APK existente. Usa apk.bat usb para reconectar el backend.',
    );
  }

  if (!File('pubspec.yaml').existsSync() ||
      !File('tool/bootstrap.dart').existsSync()) {
    fail(
      'Ejecuta esto desde mobile/ o con apk.bat / apk.sh desde la raiz del paquete.',
    );
  }

  if (order == 'backend') {
    port = await startBackend(['$port']);
    stdout.writeln('Backend listo: http://127.0.0.1:$port');
    return;
  }
  if (order == 'doctor') {
    await doctor();
    return;
  }
  if (order == 'devices') {
    await listDevices();
    return;
  }

  // Fallar antes de descargar dependencias o compilar si el telefono no esta listo.
  final serial = watch && device != null
      ? device
      : ['install', 'run', 'deploy', 'usb'].contains(order)
      ? await pickDevice(requested: device)
      : null;
  if (skipBuild) {
    final apk = File('dist/$appId-debug.apk');
    if (!apk.existsSync())
      fail('No existe ${apk.path}; ejecuta primero apk.bat build.');
    await install(apk, serial!);
    return;
  }
  if (order == 'deploy') port = await startBackend(['$port']);
  if (usb) {
    if (watch) {
      final adb =
          findAdb() ??
          fail('adb no encontrado; instala Android SDK Platform-Tools.');
      await watchUsb(adb, serial!, port);
      return;
    }
    await connectUsb(serial!, port);
    api = 'http://127.0.0.1:$port';
    if (order == 'usb') return;
  }
  await checkFlutter();

  final defines = <String>[
    if (!noAiEnv && File('ai.env').existsSync())
      '--dart-define-from-file=ai.env',
    if (api != null) '--dart-define=API_BASE_URL=$api',
  ];
  if (defines.any((d) => d.contains('ai.env'))) {
    step(
      'Incrustando mobile/ai.env (claves de IA en linea). Este APK es para uso propio: no lo distribuyas con claves dentro.',
    );
  }

  await prepare();
  if (order == 'check') {
    await flutter(['analyze']);
    await flutter(['test']);
    return;
  }
  if (order == 'run') {
    step('flutter run en $serial (Ctrl+C para salir; r = recarga en caliente)');
    await flutter(['run', '-d', serial!, ...defines]);
    return;
  }

  final release = order == 'release';
  final apk = await build(
    release: release,
    universal: universal,
    defines: defines,
  );
  if (order != 'install' && order != 'deploy') {
    stdout.writeln('\nListo. Copia este archivo al telefono e instalalo:');
    stdout.writeln('  ${apk.absolute.path}');
    stdout.writeln(
      'O conecta el telefono por USB y ejecuta: apk.bat install --skip-build',
    );
    return;
  }
  await install(apk, serial!);
}

// ---------------------------------------------------------------------------

Future<void> checkFlutter() async {
  final result = await capture(flutterExe, ['--version']);
  if (result == null) {
    fail(
      'No se encontro Flutter en el PATH. Instalalo desde https://docs.flutter.dev/get-started/install y vuelve a abrir la terminal.',
    );
  }
  final version = RegExp(r'Flutter (\S+)').firstMatch(result)?.group(1);
  stdout.writeln('Flutter ${version ?? 'detectado'}');
}

Future<void> doctor() async {
  await flutter(['doctor', '-v']);
  final adb = findAdb();
  stdout.writeln(
    adb == null
        ? 'adb: no encontrado. Instala Android SDK Platform-Tools o define ANDROID_HOME.'
        : 'adb: $adb',
  );
  if (adb != null) await listDevices();
  stdout.writeln(
    File('android/app/build.gradle.kts').existsSync()
        ? 'Proyecto Android: preparado.'
        : 'Proyecto Android: se creara con dart run tool/bootstrap.dart en la primera compilacion.',
  );
  stdout.writeln(
    File('ai.env').existsSync()
        ? 'ai.env: presente, se incrustara al compilar.'
        : 'ai.env: ausente (opcional). Copia ai.env.example para usar IA en linea.',
  );
  final apk = File('dist/$appId-debug.apk');
  if (apk.existsSync()) stdout.writeln('Ultimo APK: ${apk.absolute.path}');
}

Future<void> prepare() async {
  if (!File('android/app/build.gradle.kts').existsSync()) {
    step('Creando el proyecto Android (solo la primera vez)');
    await dart(['tool/bootstrap.dart']);
  }
  step('Descargando dependencias');
  await flutter(['pub', 'get']);
}

Future<File> build({
  required bool release,
  required bool universal,
  required List<String> defines,
}) async {
  final mode = release ? 'release' : 'debug';
  step('Compilando APK $mode${universal ? ' universal' : ' ARM64'}');
  await flutter([
    'build',
    'apk',
    '--$mode',
    if (!universal) '--target-platform',
    if (!universal) 'android-arm64',
    ...defines,
  ]);
  final built = File('build/app/outputs/flutter-apk/app-$mode.apk');
  if (!built.existsSync()) fail('Flutter termino sin producir ${built.path}');
  await Directory('dist').create(recursive: true);
  final target = File('dist/$appId-$mode.apk');
  await built.copy(target.path);
  final mb = (await target.length()) / 1048576;
  stdout.writeln(
    'APK listo: ${target.absolute.path} (${mb.toStringAsFixed(1)} MB)',
  );
  if (release) {
    stdout.writeln(
      'Release con firma de depuracion: sirve para instalar por USB o compartir el archivo, no para tiendas. Para publicar configura tu propia firma en android/app/build.gradle.kts.',
    );
  }
  return target;
}

Future<void> install(File apk, String serial) async {
  final adb =
      findAdb() ??
      fail('adb no encontrado; instala Android SDK Platform-Tools.');
  step('Instalando en $serial');
  await run(adb, ['-s', serial, 'install', '-r', apk.path]);
  step('Abriendo la app');
  await run(adb, [
    '-s',
    serial,
    'shell',
    'monkey',
    '-p',
    packageName,
    '-c',
    'android.intent.category.LAUNCHER',
    '1',
  ], quiet: true);
  stdout.writeln(
    '\nInstalada y abierta en el telefono. Usuario admin, contraseña admin.',
  );
}

Future<void> connectUsb(String serial, int port) async {
  final adb =
      findAdb() ??
      fail('adb no encontrado; instala Android SDK Platform-Tools.');
  await run(adb, ['-s', serial, 'reverse', 'tcp:$port', 'tcp:$port']);
  stdout.writeln(
    'USB listo: http://127.0.0.1:$port. Activa Conectar a un servidor en el login.',
  );
  stdout.writeln(
    'Para reconexion automatica deja activo: apk.bat usb --watch --port=$port --device=$serial.',
  );
}

// ---------------------------------------------------------------------------
// adb
// ---------------------------------------------------------------------------

String? findAdb() {
  final exe = Platform.isWindows ? 'adb.exe' : 'adb';
  final home =
      Platform.environment['HOME'] ?? Platform.environment['USERPROFILE'];
  final candidates = <String?>[
    Platform.environment['ANDROID_HOME'],
    Platform.environment['ANDROID_SDK_ROOT'],
    if (Platform.isWindows && Platform.environment['LOCALAPPDATA'] != null)
      '${Platform.environment['LOCALAPPDATA']}/Android/Sdk',
    if (Platform.isMacOS && home != null) '$home/Library/Android/sdk',
    if (Platform.isLinux && home != null) '$home/Android/Sdk',
  ];
  for (final sdk in candidates) {
    if (sdk == null) continue;
    final file = File('$sdk/platform-tools/$exe');
    if (file.existsSync()) return file.path;
  }
  final onPath = Process.runSync(Platform.isWindows ? 'where' : 'which', [
    exe,
  ], runInShell: Platform.isWindows);
  if (onPath.exitCode == 0) {
    final first = onPath.stdout.toString().trim().split('\n').first.trim();
    if (first.isNotEmpty) return first;
  }
  return null;
}

class Device {
  final String serial, state, model;
  Device(this.serial, this.state, this.model);
  @override
  String toString() =>
      '$serial  ${state.padRight(12)} ${model.isEmpty ? '' : model}'.trim();
}

Future<List<Device>> devices() async {
  final adb = findAdb();
  if (adb == null) return [];
  final out = await capture(adb, ['devices', '-l']) ?? '';
  return parseDevices(out);
}

List<Device> parseDevices(String out) => out
    .split('\n')
    .map((l) => l.trim())
    .where((l) => RegExp(r'^\S+\s+(device|offline|unauthorized)\b').hasMatch(l))
    .map((l) {
      final parts = l.split(RegExp(r'\s+'));
      final model = parts
          .where((p) => p.startsWith('model:'))
          .map((p) => p.substring(6))
          .firstOrNull;
      return Device(parts[0], parts.length > 1 ? parts[1] : '?', model ?? '');
    })
    .toList();

Future<void> listDevices() async {
  final found = await devices();
  if (found.isEmpty) {
    stdout.writeln(
      'Ningun telefono conectado. Activa Opciones de desarrollador > Depuracion USB, conecta el cable y acepta el aviso en la pantalla.',
    );
    return;
  }
  stdout.writeln('Telefonos:');
  for (final d in found) stdout.writeln('  $d');
}

Future<String> pickDevice({String? requested}) async {
  if (findAdb() == null)
    fail('adb no encontrado; instala Android SDK Platform-Tools.');
  final found = await devices();
  try {
    return selectDevice(found, requested: requested);
  } on StateError catch (error) {
    fail(error.message);
  }
}

String selectDevice(List<Device> found, {String? requested}) {
  if (requested != null) {
    final selected = found.where((d) => d.serial == requested).firstOrNull;
    if (selected == null)
      throw StateError('El dispositivo $requested no esta conectado.');
    if (selected.state != 'device') {
      throw StateError(
        'El dispositivo $requested esta ${selected.state}. Desbloquealo y acepta la depuracion USB.',
      );
    }
    return selected.serial;
  }
  final ready = found.where((d) => d.state == 'device').toList();
  if (ready.length == 1) return ready.single.serial;
  if (ready.isEmpty) {
    final unauthorized = found.any((d) => d.state == 'unauthorized');
    throw StateError(
      unauthorized
          ? 'El telefono pide permiso: acepta "Permitir depuracion USB" en su pantalla y repite.'
          : 'Ningun telefono listo. Activa Depuracion USB, conecta el cable y comprueba con: apk.bat devices',
    );
  }
  throw StateError(
    'Hay varios dispositivos; elige --device=SERIAL: ${ready.map((d) => d.serial).join(', ')}',
  );
}

// ---------------------------------------------------------------------------
// procesos
// ---------------------------------------------------------------------------

String get flutterExe => Platform.isWindows ? 'flutter.bat' : 'flutter';
String get dartExe => Platform.isWindows ? 'dart.bat' : 'dart';

Future<void> flutter(List<String> args) => run(flutterExe, args);
Future<void> dart(List<String> args) => run(dartExe, args);

Future<void> run(String exe, List<String> args, {bool quiet = false}) async {
  final process = await Process.start(
    exe,
    args,
    mode: quiet ? ProcessStartMode.normal : ProcessStartMode.inheritStdio,
    runInShell: Platform.isWindows,
  );
  if (quiet) {
    process.stdout.drain<void>();
    process.stderr.drain<void>();
  }
  final code = await process.exitCode;
  if (code != 0) fail('Fallo: $exe ${args.join(' ')} (codigo $code)');
}

Future<String?> capture(String exe, List<String> args) async {
  try {
    final result = await Process.run(exe, args, runInShell: Platform.isWindows);
    if (result.exitCode != 0) return null;
    return result.stdout.toString();
  } on ProcessException {
    return null;
  }
}

void step(String text) => stdout.writeln('\n== $text');

Never fail(String message) {
  if (message.isNotEmpty) stderr.writeln(message);
  exit(1);
}
