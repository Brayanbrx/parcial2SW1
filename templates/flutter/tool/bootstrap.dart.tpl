import 'dart:io';

Future<void> main() async {
  if (File('android/app/build.gradle.kts').existsSync()) {
    stdout.writeln('Android ya preparado; no se sobrescribe.');
    return;
  }
  final temp = Directory('.bootstrap-${DateTime.now().microsecondsSinceEpoch}');
  final result =
      await Process.run(Platform.isWindows ? 'flutter.bat' : 'flutter', [
        'create',
        '--platforms=android',
        '--org',
        'com.uml.generated',
        '--project-name',
        '__APP_ID___mobile',
        temp.path,
      ], runInShell: Platform.isWindows);
  stdout.write(result.stdout);
  stderr.write(result.stderr);
  if (result.exitCode != 0) exit(result.exitCode);
  Future<void> copyDirectory(Directory source, Directory target) async {
    await target.create(recursive: true);
    await for (final item in source.list(followLinks: false)) {
      final name = item.path.split(Platform.pathSeparator).last;
      if (item is Directory)
        await copyDirectory(item, Directory('${target.path}/$name'));
      if (item is File) await item.copy('${target.path}/$name');
    }
  }

  await copyDirectory(Directory('${temp.path}/android'), Directory('android'));
  for (final name in ['.metadata']) {
    if (File('${temp.path}/$name').existsSync())
      await File('${temp.path}/$name').copy(name);
  }
  final gradle = File('android/app/build.gradle.kts');
  var source = await gradle.readAsString();
  source = source.replaceAll('minSdk = flutter.minSdkVersion', 'minSdk = 26');
  source = source.replaceAll(
    'ndkVersion = flutter.ndkVersion',
    'ndkVersion = "29.0.13113456"',
  );
  source = source.replaceAll(
    'release {',
    'release {\n            isMinifyEnabled = false\n            isShrinkResources = false',
  );
  await gradle.writeAsString(source);
  final rootGradle = File('android/build.gradle.kts');
  await rootGradle.writeAsString(
    'apply(from = "../tool/local_models.gradle")\n' +
        await rootGradle.readAsString(),
  );
  final manifest = File('android/app/src/main/AndroidManifest.xml');
  var xml = await manifest.readAsString();
  xml = xml.replaceFirst(
    '<application',
    '<uses-permission android:name="android.permission.INTERNET"/>\n<uses-permission android:name="android.permission.RECORD_AUDIO"/>\n<uses-permission android:name="android.permission.USE_BIOMETRIC"/>\n<application android:allowBackup="false"',
  );
  xml = xml.replaceFirst(
    '<queries>',
    '<queries>\n<intent><action android:name="android.speech.RecognitionService"/></intent>',
  );
  await manifest.writeAsString(xml);
  final debug = File('android/app/src/debug/AndroidManifest.xml');
  await debug.writeAsString(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:usesCleartextTraffic="true" /></manifest>',
  );
  // Only the tool-created temporary directory is removed; never an existing Android project.
  try {
    await temp.delete(recursive: true);
  } catch (_) {
    stdout.writeln('Carpeta temporal retenida por Windows: ${temp.path}');
  }
  stdout.writeln(
    'Android preparado. Ejecuta flutter pub get y flutter run. Release requiere HTTPS y firma propia para publicar.',
  );
}
