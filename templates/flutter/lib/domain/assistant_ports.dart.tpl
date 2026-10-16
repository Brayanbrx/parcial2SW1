/// The engine never receives a database or a write callback.
abstract class LocalTextEngine {
  Stream<String> generate(String system, String context);
  Future<void> stop();
  Future<void> close();
}

typedef AssistantCompletion =
    Future<String> Function(String system, String context);

abstract class AssistantTools {
  List<Map<String, dynamic>> get catalog;
  Future<Map<String, dynamic>> execute(
    String name,
    Map<String, dynamic> arguments,
  );
}
