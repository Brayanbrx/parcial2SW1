import 'dart:async';
import 'package:flutter/material.dart';
import '../data/local_speech.dart';
import '../data/model_library.dart';
import 'app_model.dart';
import 'assistant_view_model.dart';
import 'local_model_settings.dart';

class AssistantScreen extends StatefulWidget {
  final AppModel model;
  final Widget Function() simpleBuilder;
  final Future<ModelLibrary> Function() openLibrary;
  final LocalSpeech Function(ModelLibrary) createSpeech;
  const AssistantScreen(
    this.model, {
    required this.simpleBuilder,
    this.openLibrary = ModelLibrary.open,
    this.createSpeech = LocalSpeech.new,
    super.key,
  });
  @override
  State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends State<AssistantScreen>
    with WidgetsBindingObserver {
  final input = TextEditingController();
  AssistantViewModel? vm;
  LocalSpeech? speech;
  Timer? poll;
  bool working = false, simple = false;
  bool wasProcessing = false;
  String error = '';
  bool get locked =>
      working ||
      (vm?.busy ?? true) ||
      (vm?.processing ?? false) ||
      (speech?.transcribing ?? false);
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(initialize());
    poll = Timer.periodic(const Duration(seconds: 1), (_) {
      final processing =
          (vm?.processing ?? false) || (speech?.transcribing ?? false);
      if (mounted && (processing || wasProcessing != processing))
        setState(() => wasProcessing = processing);
    });
  }

  Future<void> initialize() async {
    try {
      await widget.model.assistantCleanup;
      final library = await widget.openLibrary();
      if (!mounted || widget.model.repository == null) return;
      vm = AssistantViewModel(widget.model, library)..addListener(changed);
      speech = widget.createSpeech(library);
    } catch (e) {
      error = 'No se pudo abrir el asistente: $e';
    }
    if (mounted) setState(() {});
  }

  void changed() {
    if (mounted) setState(() {});
  }

