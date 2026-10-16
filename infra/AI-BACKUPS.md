# Respaldos IA para la demostración académica

Revisión del 18 de septiembre de 2026. Configuración aplicada en `infra/.env` y en el archivo privado `output/google-cloud/production.env`. Las claves actualizadas de NVIDIA y Cohere están sincronizadas; el dominio, las contraseñas de la VM y Brevo se conservan. Ninguno de estos archivos privados se sube a Git.

## Orden configurado

| Capacidad | Principal | Respaldos, en orden |
| --- | --- | --- |
| Texto y consultas | Groq `openai/gpt-oss-120b` | Cloudflare `@cf/openai/gpt-oss-120b` → NVIDIA `google/gemma-4-31b-it` → Mistral `mistral-small-latest` → Gemini `gemini-3.5-flash-lite` → OpenRouter `openrouter/free` → Z.ai `glm-4.7-flash` |
| Lectura de diagramas | Mistral `ministral-14b-latest` | Cloudflare `@cf/meta/llama-4-scout-17b-16e-instruct` → Cohere `command-a-plus-05-2026` → Groq `qwen/qwen3.8-27b` → Gemini `gemini-3.5-flash` → OpenRouter `google/gemma-4-31b-it:free` → Z.ai `glm-4.6v-flash` |
| Transcripción | Groq `whisper-large-v3-turbo` | Cloudflare `@cf/openai/whisper-large-v3-turbo` → Mistral `voxtral-mini-latest` |

Se quitaron los modelos NVIDIA antiguos que devolvían 404/410 y la segunda variante Gemini, para evitar repetir un proveedor con disponibilidad limitada antes de llegar a otro servicio. Las plantillas públicas permanecen desactivadas hasta disponer de credenciales; el archivo privado preparado ya tiene las cadenas activas de esta tabla.

## Resultado de las llamadas reales

Solo se enviaron ejemplos sintéticos: clases Cliente/Pedido, un PNG de Persona con correo y autoasociación, y una frase generada con síntesis de voz. No se usaron proyectos ni grabaciones personales.

- **Texto:** Groq y Cloudflare generaron correctamente clases, atributo obligatorio y multiplicidades. NVIDIA Gemma superó pruebas de clase/atributo y relación; también tuvo tiempos de espera agotados en otras llamadas. Se limita a 4.096 tokens de salida y se desactiva `enable_thinking` para reducir la latencia. La validación rechaza respuestas truncadas; no aplica lotes parciales.
- **Imagen:** Mistral, Cloudflare y Cohere Command A+ transcribieron la clase, atributo y autoasociación del PNG. Se adelantaron a los servicios que no respondieron o agotaron cuota durante la revisión.
- **Voz:** Groq, Cloudflare y Mistral transcribieron correctamente el audio sintético en llamadas reales.
- **Disponibilidad pendiente:** Mistral texto, Z.ai, Groq imagen y OpenRouter imagen devolvieron 429. Gemini y OpenRouter texto agotaron tiempos de espera; una variante Gemini tampoco estuvo disponible. Conservan posiciones posteriores como alternativas cuando recuperen cuota/disponibilidad; no se consideran respaldos garantizados hoy.
- **Cohere texto no está activo:** Command A, A+, A Reasoning y Command R/R+ respondieron, pero invirtieron las multiplicidades en un ejemplo sencillo. Command A Vision tampoco pasó la transcripción inicial. No confundir acceso a la API con calidad semántica. El modelo elegido de Cohere es **Command A+ para imágenes**.
- **NVIDIA imagen no está activo:** los modelos probados no completaron la lectura dentro del plazo de evaluación.

Estas son pruebas funcionales pequeñas, no una garantía para diagramas arbitrarios. Las propuestas siguen requiriendo revisión humana antes de aplicarse.

## Límites y errores

La configuración conserva 15 segundos por intento de texto, sin reintentos adicionales, y un límite total de 120 segundos. Imagen mantiene su plazo por intento de 120 segundos y total de 300 segundos; voz tiene un total de 120 segundos. Las cuotas 402/429 activan el respaldo y un enfriamiento de al menos 60 segundos, respetando Retry-After. Los errores de red y 5xx también activan el siguiente proveedor. Una credencial inválida, modelo inexistente o respuesta que incumple el contrato se informa: no se oculta como un fallo transitorio.

Se corrigió el presupuesto de Command A y Command A Vision antiguos a un máximo de 8.192 tokens; Command A+ conserva el presupuesto global. NVIDIA Gemma usa su límite específico de 4.096 y el resto mantiene su configuración anterior.

Las cuentas de evaluación están habilitadas para la demostración solicitada. Cohere aplica cuotas de prueba, incluida una cota mensual de 1.000 llamadas; NVIDIA API Catalog se ofrece para evaluación. Para un servicio comercial habrá que contratar la modalidad adecuada. Fuentes oficiales: [límites de Cohere](https://docs.cohere.com/docs/rate-limits), [Command A+](https://docs.cohere.com/docs/command-a-plus), [Gemma en NVIDIA](https://build.nvidia.com/google/gemma-4-31b-it), [condiciones de evaluación NVIDIA](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf).

## Aplicar en la VM

Sigue [DEPLOY-UML.md](DEPLOY-UML.md): confirma y sube los cambios del código, transfiere **la versión actualizada** del archivo privado a `/etc/uml/production.env` con permisos 600 y ejecuta `sudo bash scripts/production.sh deploy` desde `/opt/uml`. Este comando reconstruye las imágenes y recrea los servicios con las variables nuevas. Un simple `docker restart` no carga cambios del archivo de entorno.

Después ejecuta `sudo bash scripts/production.sh smoke` y prueba una instrucción, una imagen y un dictado desde el subdominio. La comprobación de salud verifica la aplicación; no acredita cuota disponible en todas las IA. Si falla una clave en la VM, consulta los registros de API sin publicar el archivo de entorno ni cabeceras de autorización.

El código incluye regresiones del límite de Cohere, los parámetros de NVIDIA y el salto entre proveedores de texto e imagen. No se ha accedido a la VM ni se han cambiado recursos de Google Cloud durante esta revisión.

Validación final: `npm run check` aprobado (583 pruebas), imagen Docker de API construida y perfil privado validado con Compose. En una prueba controlada se simularon respuestas 429 únicamente en los dos primeros proveedores: NVIDIA respondió realmente al texto y Cohere realmente al PNG usando la configuración del archivo de despliegue. Esto prueba el recorrido de la cadena sin consumir cuota de los proveedores simulados.
