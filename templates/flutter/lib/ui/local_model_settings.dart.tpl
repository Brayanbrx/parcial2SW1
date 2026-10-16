import 'dart:io';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import '../data/model_library.dart';
import '../data/remote_ai.dart';

class LocalModelSettings extends StatelessWidget {
  final ModelLibrary library;
  final bool disabled;
  final Future<void> Function(Future<void> Function()) run;
  const LocalModelSettings({
    super.key,
    required this.library,
    required this.disabled,
    required this.run,
  });

  Future<void> importModel(bool speech) async {
    final selection = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: speech ? ['bin'] : ['litertlm', 'gguf'],
      withData: false,
    );
    final file = selection?.files.single;
    if (file?.path == null) return;
    final runtime = speech
        ? ModelRuntime.whisper
        : file!.name.toLowerCase().endsWith('.litertlm')
        ? ModelRuntime.litertlm
        : ModelRuntime.gguf;
    final model = await library.importFile(
      File(file!.path!),
      file.name,
      runtime,
    );
    await library.select(model);
  }

  Widget modeSelector(bool speech) => DropdownButtonFormField<String>(
    key: ValueKey(
      'mode-$speech-${speech ? library.speechMode : library.textMode}',
    ),
    initialValue: speech ? library.speechMode : library.textMode,
    isExpanded: true,
    itemHeight: null,
    decoration: InputDecoration(
      labelText: speech ? 'Origen de voz' : 'Origen de texto',
    ),
    items: const [
      DropdownMenuItem(
        value: 'local',
        child: Text(
          'En el dispositivo',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
      DropdownMenuItem(
        value: 'remote',
        child: Text('En linea', maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
    ],
    onChanged: disabled
        ? null
        : (v) => run(() async {
            if (v == null) return;
            if (speech) {
              library.speechMode = v;
            } else {
              library.textMode = v;
            }
            await library.save();
          }),
  );

  Future<void> removeModel(
    BuildContext context,
    LocalModelFile selected,
  ) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        scrollable: true,
        title: const Text('Quitar modelo'),
        content: Text(
          'Se quitara la copia de ${selected.name} de esta app. El archivo original se conserva.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Quitar'),
          ),
        ],
      ),
    );
    if (yes == true) await library.remove(selected);
  }

  Widget modelCard(BuildContext context, bool speech) {
    final selected = speech ? library.speech : library.text;
    final remote = speech ? library.speechRemote : library.textRemote;
    final models = library.models
        .where((m) => (m.runtime == ModelRuntime.whisper) == speech)
        .toList();
    return Card.outlined(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  speech ? Icons.mic_none : Icons.chat_bubble_outline,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    speech ? 'Voz' : 'Texto',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                if (!remote && selected != null)
                  IconButton(
                    tooltip: speech
                        ? 'Quitar modelo de voz'
                        : 'Quitar modelo de texto',
                    onPressed: disabled
                        ? null
                        : () => run(() => removeModel(context, selected)),
                    icon: const Icon(Icons.delete_outline, size: 20),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            if (remote)
              Text(
                (speech ? library.remote.speechReady : library.remote.textReady)
                    ? 'En linea · ${speech ? library.remote.speechLabel : library.remote.textLabel}'
                    : 'Configura el proveedor en Opciones.',
                style: Theme.of(context).textTheme.bodySmall,
              )
            else ...[
              if (models.isNotEmpty)
                DropdownButtonFormField<String>(
                  key: ValueKey(
                    'model-$speech-${selected?.id}-${models.length}',
                  ),
                  initialValue: selected?.id,
                  isExpanded: true,
                  itemHeight: null,
                  decoration: InputDecoration(
                    labelText: speech ? 'Modelo de voz' : 'Modelo de texto',
                  ),
                  items: models
                      .map(
                        (m) => DropdownMenuItem(
                          value: m.id,
                          child: Tooltip(
                            message: m.name,
                            child: Text(
                              m.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: disabled
                      ? null
                      : (id) => run(() async {
                          if (id != null)
                            await library.select(
                              models.firstWhere((m) => m.id == id),
                            );
                        }),
                )
              else
                Text(
                  speech
                      ? 'Dictado sin internet · opcional'
                      : 'Respuestas sin internet',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: disabled
                    ? null
                    : () => run(() => importModel(speech)),
                icon: const Icon(Icons.file_open_outlined, size: 20),
                label: Text(
                  selected == null ? 'Cargar modelo' : 'Cambiar archivo',
                  textAlign: TextAlign.center,
                ),
              ),
              if (selected == null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    speech ? 'Whisper .bin multilingue' : '.litertlm o .gguf',
                    style: Theme.of(context).textTheme.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      modelCard(context, false),
      const SizedBox(height: 12),
      modelCard(context, true),
      const SizedBox(height: 8),
      ExpansionTile(
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: 16),
        title: const Text('Opciones'),
        children: [
          modeSelector(false),
          const SizedBox(height: 16),
          modeSelector(true),
          const SizedBox(height: 16),
          if (library.textRemote || library.speechRemote) ...[
            const Text(
              'La instruccion o el audio se envian al proveedor elegido.',
            ),
            const SizedBox(height: 12),
            RemoteAiForm(library: library, disabled: disabled, run: run),
          ],
          if (!library.textRemote &&
              library.text?.runtime == ModelRuntime.litertlm)
            DropdownButtonFormField<String>(
              key: ValueKey('backend-${library.textId}'),
              initialValue: library.backend,
              isExpanded: true,
              itemHeight: null,
              decoration: const InputDecoration(labelText: 'Procesamiento'),
              items: const [
                DropdownMenuItem(value: 'cpu', child: Text('CPU')),
                DropdownMenuItem(value: 'gpu', child: Text('GPU')),
              ],
              onChanged: disabled
                  ? null
                  : (v) => run(() async {
                      if (v != null) library.backend = v;
                      await library.save();
                    }),
            ),
          if (!library.textRemote && library.text?.runtime == ModelRuntime.gguf)
            DropdownButtonFormField<String>(
              key: ValueKey('template-${library.textId}'),
              initialValue: library.template,
              isExpanded: true,
              itemHeight: null,
              decoration: const InputDecoration(labelText: 'Plantilla GGUF'),
              items: ModelLibrary.templates
                  .map(
                    (v) => DropdownMenuItem(
                      value: v,
                      child: Text(
                        v,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: disabled
                  ? null
                  : (v) => run(() async {
                      if (v != null) library.template = v;
                      await library.save();
                    }),
            ),
          if (!library.speechRemote && library.speech != null) ...[
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              key: ValueKey('language-${library.speechId}'),
              initialValue: library.language,
              isExpanded: true,
              itemHeight: null,
              decoration: const InputDecoration(
                labelText: 'Idioma del dictado',
              ),
              items: const [
                DropdownMenuItem(value: 'es', child: Text('Español')),
                DropdownMenuItem(
                  value: 'auto',
                  child: Text(
                    'Automatico',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
              onChanged: disabled
                  ? null
                  : (v) => run(() async {
                      if (v != null) library.language = v;
                      await library.save();
                    }),
            ),
          ],
        ],
      ),
    ],
  );
}

/// Proveedor, modelo y clave de la IA en linea, con los mismos nombres que
/// `infra/.env`: lo que se pega aqui es lo mismo que se pegaria en `ai.env`.
class RemoteAiForm extends StatefulWidget {
  final ModelLibrary library;
  final bool disabled;
  final Future<void> Function(Future<void> Function()) run;
  const RemoteAiForm({
    super.key,
    required this.library,
    required this.disabled,
    required this.run,
  });
  @override
  State<RemoteAiForm> createState() => _RemoteAiFormState();
}

class _RemoteAiFormState extends State<RemoteAiForm> {
  late final TextEditingController textModel, speechModel, textKey, speechKey;
  late String textProvider, speechProvider;
  RemoteAiSettings get remote => widget.library.remote;

  @override
  void initState() {
    super.initState();
    textProvider = remote.textSpec?.id ?? AiProvider.forText.first.id;
    speechProvider = remote.speechSpec?.id ?? AiProvider.forSpeech.first.id;
    textModel = TextEditingController(text: remote.textModel);
    speechModel = TextEditingController(text: remote.speechModel);
    textKey = TextEditingController(
      text: remote.keyFor(AiProvider.byId(textProvider)!),
    );
    speechKey = TextEditingController(
      text: remote.keyFor(AiProvider.byId(speechProvider)!),
    );
  }

  @override
  void dispose() {
    for (final c in [textModel, speechModel, textKey, speechKey]) c.dispose();
    super.dispose();
  }

  Widget providerField({
    required bool speech,
    required String value,
    required List<AiProvider> providers,
    required void Function(String) onChanged,
  }) => DropdownButtonFormField<String>(
    key: ValueKey('provider-${speech ? 'speech' : 'text'}-$value'),
    initialValue: value,
    isExpanded: true,
    itemHeight: null,
    decoration: InputDecoration(
      labelText: speech ? 'Proveedor de voz' : 'Proveedor de texto',
    ),
    items: providers
        .map(
          (p) => DropdownMenuItem(
            value: p.id,
            child: Text(p.id, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
        )
        .toList(),
    onChanged: widget.disabled
        ? null
        : (v) {
            if (v != null) setState(() => onChanged(v));
          },
  );

  @override
  Widget build(BuildContext context) {
    final library = widget.library;
    final textSpec = AiProvider.byId(textProvider)!;
    final speechSpec = AiProvider.byId(speechProvider)!;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('IA en linea', style: Theme.of(context).textTheme.titleMedium),
            const Text('Claves guardadas de forma segura en este dispositivo.'),
            if (library.textRemote) ...[
              const SizedBox(height: 12),
              providerField(
                speech: false,
                value: textProvider,
                providers: AiProvider.forText,
                onChanged: (v) {
                  textProvider = v;
                  final spec = AiProvider.byId(v)!;
                  if (textModel.text.trim().isEmpty ||
                      AiProvider.all.any(
                        (p) => p.defaultModel == textModel.text.trim(),
                      ))
                    textModel.text = spec.defaultModel;
                  textKey.text = remote.keyFor(spec);
                },
              ),
              const SizedBox(height: 8),
              TextField(
                controller: textModel,
                enabled: !widget.disabled,
                decoration: const InputDecoration(labelText: 'Modelo de texto'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: textKey,
                enabled: !widget.disabled,
                obscureText: true,
                decoration: InputDecoration(labelText: 'Clave API'),
              ),
            ],
            if (library.speechRemote) ...[
              const SizedBox(height: 12),
              providerField(
                speech: true,
                value: speechProvider,
                providers: AiProvider.forSpeech,
                onChanged: (v) {
                  speechProvider = v;
                  final spec = AiProvider.byId(v)!;
                  if (speechModel.text.trim().isEmpty ||
                      AiProvider.speechModels.values.contains(
                        speechModel.text.trim(),
                      ))
                    speechModel.text = spec.defaultSpeechModel;
                  speechKey.text = remote.keyFor(spec);
                },
              ),
              const SizedBox(height: 8),
              TextField(
                controller: speechModel,
                enabled: !widget.disabled,
                decoration: const InputDecoration(labelText: 'Modelo de voz'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: speechKey,
                enabled: !widget.disabled,
                obscureText: true,
                decoration: InputDecoration(labelText: 'Clave API'),
              ),
            ],
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: widget.disabled
                  ? null
                  : () => widget.run(() async {
                      if (library.textRemote) {
                        remote
                          ..set('AI_LLM_PROVIDER', textProvider)
                          ..set('AI_LLM_MODEL', textModel.text)
                          ..set(textSpec.keyName, textKey.text);
                      }
                      if (library.speechRemote) {
                        remote
                          ..set('AI_SPEECH_PROVIDER', speechProvider)
                          ..set('AI_SPEECH_MODEL', speechModel.text)
                          ..set(speechSpec.keyName, speechKey.text);
                      }
                      await remote.save();
                      await library.save();
                    }),
              icon: const Icon(Icons.save_outlined),
              label: const Text('Guardar'),
            ),
          ],
        ),
      ),
    );
  }
}
