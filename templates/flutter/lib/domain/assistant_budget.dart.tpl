import 'dart:convert';

/// Preflight estimate: these plugins do not expose a tokenizer for new input.
/// Reserve output plus framing headroom; the runtime enforces the hard limit.
class AssistantBudget {
  static const contextTokens = 4096;
  static const outputTokens = 768;
  static const framingTokens = 256;

  static int estimate(String text) => (utf8.encode(text).length + 2) ~/ 3;

  static void check(String input, {int usedTokens = 0}) {
    if (usedTokens + estimate(input) + outputTokens + framingTokens >
        contextTokens) {
      throw StateError(
        'El contexto no deja espacio suficiente para responder. Acota la solicitud o inicia una nueva conversacion. No se guardaron cambios.',
      );
    }
  }
}
