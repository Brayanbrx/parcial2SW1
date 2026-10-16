import 'dart:async';
import 'dart:isolate';
import 'package:flutter/services.dart';
import '../domain/assistant_ports.dart';

typedef WorkerEngineFactory =
    Future<LocalTextEngine> Function(List<String> args);

/// Keep native initialization, inference and disposal off the UI isolate.
/// Only strings and ports cross the boundary; native handles stay in the worker.
class IsolatedTextEngine implements LocalTextEngine {
  final SendPort commands;
  IsolatedTextEngine._(this.commands);

  static Future<IsolatedTextEngine> open(
    WorkerEngineFactory factory,
    List<String> args,
  ) async {
    final ready = ReceivePort();
    try {
      await Isolate.spawn(_worker, [
        ready.sendPort,
        RootIsolateToken.instance,
        factory,
        args,
      ]);
      final result = await ready.first;
      if (result is String) throw StateError(result);
      return IsolatedTextEngine._(result as SendPort);
    } finally {
      ready.close();
    }
  }

  @override
  Stream<String> generate(String system, String context) async* {
    final replies = ReceivePort();
    commands.send(['generate', replies.sendPort, system, context]);
    try {
      await for (final message in replies) {
        final event = message as List;
        if (event[0] == 'done') break;
        if (event[0] == 'formatError')
          throw FormatException(event[1] as String);
        if (event[0] == 'error') throw StateError(event[1] as String);
        yield event[1] as String;
      }
    } finally {
      replies.close();
    }
  }

  Future<void> _command(String name) async {
    final reply = ReceivePort();
    commands.send([name, reply.sendPort]);
    try {
      final error = await reply.first;
      if (error != null) throw StateError(error as String);
    } finally {
      reply.close();
    }
  }

  @override
  Future<void> stop() => _command('stop');
  @override
  Future<void> close() => _command('close');
}

Future<void> _worker(List<dynamic> start) async {
  final ready = start[0] as SendPort;
  final token = start[1] as RootIsolateToken?;
  final commands = ReceivePort();
  LocalTextEngine engine;
  try {
    if (token != null)
      BackgroundIsolateBinaryMessenger.ensureInitialized(token);
    engine = await (start[2] as WorkerEngineFactory)(start[3] as List<String>);
  } catch (error) {
    ready.send(error.toString());
    commands.close();
    return;
  }
  ready.send(commands.sendPort);
  Future<void>? generating;
  var busy = false;
  commands.listen((dynamic value) async {
    final command = value as List;
    final reply = command[1] as SendPort;
    if (command[0] == 'generate') {
      if (busy) {
        reply.send(['error', 'Ya hay una inferencia activa']);
        reply.send(['done']);
        return;
      }
      busy = true;
      generating = () async {
        try {
          await for (final text in engine.generate(command[2], command[3])) {
            reply.send(['token', text]);
          }
        } on FormatException catch (error) {
          reply.send(['formatError', error.message]);
        } catch (error) {
          reply.send(['error', error.toString()]);
        } finally {
          busy = false;
          reply.send(['done']);
        }
      }();
      return;
    }
    try {
      if (command[0] == 'stop') await engine.stop();
      if (command[0] == 'close') {
        await generating;
        await engine.close();
        commands.close();
      }
      reply.send(null);
    } catch (error) {
      reply.send(error.toString());
      if (command[0] == 'close') commands.close();
    }
  });
}
