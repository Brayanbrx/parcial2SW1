import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'package:crypto/crypto.dart';

class LocalStore {
  final Database db;
  LocalStore(this.db);
  static Future<LocalStore> open(
    String scope, {
    DatabaseFactory? factory,
    String? path,
  }) async {
    final f = factory ?? databaseFactory;
    final name = sha256.convert(utf8.encode(scope)).toString();
    final db = await f.openDatabase(
      path ?? '${await getDatabasesPath()}/uml_$name.db',
      options: OpenDatabaseOptions(
        version: 2,
        onUpgrade: (db, oldVersion, newVersion) async {
          if (oldVersion < 2)
            await db.execute(
              'ALTER TABLE outbox ADD COLUMN attempted INTEGER NOT NULL DEFAULT 1',
            );
        },
        onCreate: (db, version) async {
          await db.execute(
            'CREATE TABLE records(resource TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,server_payload TEXT,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(resource,id))',
          );
          await db.execute(
            'CREATE TABLE outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT UNIQUE NOT NULL,resource TEXT NOT NULL,id TEXT NOT NULL,method TEXT NOT NULL,payload TEXT,base TEXT,status TEXT NOT NULL DEFAULT \'pending\',message TEXT,attempted INTEGER NOT NULL DEFAULT 0,UNIQUE(resource,id))',
          );
        },
      ),
    );
    return LocalStore(db);
  }

  Future<List<Map<String, dynamic>>> rows(String resource) async =>
      (await db.query(
            'records',
            where: 'resource=? AND deleted=0',
            whereArgs: [resource],
            orderBy: 'id',
          ))
          .map(
            (r) =>
                Map<String, dynamic>.from(jsonDecode(r['payload'] as String)),
          )
          .toList();
  Future<List<Map<String, Object?>>> queue() =>
      db.query('outbox', orderBy: 'seq');
  Future<void> close() => db.close();
}
