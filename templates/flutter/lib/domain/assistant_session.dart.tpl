import 'dart:convert';

class AssistantSession {
  int generation = 0;
  final List<Map<String, dynamic>> _messages = [];
  final List<Map<String, dynamic>> _evidence = [];
  final List<Map<String, dynamic>> _confirmed = [];
  Map<String, dynamic>? _references;
  List<Map<String, dynamic>> get messages => List.unmodifiable(_messages);
  List<Map<String, dynamic>> get evidence => List.unmodifiable(_evidence);
  String? pendingInstruction;
  String? pendingQuestion;
  String? mode;
  Map<String, dynamic>? pendingDraft;
  String? continuationRequest;
  Map<String, dynamic> get facts => {
    if (_references != null) 'lastReferences': _references,
    if (_confirmed.isNotEmpty)
      'confirmedChanges': List.unmodifiable(_confirmed),
  };

  void add(String role, String text) {
    _messages.add({'role': role, 'text': text});
    while (_messages.length > 24) {
      _messages.removeAt(0);
    }
  }

  void beginInstruction(String instruction) {
    continuationRequest = null;
    // Only an affirmative continuation can resume a confirmed request.
    // A new request or a negation must never implicitly resume old writes.
    if (pendingInstruction == null &&
        _confirmed.isNotEmpty &&
        RegExp(
          r'^(contin[uú]a|sigue|prosigue)(\s|[.!]|$)',
          caseSensitive: false,
        ).hasMatch(instruction.trim())) {
      final original = _confirmed.last['request'];
      if (original is String && original.isNotEmpty) {
        continuationRequest = original;
        pendingInstruction = original;
      }
    }
    pendingInstruction ??= instruction;
  }

  void remember(Map<String, dynamic> result, {String? primaryKey}) {
    _evidence.add(Map<String, dynamic>.unmodifiable(result));
    while (_evidence.length > 6) {
      _evidence.removeAt(0);
    }
    final data = result['data'];
    if (primaryKey == null || data is! Map) return;
    final rows = data['records'] is List
        ? data['records'] as List
        : data['record'] is Map
        ? [data['record']]
        : null;
    if (rows == null) return;
    // Facts come only from validated tools, never from free-form model text.
    // They identify earlier results; they do not authorize edits or replace a fresh read.
    _references = {
      'resource': result['arguments']['resource'],
      'primaryKey': primaryKey,
      'records': [
        for (final row in rows.take(8))
          if (row is Map && row.containsKey(primaryKey))
            {
              primaryKey: row[primaryKey],
              for (final entry
                  in row.entries
                      .where((e) => e.key != primaryKey && e.value is String)
                      .take(2))
                if ((entry.value as String).length <= 120)
                  entry.key.toString(): entry.value,
            },
      ],
      'hasMore': result['nextCursor'] != null || rows.length > 8,
      if (result['revision'] != null) 'revision': result['revision'],
      'requiresFreshReadBeforeChange': true,
    };
  }

  void recordCommitted(Map<String, dynamic> draft) {
    final proposal = draft['proposal'] as Map;
    _confirmed.add({
      'request': pendingInstruction,
      'draftId': draft['draftId'],
      'action': proposal['action'],
      'resource': proposal['resource'],
      'id': proposal['id'],
      'data': proposal['data'],
      'status': 'saved_locally',
    });
    // Keep full JSON values or evict the receipt; never truncate identifiers.
    while (_confirmed.length > 4 ||
        utf8.encode(jsonEncode(_confirmed)).length > 3000) {
      _confirmed.removeAt(0);
    }
    _references = null;
    _evidence.clear();
  }

  List<Map<String, dynamic>> recent(int maxBytes) {
    final result = <Map<String, dynamic>>[];
    var size = 0;
    for (final entry in _messages.reversed) {
      final bytes = utf8.encode(jsonEncode(entry)).length;
      if (size + bytes > maxBytes) break;
      result.insert(0, entry);
      size += bytes;
    }
    return result;
  }

  void clear() {
    generation++;
    _messages.clear();
    _evidence.clear();
    _confirmed.clear();
    _references = null;
    pendingInstruction = null;
    pendingQuestion = null;
    mode = null;
    pendingDraft = null;
    continuationRequest = null;
  }
}
