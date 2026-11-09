# Modelos de voz y texto intercambiables

La biblioteca del Asistente permite importar varios archivos y elegir dos modelos
independientes. No descarga pesos automaticamente ni envia audio o instrucciones a
proveedores IA. Los archivos originales se conservan; la app guarda copias privadas.
Importar no acredita compatibilidad: el runtime valida el modelo al ejecutar.

| Funcion | Motor | Archivos |
| --- | --- | --- |
| Interpretar instrucciones y proponer CRUD | LiteRT-LM | `.litertlm` compatible con runtime 0.15.0 |
| Alternativa para interpretar instrucciones | llama.cpp mediante llama_flutter_android | `.gguf` de instrucciones |
| Transcribir voz en español | whisper.cpp mediante whisper_ggml | GGML `.bin` multilingue, tambien cuantizado |

## Seleccion y uso

1. Descarga los modelos que quieras probar y transfiere los archivos al telefono.
2. En Asistente, abre Modelos y pulsa Cargar modelo en Texto o Voz.
   Texto acepta `.litertlm` y `.gguf`; Voz acepta Whisper `.bin` multilingue.
3. Elige el archivo en el selector Android. Importar otro conserva los anteriores.
4. Selecciona Modelo de texto y Modelo de voz en sus listas. La eleccion persiste;
   cada archivo conserva sus preferencias de plantilla, CPU/GPU o idioma.
5. En Opciones puedes ajustar el procesamiento y el idioma.
   LiteRT-LM: prueba CPU y GPU segun soporte del equipo. GGUF: elige la plantilla
   de conversacion indicada por el distribuidor. LiteRT-LM usa la plantilla del modelo.
6. Whisper: Español (`es`) por defecto; tambien puedes elegir deteccion automatica.
7. Dicta hasta 45 segundos, pulsa Terminar, corrige el texto y pulsa
   Enviar. Tambien puedes escribir directamente sin modelo de voz.
8. Responde las aclaraciones y revisa las diferencias. Solo Confirmar cambio escribe en SQLite; la cola envia el
   cambio cuando el backend vuelve a estar accesible.

El icono de papelera quita la copia privada seleccionada tras confirmacion. No
borra el archivo original de Descargas. Los archivos pueden ocupar varios GB;
importar requiere espacio para una copia adicional. Los modelos del catalogo
permanecen al cambiar de cuenta; los datos del negocio mantienen su aislamiento.

## Punto de partida

Para texto, Gemma 4 E2B IT en `.litertlm` es un candidato si ya funciona en tu
telefono. No todos los paquetes con la misma extension son compatibles con cada
version del runtime o acelerador. La version actual usa litertlm 0.0.13, puente
Flutter de terceros sobre el runtime oficial LiteRT-LM 0.15.0. Mantiene GGUF como
alternativa; no convierte formatos ni cambia a otra IA silenciosamente.

Para español compara Whisper `base` multilingue con `small` multilingue, por
ejemplo cuantizaciones Q5_1 compatibles con whisper.cpp. `tiny` sirve para equipos
con menos recursos. Las variantes `.en` solo son para ingles. La cuantizacion
reduce almacenamiento/memoria y puede cambiar precision; medir en el telefono.
Whisper transcribe, no decide que registro borrar ni genera operaciones CRUD.

## Instrucciones internas y memoria

`lib/domain/assistant_protocol.dart` contiene el protocolo del asistente con
herramientas y `assistant_runner.dart` su ciclo de hasta 8 pasadas. Recibe catalogo,
historial acotado, preguntas pendientes, fecha del dispositivo y resultados de
consultas locales. Puede buscar, leer, calcular y preparar cambios. Las preguntas
conservan el contexto para continuar con respuestas cortas.

LiteRT mantiene `automaticToolCalling: false`: la app valida y ejecuta cada
herramienta. Probar herramientas nativas verifica una llamada y su respuesta con
datos de prueba antes de activar el protocolo para ese modelo y CPU/GPU. GGUF y
los modelos sin compatibilidad verificada usan solicitudes JSON con el mismo
orquestador. `assistant_prompt.dart` y `LocalAgent.propose` conservan el modo
sencillo de compatibilidad. Ver [evaluacion y limites](assistant-evaluation.md).

La validacion Dart rechaza herramientas y campos desconocidos, tipos incorrectos,
recursos fuera del contrato y claves de edicion/borrado que no se consultaron.
El prompt no sustituye esa validacion. Las propuestas siguen requiriendo revision
humana y el backend vuelve a validar durante sincronizacion.

