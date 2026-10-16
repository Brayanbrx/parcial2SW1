import 'dart:convert';
import 'dart:math';
import 'package:cryptography/cryptography.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'api.dart';

// Run password derivation off the UI isolate, including on the first launch.
Future<List<int>> _derivePassword((String, List<int>) input) async {
  final key = await Pbkdf2(
    macAlgorithm: Hmac.sha256(),
    iterations: 600000,
    bits: 256,
  ).deriveKeyFromPassword(password: input.$1, nonce: input.$2);
  return key.extractBytes();
}

class LocalAuth {
  static const accountKey = 'local_admin_v1';
  final FlutterSecureStorage storage;
  Future<void>? _seeding;
  LocalAuth(this.storage);

  Future<void> ensureSeed() => _seeding ??= _seed();

  Future<void> _seed() async {
    try {
      if (await storage.read(key: accountKey) != null) return;
      final random = Random.secure();
      final salt = List<int>.generate(16, (_) => random.nextInt(256));
      final hash = await compute(_derivePassword, ('admin', salt));
      await storage.write(
        key: accountKey,
        value: jsonEncode({
          'username': 'admin',
          'salt': base64Encode(salt),
          'hash': base64Encode(hash),
        }),
      );
    } catch (_) {
      _seeding = null;
      rethrow;
    }
  }

  Future<Session> login(String username, String password) async {
    await ensureSeed();
    final account = jsonDecode((await storage.read(key: accountKey))!) as Map;
    final expected = base64Decode(account['hash'] as String);
    final actual = await compute(_derivePassword, (
      password,
      base64Decode(account['salt'] as String),
    ));
    var difference = expected.length ^ actual.length;
    for (var i = 0; i < expected.length && i < actual.length; i++) {
      difference |= expected[i] ^ actual[i];
    }
    if (difference != 0 || username.trim() != account['username']) {
      throw ApiFailure(401, 'Usuario o contraseña incorrectos');
    }
    return Session('local://device', 'admin', '', 0, isLocal: true);
  }
}
