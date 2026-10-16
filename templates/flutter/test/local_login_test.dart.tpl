import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../lib/data/api.dart';
import '../lib/data/local_auth.dart';
import '../lib/domain/schema.dart';
import '../lib/ui/app_model.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;
  final contract = <String, dynamic>{
    'resources': [
      {
        'className': 'Cliente',
        'path': '/api/clientes',
        'primaryKey': 'id',
        'fields': [
          {
            'name': 'id',
            'javaType': 'String',
            'primaryKey': true,
            'nullable': false,
          },
          {'name': 'nombre', 'javaType': 'String', 'nullable': false},
        ],
      },
    ],
  };
  late Directory directory;
  late String previousPath;
  late AppModel model;
  var requests = 0;
  AppModel newModel() => AppModel(
    AppSchema(contract),
    ApiClient(
      client: MockClient((_) async {
        requests++;
        throw const SocketException('Sin internet');
      }),
    ),
    SessionStore(),
  );
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    requests = 0;
    directory = await Directory.systemTemp.createTemp('local-login-');
    previousPath = await databaseFactory.getDatabasesPath();
    await databaseFactory.setDatabasesPath(directory.path);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMessageHandler('flutter/assets', (message) async {
          if (utf8.decode(message!.buffer.asUint8List()) !=
              'assets/contract.json')
            return null;
          return ByteData.sublistView(
            Uint8List.fromList(utf8.encode(jsonEncode(contract))),
          );
        });
    rootBundle.evict('assets/contract.json');
    model = newModel();
  });
  tearDown(() async {
    await model.repository?.local.close();
    model.dispose();
    await databaseFactory.setDatabasesPath(previousPath);
    await directory.delete(recursive: true);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMessageHandler('flutter/assets', null);
    rootBundle.evict('assets/contract.json');
  });

  test(
    'primera instalacion, login y CRUD persisten sin ninguna solicitud HTTP',
    () async {
      // A pending remote revocation must not cause networking in local mode either.
      await model.sessions.saveLogouts([
        {'url': 'https://server.test', 'refreshToken': 'old'},
      ]);
      await model.restore();
      expect(model.session, isNull);
      final seed = await model.sessions.storage.read(key: LocalAuth.accountKey);
      expect(seed, isNotNull);
      expect(jsonDecode(seed!)['hash'], isNot('admin'));
      await expectLater(
        model.loginLocal('admin', 'incorrecta'),
        throwsA(isA<ApiFailure>()),
      );
      await expectLater(
        model.loginLocal('otro', 'admin'),
        throwsA(isA<ApiFailure>()),
      );
      expect(model.session, isNull);
      await model.loginLocal('admin', 'admin');
      expect(model.session!.isLocal, isTrue);
      expect(model.session!.token, isEmpty);
      expect(model.timer, isNull);
      final resource = model.selected;
      await model.save(resource, {'id': '1', 'nombre': 'Ana'}, create: true);
      await model.sync();
      await expectLater(
        model.api.request('GET', '/api/clientes'),
        throwsA(isA<ApiFailure>()),
      );
      await model.logout();
      expect(
        await model.sessions.storage.read(key: LocalAuth.accountKey),
        seed,
      );
      await model.loginLocal('admin', 'admin');
      expect(model.rows.single['nombre'], 'Ana');
      await model.save(resource, {
        'id': '1',
        'nombre': 'Ana editada',
      }, create: false);
      await model.repository!.local.close();
      model.dispose();
      model = newModel();
      await model.restore();
      expect(model.isLocal, isTrue);
      expect(model.rows.single['nombre'], 'Ana editada');
      await model.delete(model.selected, '1');
      expect(model.rows, isEmpty);
      await model.logout();
      await model.loginLocal('admin', 'admin');
      expect(model.rows, isEmpty);
      expect(requests, 0);
    },
    timeout: const Timeout(Duration(minutes: 2)),
  );

  test('sesiones remotas anteriores siguen siendo remotas', () {
    final old = {
      'url': 'https://server.test',
      'username': 'admin',
      'token': 'token',
      'expiresAt': 123,
    };
    expect(Session.fromJson(old).isLocal, isFalse);
    expect(
      Session.fromJson(
        Session('local://device', 'admin', '', 0, isLocal: true).toJson(),
      ).isLocal,
      isTrue,
    );
  });
}
