import 'dart:convert';
import 'assistant_ports.dart';
import 'assistant_protocol.dart';
import 'assistant_session.dart';

class AssistantOutcome {
  final String kind, text;
  final Map<String, dynamic>? draft;
  final int steps;
  const AssistantOutcome(this.kind, this.text, this.steps, {this.draft});
}

class AssistantRunner {
  final AssistantCompletion complete;
  final AssistantTools tools;
  final AssistantSession session;
  final void Function() checkActive;
  final void Function(String) progress;
  final int maxSteps, maxRepairs;
  AssistantRunner({
    required this.complete,
    required this.tools,
    required this.session,
    required this.checkActive,
    required this.progress,
    this.maxSteps = 8,
    this.maxRepairs = 2,
  });

  Future<AssistantOutcome> run(
    String instruction,
    String resource,
    String runId,
  ) async {
    final clean = instruction.trim();
    if (clean.isEmpty || clean.length > 2000)
      throw const FormatException('Usa entre 1 y 2000 caracteres');
    checkActive();
    session.add('user', clean);
    session.beginInstruction(clean);
    final transcript = <Map<String, dynamic>>[];
    final repeated = <String>{};
    var repairs = 0;
    var hasEvidence = false;
    for (var step = 1; step <= maxSteps; step++) {
      checkActive();
      progress('Consultando el modelo · paso $step de $maxSteps');
      final now = DateTime.now();
      final context = <String, dynamic>{
        'protocol': 1,
        'runId': runId,
        'step': step,
        'resource': resource,
        'catalog': tools.catalog,
        'clock': {
          'local': now.toIso8601String(),
          'offsetMinutes': now.timeZoneOffset.inMinutes,
        },
        'pendingInstruction': session.pendingInstruction,
        if (session.continuationRequest != null)
          'continuation': {
            'originalRequest': session.continuationRequest,
            'completed': (session.facts['confirmedChanges'] as List)
                .where(
                  (entry) => entry['request'] == session.continuationRequest,
                )
                .toList(),
            'nextAction':
                'Prepara solo el siguiente cambio pendiente de originalRequest. Cada cambio requiere otra confirmacion. Si todos se completaron informa el resultado, no repitas operaciones.',
          },
        if (session.facts.isNotEmpty) 'facts': session.facts,
        if (session.pendingQuestion != null)
          'pendingQuestion': session.pendingQuestion,
        'history': session.recent(1600),
        'instruction': clean,
        if (session.evidence.isNotEmpty)
          'previousEvidence': session.evidence.last,
        'tools': assistantToolDefinitions(),
        'transcript': transcript,
      };
      // Evict complete entries, never slice JSON or the pending instruction.
      while (utf8.encode(assistantSystemPrompt + jsonEncode(context)).length >
              8500 &&
          transcript.length > 1) {
        transcript.removeAt(0);
      }
      if (utf8.encode(assistantSystemPrompt + jsonEncode(context)).length >
          9500)
        context.remove('previousEvidence');
      if (utf8.encode(assistantSystemPrompt + jsonEncode(context)).length >
          9500)
        context['history'] = session.recent(600);
      if (utf8.encode(assistantSystemPrompt + jsonEncode(context)).length >
          9500) {
        context['catalog'] = [
          for (final entry in tools.catalog)
            if (entry['resource'] == resource)
              entry
            else
              {
                'resource': entry['resource'],
                'name': entry['name'],
                'fields': 'Usa describe_resource para consultar los campos',
              },
        ];
      }
      if (utf8.encode(assistantSystemPrompt + jsonEncode(context)).length >
          10000) {
        return _finish(
          'limit',
          'El contexto es demasiado grande. Acota la consulta o inicia una nueva conversacion.',
          step,
        );
      }
      String? raw;
      try {
        raw = await complete(assistantSystemPrompt, jsonEncode(context));
        final reply = AssistantReply.parse(raw);
        checkActive();
        if (reply.kind == 'no_change') {
          session.pendingInstruction = null;
          session.pendingQuestion = null;
          return _finish(
            'answer',
            'De acuerdo. No he preparado ni guardado ningun cambio.',
            step,
          );
        }
        if (reply.kind != 'tool') {
          if (reply.kind == 'answer' && !hasEvidence) {
            throw const FormatException(
              'Antes de responder consulta una herramienta: aggregate_records para contar/calcular, '
              'search_records/get_record para datos, describe_resource para campos. '
              'La ausencia de resultados en el contexto no significa que no haya datos. '
              'Para cambios usa prepare_change; no respondas anunciando que vas a prepararlos. '
              'Si necesitas aclaracion usa kind question.',
            );
          }
          session.pendingQuestion = reply.kind == 'question'
              ? reply.text
              : null;
          if (reply.kind == 'answer') session.pendingInstruction = null;
          return _finish(reply.kind, reply.text, step);
        }
        final signature = jsonEncode(
          _canonical({'name': reply.tool, 'arguments': reply.arguments}),
        );
        if (!repeated.add(signature)) {
          return _finish(
            'limit',
            'El modelo repitio la misma consulta. Revisa los resultados o precisa la solicitud.',
            step,
          );
        }
        progress(switch (reply.tool) {
          'describe_resource' => 'Consultando los campos disponibles…',
          'search_records' => 'Buscando registros locales…',
          'get_record' => 'Leyendo el registro…',
          'aggregate_records' => 'Calculando sobre los datos locales…',
          'prepare_change' => 'Validando el cambio…',
          _ => 'Validando herramienta…',
        });
        final result = await tools.execute(reply.tool!, reply.arguments);
        checkActive();
        final event = {
          'callId': '$runId:$step',
          'name': reply.tool,
          'arguments': reply.arguments,
          ...result,
        };
        transcript.add(event);
        if (result['ok'] == true) {
          hasEvidence = true;
          final metadata = tools.catalog
              .where((item) => item['resource'] == reply.arguments['resource'])
              .firstOrNull;
          session.remember(
            event,
            primaryKey: metadata?['primaryKey'] as String?,
          );
          if (reply.tool == 'prepare_change') {
            final proposal = result['data']['proposal'] as Map;
            if (proposal['action'] == 'CREATE') {
              final supplied = '${session.pendingInstruction ?? ''}\n$clean'
                  .toLowerCase();
              final fields = metadata?['fields'] as List? ?? [];
              final unsupported = <String>[];
              for (final field in fields) {
                if (field['required'] != true) continue;
                if (field['name'] == metadata?['primaryKey'] &&
                    field['type'] == 'UUID' &&
                    reply.arguments['data'][field['name']] == null)
                  continue;
                // A resource label ("cliente 4") is not a supplied name when
                // the user explicitly says that required field is missing.
                final explicitlyMissing = RegExp(
                  '\\bsin\\s+(?:(?:el|la|un|una)\\s+)?${RegExp.escape(field['name'].toString().toLowerCase())}\\b',
                ).hasMatch(clean.toLowerCase());
                if (explicitlyMissing) {
                  unsupported.add(field['name'].toString());
                  continue;
                }
                final value = proposal['data'][field['name']];
                if (value == null || !(value is String || value is num))
                  continue;
                final literal = value.toString().toLowerCase();
                final present = value is num
                    ? RegExp(
                        '(^|[^0-9.])${RegExp.escape(literal)}([^0-9.]|\$)',
                      ).hasMatch(supplied)
                    : supplied.contains(literal);
                if (!present) unsupported.add(field['name'].toString());
              }
              if (unsupported.isNotEmpty) {
                final question =
                    'Indica ${unsupported.join(', ')} para crear el registro. No usare valores que el modelo haya supuesto.';
                session.pendingQuestion = question;
                return _finish('question', question, step);
              }
            }
            session.pendingQuestion = null;
            session.pendingDraft = Map<String, dynamic>.from(result['data']);
            return _finish(
              'draft',
              'Revisa el cambio antes de guardarlo.',
              step,
              draft: Map<String, dynamic>.from(result['data']),
            );
          }
        } else if (result['error'] is Map &&
            result['error']['retryable'] == false) {
          session.pendingInstruction = null;
          session.pendingQuestion = null;
          return _finish('answer', result['error']['message'].toString(), step);
        } else if (++repairs > maxRepairs) {
          return _finish(
            'limit',
            'No pude completar la consulta con datos validos. Revisa la instruccion y los resultados.',
            step,
          );
        }
      } on FormatException catch (error) {
        checkActive();
        if (++repairs > maxRepairs) {
          return _finish(
            'error',
            'El modelo no produjo una respuesta valida. ${error.message}',
            step,
          );
        }
        transcript.add({
          'ok': false,
          'error': {'code': 'invalid_response', 'message': error.message},
          if (raw != null && raw.length <= 2000) 'invalidResponse': raw,
          'instruction':
              'Corrige la respuesta indicada; no la repitas igual. Cierra todos los objetos y listas JSON. Usa el protocolo version 1 o una funcion nativa declarada.',
        });
      }
    }
    return _finish(
      'limit',
      'Se alcanzo el limite de pasos. Puedes precisar la solicitud para continuar; no se guardaron cambios.',
      maxSteps,
    );
  }

  AssistantOutcome _finish(
    String kind,
    String text,
    int steps, {
    Map<String, dynamic>? draft,
  }) {
    checkActive();
    session.add('assistant', text);
    return AssistantOutcome(kind, text, steps, draft: draft);
  }

  Object? _canonical(Object? value) {
    if (value is Map) {
      final keys = value.keys.cast<String>().toList()..sort();
      return {for (final key in keys) key: _canonical(value[key])};
    }
    if (value is List) return value.map(_canonical).toList();
    return value;
  }
}
