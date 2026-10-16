import 'dart:convert';
import 'dart:io';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../../lib/data/api.dart';
import '../../lib/data/local_store.dart';
import '../../lib/data/model_library.dart';
import '../../lib/data/repository.dart';
import '../../lib/domain/assistant_ports.dart';
import '../../lib/domain/schema.dart';

AppSchema assistantSchema() => AppSchema({
  'resources': [
    {
      'className': 'Cliente',
      'path': '/api/clientes',
      'primaryKey': 'id',
      'fields': [
        {
          'name': 'id',
          'javaType': 'Integer',
          'nullable': false,
          'primaryKey': true,
        },
        {'name': 'nombre', 'javaType': 'String', 'nullable': false},
        {'name': 'telefono', 'javaType': 'String', 'nullable': true},
        {
          'name': 'saldo',
          'javaType': 'BigDecimal',
          'nullable': true,
          'precision': 12,
          'scale': 2,
        },
      ],
    },
  ],
});

Future<Repository> assistantRepository() async {
  sqfliteFfiInit();
  final store = await LocalStore.open(
    'assistant-test',
    factory: databaseFactoryFfi,
    path: inMemoryDatabasePath,
  );
  final api = ApiClient()
    ..session = Session('local://test', 'admin', '', 0, isLocal: true);
  final repository = Repository(store, api, assistantSchema());
  for (final row in [
    {'id': 1, 'nombre': 'Ana Perez', 'telefono': '111', 'saldo': 0.1},
    {'id': 2, 'nombre': 'Ana Lopez', 'telefono': '222', 'saldo': 0.2},
    {'id': 3, 'nombre': 'Luis', 'telefono': null, 'saldo': null},
  ]) {
    await store.db.insert('records', {
      'resource': 'clientes',
      'id': row['id'].toString(),
      'payload': jsonEncode(row),
      'deleted': 0,
    });
  }
  return repository;
}

ModelLibrary assistantLibrary() {
  final library = ModelLibrary(Directory('unused-assistant-test-models'));
  library.models.add(
    const LocalModelFile(
      '11111111-1111-4111-8111-111111111111',
      'test',
      ModelRuntime.litertlm,
      100,
    ),
  );
  library.textId = library.models.single.id;
  return library;
}

String toolReply(String name, Map<String, dynamic> args) =>
    jsonEncode({'version': 1, 'kind': 'tool', 'name': name, 'arguments': args});
String answerReply(String text, [String kind = 'answer']) =>
    jsonEncode({'version': 1, 'kind': kind, 'text': text});

class ScriptedEngine implements LocalTextEngine {
  final List<String> responses;
  final List<Map<String, dynamic>> contexts = [];
  int stops = 0, closes = 0;
  ScriptedEngine(this.responses);
  @override
  Stream<String> generate(String system, String context) async* {
    contexts.add(Map<String, dynamic>.from(jsonDecode(context)));
    final response = responses.removeAt(0);
    // Split JSON so no consumer can execute partial arguments.
    final middle = response.length ~/ 2;
    yield response.substring(0, middle);
    yield response.substring(middle);
  }

  @override
  Future<void> stop() async {
    stops++;
  }

  @override
  Future<void> close() async {
    closes++;
  }
}
