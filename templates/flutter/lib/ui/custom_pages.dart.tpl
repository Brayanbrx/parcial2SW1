import 'package:flutter/material.dart';
import 'app_model.dart';

/// Register business-specific screens here; common login/CRUD/sync remain reusable.
class AppPage {
  final String id, title;
  final Set<String> resources;
  final Widget Function(BuildContext, AppModel) builder;
  const AppPage({
    required this.id,
    required this.title,
    required this.builder,
    this.resources = const {},
  });
  bool supports(AppModel model) => resources.every(
    (name) => model.schema.resources.any((r) => r.resource == name),
  );
}

// Add imports and AppPage entries for the screens developed for this application.
// See docs/extension-and-deployment.md for a complete example.
final List<AppPage> customPages = [];