Whisper recibe `language=es`, `isTranslate=false`, `noContext=true` y un vocabulario
acotado de la coleccion, no un system prompt de chat. El audio temporal se elimina
al terminar/cancelar. Su texto nunca ejecuta acciones automaticamente; ruido o
silencio pueden producir transcripciones equivocadas que hay que corregir.

Los motores de voz y texto se usan secuencialmente. El LLM se conserva entre
pasadas y mensajes hasta 60 segundos inactivo; se libera antes de Whisper y al
cambiar modelo o cerrar la sesion. Whisper no queda residente. El tiempo mostrado
incluye carga si fue necesaria y consultas; no es un benchmark puro de inferencia.
La memoria de conversacion permanece durante la sesion de la app y se borra al
cambiar cuenta/servidor/contrato o pulsar Nueva conversacion. No se guarda en disco.

## IA en linea con los proveedores de infra/.env

En Modelos > Opciones, los selectores Origen de texto y Origen de voz cambian entre el modelo
importado y la IA en linea. Los nombres de variable son los de `infra/.env`
del generador (`AI_LLM_PROVIDER`, `AI_LLM_MODEL`, `AI_SPEECH_PROVIDER`,
`AI_SPEECH_MODEL`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`...),
asi que la configuracion se copia y pega. Se puede incrustar al compilar
(`mobile/ai.env`, ver README) o escribir en la app, donde queda en el
almacenamiento seguro del telefono.

El motor en linea recibe exactamente el mismo system prompt y contexto que los
motores locales, pide salida JSON al proveedor y su respuesta pasa por la misma
validacion Dart. La voz en linea envia el audio WAV al endpoint de transcripcion
del proveedor con el idioma elegido y, en Groq, el vocabulario de la coleccion.
Lo que viaja: la instruccion, los campos y los registros filtrados de la
coleccion seleccionada, o el audio del dictado. No viaja la contraseña ni el
resto de la base local.

## Comparacion reproducible sin modificar datos

Usa los mismos registros locales e instrucciones con cada modelo:

- Crear un registro con todos sus campos obligatorios.
- Pedir una alta incompleta: debe solicitar datos, no inventarlos.
- Corregir una orden: «No borres a Ana; cambia su nombre a Ana Maria».
- Pedir editar un nombre repetido: debe preguntar cual.
- Dictar nombres, fechas, decimales y negaciones con ruido y en silencio.
- Intentar usar una clave inexistente o agregar un campo desconocido.

Anota modelo, CPU/GPU, tiempo, texto reconocido y validez de la propuesta. Cancela
la confirmacion para comparar sin escribir. Luego valida en una base de prueba:
modo avion, cambio confirmado, cierre/reapertura, reconexion y ausencia de duplicados.
Las pruebas automaticas usan motores simulados; no acreditan calidad de GGUF,
LiteRT-LM ni Whisper reales. El login local admin / admin funciona sin internet desde la primera instalación. Solo el login en modo servidor requiere acceso al backend.

La espera para comprobar si el backend es accesible no bloquea las escrituras
locales del agente ni los formularios. Una vez iniciado el envio de la cola se
mantiene el bloqueo temporal existente para proteger operaciones cuya confirmacion
puede perderse. Los conflictos requieren resolucion y los cambios incompatibles
del contrato impiden el envio, conservando los datos locales.

La preparacion Android fija NDK 29.0.13113456 y aplica
`tool/local_models.gradle` para compatibilizar el compileSdk de whisper_ggml con
su dependencia de audio. Si integras estos archivos en un proyecto Android ya
existente, el bootstrap lo conserva: configura ese NDK en `android/app/build.gradle.kts`
y agrega `apply(from = "../tool/local_models.gradle")` al principio de
`android/build.gradle.kts`. Los proyectos nuevos lo reciben automaticamente.

## Limites que siguen abiertos

La IA en linea llama al proveedor directamente desde el telefono con tu clave; no
pasa por el backend Spring ni por la API del generador. Flutter sigue usando
`/mobile-contract`; no interpreta directamente un OpenAPI arbitrario. La cola
sincroniza con la app abierta/al reabrir; no existe servicio Android permanente.

Fuentes de compatibilidad consultadas:

- [LiteRT-LM oficial](https://github.com/google-ai-edge/LiteRT-LM)
- [Paquete Flutter litertlm](https://pub.dev/packages/litertlm)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- [Whisper GGML para Flutter](https://pub.dev/packages/whisper_ggml)