  Future<void> perform(Future<void> Function() action) async {
    if (locked) return;
    setState(() {
      working = true;
      error = '';
    });
    try {
      await action();
    } catch (e) {
      error = e.toString();
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> settings(Future<void> Function() action) => perform(() async {
    await vm!.runtime.release();
    await action();
  });
  Future<void> finishSpeech() async {
    if (working || (speech?.transcribing ?? false)) return;
    setState(() => working = true);
    try {
      final text = await speech!.finish(widget.model.selected);
      if (mounted) input.text = text;
    } catch (e) {
      error = e.toString();
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached)
      unawaited(releaseResources());
  }

  @override
  void didHaveMemoryPressure() {
    unawaited(releaseResources());
  }

  Future<void> releaseResources() async {
    try {
      if (vm?.processing ?? false) {
        await vm?.cancel();
      } else {
        await vm?.runtime.release();
      }
      await speech?.cancel();
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    poll?.cancel();
    input.dispose();
    vm?.removeListener(changed);
    final oldVm = vm;
    final oldSpeech = speech;
    widget.model.assistantCleanup = () async {
      try {
        await oldVm?.close();
      } finally {
        await oldSpeech?.close();
        oldVm?.dispose();
      }
    }();
    super.dispose();
  }

  String display(dynamic value) => value == null ? 'Vacio' : value.toString();
  Widget evidence(Map<String, dynamic> result) {
    final data = result['data'];
    if (data is! Map ||
        result['name'] == 'prepare_change' ||
        result['name'] == 'describe_resource')
      return const SizedBox.shrink();
    final rows = data['records'] is List
        ? data['records'] as List
        : data['record'] is Map
        ? [data['record']]
        : null;
    return Card.outlined(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Datos locales · ${result['arguments']?['resource'] ?? ''}',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            if (result['coverage']?['complete'] == false)
              const Text('Resultado parcial: no representa el total.'),
            if (rows != null && rows.isEmpty) const Text('Sin coincidencias.'),
            if (rows != null)
              for (final row in rows)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: SelectableText(
                    (row as Map).entries
                        .map((e) => '${e.key}: ${display(e.value)}')
                        .join(' · '),
                  ),
                ),
            if (result['nextCursor'] != null)
              const Text(
                'Hay mas resultados. Puedes pedir la siguiente pagina.',
              ),
            if (data.containsKey('operation'))
              SelectableText(
                '${data['operation']} ${data['field'] ?? ''}: ${display(data['value'])}',
              ),
            if (data['message'] != null) Text(data['message'].toString()),
          ],
        ),
      ),
    );
  }

  Widget draftCard(AssistantViewModel model) {
    final draft = model.draft!;
    final proposal = draft['proposal'] as Map;
    final before = (draft['expected'] as Map?) ?? {};
    final after = (proposal['data'] as Map?) ?? {};
    final resource = widget.model.schema.resource(proposal['resource']);
    final action = proposal['action'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${action == 'CREATE'
                  ? 'Crear'
                  : action == 'DELETE'
                  ? 'Eliminar'
                  : 'Actualizar'} ${resource.className}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (action == 'DELETE')
              for (final entry in before.entries)
                Text('${entry.key}: ${display(entry.value)}'),
            if (action != 'DELETE')
              for (final entry in after.entries)
                if (action == 'CREATE' || entry.value != before[entry.key])
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Text(
                      action == 'CREATE'
                          ? '${entry.key}: ${display(entry.value)}'
                          : '${entry.key}: ${display(before[entry.key])} → ${display(entry.value)}',
                    ),
                  ),
            const SizedBox(height: 12),
            const Text('Se guardara en este dispositivo al confirmar.'),
            Wrap(
              spacing: 8,
              children: [
                FilledButton(
                  onPressed: locked || widget.model.busy ? null : model.confirm,
                  child: const Text('Confirmar cambio'),
                ),
                TextButton(
                  onPressed: locked ? null : model.discard,
                  child: const Text('Descartar y corregir'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final model = vm;
    if (model == null)
      return Center(
        child: Text(error.isEmpty ? 'Preparando asistente…' : error),
      );
    if (simple)
      return Column(
        children: [
          TextButton(
            onPressed: () async {
              setState(() {
                simple = false;
                working = true;
              });
              await WidgetsBinding.instance.endOfFrame;
              try {
                await widget.model.assistantCleanup;
                await model.close();
                model.removeListener(changed);
                model.dispose();
                final library = await widget.openLibrary();
                if (mounted) {
                  vm = AssistantViewModel(widget.model, library)
                    ..addListener(changed);
                  speech = widget.createSpeech(library);
                }
              } catch (e) {
                error = e.toString();
              } finally {
                if (mounted) setState(() => working = false);
              }
            },
            child: const Text('Volver al asistente con herramientas'),
          ),
          Expanded(child: widget.simpleBuilder()),
        ],
      );
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 720),
        child: ListView(
          padding: const EdgeInsets.all(16),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          children: [
            Text('Asistente', style: Theme.of(context).textTheme.headlineSmall),
            const Text(
              'Consulta tus datos y prepara cambios, incluso sin internet.',
            ),
            const SizedBox(height: 8),
            ExpansionTile(
              title: const Text('Modelos y opciones'),
              initiallyExpanded: !model.library.textReady,
              children: [
                LocalModelSettings(
                  library: model.library,
                  disabled: locked || (speech?.recording ?? false),
                  run: settings,
                ),
                if (!model.library.textRemote &&
                    model.library.text?.runtime == ModelRuntime.litertlm) ...[
                  Text(
                    model.library.nativeTools
                        ? 'Herramientas nativas verificadas en este modelo.'
                        : 'Herramientas mediante JSON. Puedes comprobar el soporte nativo.',
                  ),
                  TextButton(
                    onPressed: locked || (speech?.recording ?? false)
                        ? null
                        : model.verifyNativeTools,
                    child: const Text('Probar herramientas nativas'),
                  ),
                  if (model.library.nativeTools)
                    TextButton(
                      onPressed: locked
                          ? null
                          : () => settings(() async {
                              model.library.nativeTools = false;
                              await model.library.save();
                            }),
                      child: const Text('Usar protocolo JSON'),
                    ),
                ],
                TextButton(
                  onPressed:
                      locked ||
                          (speech?.recording ?? false) ||
                          model.draft != null
                      ? null
                      : () => perform(() async {
                          await model.runtime.release();
                          await speech?.close();
                          if (mounted) setState(() => simple = true);
                        }),
                  child: const Text('Modo sencillo de compatibilidad'),
                ),
              ],
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: locked || (speech?.recording ?? false)
                    ? null
                    : model.reset,
                icon: const Icon(Icons.add_comment_outlined),
                label: const Text('Nueva conversacion'),
              ),
            ),
            for (final message in model.session.messages.where(
              (m) => m['role'] != 'system',
            ))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Align(
                  alignment: message['role'] == 'user'
                      ? Alignment.centerRight
                      : Alignment.centerLeft,
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: message['role'] == 'user'
                          ? Theme.of(context).colorScheme.primaryContainer
                          : Theme.of(
                              context,
                            ).colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: SelectableText(
                      '${message['role'] == 'user' ? 'Tu' : 'Asistente'}: ${message['text']}',
                    ),
                  ),
                ),
              ),
            if (model.session.evidence.isNotEmpty)
              ExpansionTile(
                title: const Text('Resultados consultados'),
                children: model.session.evidence.map(evidence).toList(),
              ),
            if (model.draft != null) draftCard(model),
            if (model.status.isNotEmpty)
              Semantics(
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(model.status),
                ),
              ),
            if (error.isNotEmpty) Text(error),
            if (locked) const LinearProgressIndicator(),
            if (model.processing && !model.busy)
              const Text(
                'Liberando el modelo; espera antes de iniciar otra solicitud.',
              ),
            if (model.processing)
              TextButton(
                onPressed: model.cancel,
                child: const Text('Cancelar solicitud'),
              ),
            const SizedBox(height: 12),
            TextField(
              controller: input,
              minLines: 2,
              maxLines: 6,
              enabled: !locked,
              decoration: const InputDecoration(
                labelText: 'Mensaje',
                hintText: 'Busca a Ana o continua la conversacion',
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  onPressed:
                      locked ||
                          (speech?.recording ?? false) ||
                          model.draft != null ||
                          !model.library.textReady
                      ? null
                      : () {
                          final text = input.text;
                          if (text.trim().isEmpty) return;
                          input.clear();
                          unawaited(model.send(text));
                        },
                  icon: const Icon(Icons.send),
                  label: const Text('Enviar'),
                ),
                OutlinedButton.icon(
                  onPressed: locked || !model.library.speechReady
                      ? null
                      : () async {
                          if (speech!.recording) {
                            await finishSpeech();
                          } else {
                            await perform(() async {
                              await model.runtime.release();
                              await speech!.start(() {
                                if (mounted) unawaited(finishSpeech());
                              });
                            });
                          }
                        },
                  icon: const Icon(Icons.mic_none),
                  label: Text(
                    speech?.recording == true ? 'Terminar dictado' : 'Dictar',
                  ),
                ),
                if (speech?.capturing == true || speech?.transcribing == true)
                  TextButton(
                    onPressed: () async {
                      await speech?.cancel();
                      if (mounted) setState(() {});
                    },
                    child: const Text('Cancelar dictado'),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            const Text(
              'El asistente puede consultar varias veces. Cada cambio requiere tu confirmacion.',
            ),
          ],
        ),
      ),
    );
  }
}
