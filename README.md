# Plataforma colaborativa de diseño de bases de datos

Plataforma web colaborativa de modelado conceptual basada en un subconjunto de
diagramas de clases UML. Varios usuarios editan la misma pizarra a la vez, por
interfaz gráfica o por asistente de texto y voz, y desde una pizarra seleccionada
se genera un backend Spring Boot con PostgreSQL listo para compilar y ejecutar.

Documento maestro: [`docs/referencia/plan-integral-plataforma-uml.md`](docs/referencia/plan-integral-plataforma-uml.md).
Entrega: **23 de septiembre**. Alcance congelado.

Generador actualizado: [backend de gestión, DTO para Flutter, Postman y despliegue](docs/generacion-backend-gestion.md). `npm run demo:backend` prepara un ejemplo de ventas con ZIP y diagrama XMI.

Auditoría del 5 de septiembre: [estado, correcciones y faltantes](docs/auditoria-2026-09-05.md).
El antiguo objetivo Dart de capa de datos fue retirado. La ampliación del 6 de septiembre incorpora un nuevo [generador Flutter Android con backend protegido, SQLite y GGUF](docs/generacion-flutter-android.md), opcional desde el panel Generación.

Para preparar un ejemplo Android: `npm run demo:mobile`. En la carpeta generada, `.\apk.bat build` crea el APK en `mobile/dist/`; `.\apk.bat install` compila e instala por USB; `.\apk.bat deploy` levanta backend y PostgreSQL con Docker, conecta por USB e instala; `.\apk.bat run --usb` prueba con recarga en caliente y backend iniciado. Cada ZIP incluye `COMANDOS.md` con estas órdenes y sus opciones. El panel Generación también las muestra. En Linux/macOS usar `sh apk.sh`.

---

## Arranque rápido

Para Google Cloud Compute Engine, seguir la [guía de Google Cloud](infra/GOOGLE-CLOUD.md). Para otros proveedores con una VM y dominio HTTPS, seguir la [guía de producción](infra/DEPLOYMENT.md).

Despliegue preparado para **uml.asiscarretera.online** en **35.255.28.222**: [configuración y pasos de instalación](infra/DEPLOY-UML.md).
Incluye Compose separado, certificados, cuotas, copias S3, restauración aislada,
monitorización y actualización por versión. `npm run test:production` verifica el
entorno HTTPS en contenedores temporales.

### Aprender a usar el software

El editor permite abrir y recargar pizarras visitadas sin conexión. Abre la versión compilada con conexión y espera **Disponible sin conexión** en cada pizarra; después podrás editar y sincronizar al reconectar. Consulta [uso, requisitos y límites del editor offline](frontend/OFFLINE.md).

Para descargar el diagrama como imagen, abre **Importar → Exportar imagen PNG**, elige el nombre y pulsa **Guardar PNG**. Incluye clases y relaciones fuera de la vista, conserva el tema actual y permite exportar también con permiso de lectura. Se genera en el navegador; no necesita servicios adicionales en Google Cloud.

Para practicar directamente en la interfaz, abre **Ayuda → Guiarme en esta pantalla**. El recorrido resalta controles reales y muestra instrucciones junto a ellos; detecta escritura y clics, permite ir al control, volver, omitir o pausar con Escape. Continúa cuando navegas de proyectos a una pizarra. **Retomar recorrido interactivo** recupera el último paso guardado para esa pantalla. Puede abrir paneles o pestañas para mostrar controles, pero crear datos, importar y generar requieren acciones del usuario. Los pasos omitidos no certifican que se hayan realizado las operaciones.

El botón **Ayuda** de la barra superior está disponible en Mis proyectos, en cada proyecto, en Mi cuenta y en el editor. Abre una guía con nueve temas: proyectos y pizarras, clases y atributos, relaciones, colaboración, IA, importación/exportación, validación, generación y cuenta. Incluye búsqueda de dudas, instrucciones con los nombres de los controles reales, ejercicios sugeridos y progreso de lectura guardado en este navegador. En el editor abre el tema de edición, importación o generación según el panel activo. Consultar la ayuda no modifica el diagrama ni envía solicitudes a la IA.

### Aprender a usar la IA

En una pizarra, abre **Asistente → Aprender a usar la IA**. La guía interactiva explica Consultar e Instruir, cómo escribir o dictar una solicitud y cómo revisar una propuesta antes de aplicarla. Incluye ejemplos adaptados al diagrama que se cargan como borradores, una práctica sin cambios reales y ayuda para errores frecuentes. No envía solicitudes de IA durante la práctica; recuerda en este navegador cuando completas la guía y permite repasarla. Está disponible en la plataforma web.

```bash
# 1. Requisitos: Node 22.15, Docker con Compose v2+
node --version        # v22.15.0
docker compose version

# 2. Dependencias exactas del lockfile
npm ci

# 3. Configuración local (el .env real nunca se versiona)
cp infra/.env.example infra/.env
#    editar POSTGRES_PASSWORD y JWT_SECRET antes de seguir

# 4. Todo el entorno
npm run up
npm run ps

# 5. Verificar
curl http://localhost:3001/health     # proceso HTTP
curl http://localhost:3002/health     # proceso WebSocket
open http://localhost:8080            # interfaz
```

Desarrollo sin contenedores para las tres aplicaciones:

```bash
npm run dev:api      # http://localhost:3001
npm run dev:collab   # http://localhost:3002
npm run dev:web      # http://localhost:5173  (proxy a las dos anteriores)
```

## Cuenta de demostración

```bash
npm run up
npm run seed
```

Crea dos cuentas y un proyecto con dos pizarras, para probar la colaboración sin
registrarse a mano. Es idempotente.

| | |
|---|---|
| Propietaria | `ana@demo.local` · `demo-plataforma-uml` |
| Editor | `beto@demo.local` · `demo-plataforma-uml` |

Ábrelas en dos navegadores distintos —o uno normal y otro de incógnito— para ver
la sesión colaborativa en vivo. La sección 16.3 pide tener esto listo el día 22.

## Verificación

```bash
npm run check          # formato + lint + tipos + pruebas rápidas
npm test               # solo las rápidas: sin Docker, sin base de datos
npm run test:api       # integración de la API contra un PostgreSQL efímero
npm run test:generated # T01: genera, compila con Maven, arranca y ejerce el CRUD
npm run test:bank      # lo mismo sobre los ocho modelos generables del banco
npm run test:e2e       # dos navegadores contra el entorno levantado
npm run test:offline   # producción + pruebas offline con Hocuspocus, sin Docker
```

Las pruebas de dos navegadores esperan el adaptador `mock` en los tres puertos de
IA (`AI_LLM_PROVIDER`, `AI_VISION_PROVIDER` y `AI_SPEECH_PROVIDER`), como en CI.
Con un proveedor real gastan tokens y las pruebas del asistente fallan por
latencia: un proveedor tarda más que los quince segundos que espera la prueba.

También esperan `MAIL_PROVIDER=log`, como en CI: cada actor registra una cuenta
nueva y lee el enlace de activación del registro de la API. Con `brevo` el
correo se envía de verdad —y a direcciones `@example.com` el proveedor lo
rechaza—, así que la prueba nunca encuentra el enlace y **todas** las que
registran una cuenta fallan al primer paso. Si el `infra/.env` de la máquina
tiene proveedores reales, se recrea la API con los valores de prueba sin tocar
el archivo (las variables del intérprete ganan a las del `.env`):

```bash
AI_LLM_PROVIDER=mock AI_VISION_PROVIDER=mock AI_SPEECH_PROVIDER=mock \
MAIL_PROVIDER=log BREVO_API_KEY= \
docker compose -f infra/compose.yml --env-file infra/.env up -d --no-build --force-recreate api
```

Al terminar, el mismo comando sin variables delante restaura los proveedores
reales.

Las pruebas de dos navegadores incluyen el paso de la defensa que va del diagrama
al archivo: dibujar una clase, generar y **comprobar que el ZIP descargado
contiene esa clase**. No basta con que baje un archivo — uno vacío también
bajaría.

Diagnóstico del banco:

```bash
npm run bank:report    # qué encuentra el validador en cada modelo
npm run fixtures:emit  # regenerar fixtures/uml/*.json desde las definiciones
```

`npm run check` es el bucle rápido y corre en segundos porque nada de lo que
cubre necesita Docker (RNF-15). Las demás levantan contenedores o compilan
proyectos Java, y por eso van aparte.

| Suite | Necesita | Cuándo la ejecuta CI |
|---|---|---|
| `check` | nada | cada cambio |
| `test:api` | Docker | cada cambio |
| `test:generated` | Docker, Java 21, Maven | cada cambio |
| `test:e2e` | Docker + `npm run up` + `npm run e2e:install` | cada cambio |
| `test:bank` | Docker, Java 21, Maven | **solo la rama principal** |

El banco completo compila y arranca ocho backends: son minutos que no tiene
sentido pagar en cada propuesta de cambio. RNF-13 lo dice así — cada cambio
ejecuta al menos T01, la rama principal ejecuta el banco completo.

## Control individual de servicios

```bash
docker compose -f infra/compose.yml --env-file infra/.env <comando>
```

| Objetivo | Comando |
|---|---|
| Todo el entorno de desarrollo | `up -d` |
| Añadir el origen único de demostración | `--profile demo up -d` |
| Añadir la inspección de la base | `--profile tools up -d` |
| Apagar un solo servicio | `stop collab` |
| Reiniciar uno solo | `restart api` |
| Reconstruir uno solo | `up -d --build api` |
| Ver estado y salud | `ps` |
| Seguir los registros de uno | `logs -f collab` |
| Apagar conservando los datos | `down` |
| Apagar y **borrar** los datos | `down -v` |

---

## Estructura

```
frontend/           Aplicación web React
backend/api/        Proceso HTTP: sesión, proyectos, pizarras, IA, imagen, XMI, generación
backend/collab/     Proceso WebSocket: salas, presencia, persistencia, autorización
backend/prisma/     Esquema de la base de datos de la plataforma
shared/             Código compartido navegador ↔ servidor
templates/          Plantillas de emisión del backend Spring Boot
fixtures/           Banco de modelos T01–T08 y XMI real
infra/              Composición de contenedores, Dockerfiles, proxy
docs/               Requisitos, arquitectura y ADR
```

`shared/` no es opcional: es la consecuencia directa de RA-05. El aplicador de
comandos y el validador tienen que ejecutarse en el navegador (para que la
edición sea instantánea) y en el servidor (para que el asistente, la importación
por imagen y XMI apliquen los mismos comandos con las mismas reglas). **Una sola
implementación, dos lugares de ejecución.**

| Paquete compartido | Responsabilidad | Fase |
|---|---|---|
| `@uml/contracts` | Esquemas: modelo canónico, comandos, lotes, API | ✅ 1 |
| `@uml/domain-core` | Normalización, aplicador de comandos, validador | ✅ 1 |
| `@uml/fixtures` | Banco de regresión T01–T08 | ✅ 1 |
| `@uml/generation-ir` | Representación intermedia (RA-13) | ✅ 2 |
| `@uml/generator-backend` | Emisión del proyecto Spring Boot | ✅ 2 |
| `@uml/yjs-adapter` | Puerto del documento colaborativo | ✅ 4 |
| `@uml/ai` | Puertos de IA y adaptadores intercambiables | ✅ 7 |
| `@uml/xmi` | Parser y serializador XMI | ✅ 8 |

---

## Plan por fases

Cada fase es un incremento **ejecutable y verificable**, no un entregable de
documentación. El orden respeta la sección 16.1 del plan maestro: los riesgos que
no dependen del esfuerzo del equipo se atacan primero, por eso los dos spikes que
validan la arquitectura son las fases 2 y 4.

| Fase | Contenido | Cómo se prueba | Estado |
|---|---|---|---|
| **0** | Cimientos: monorepo, TS estricto, lint, pruebas, Compose con perfiles, CI, ADR-016 | `npm run check` verde · `docker compose up -d` deja los cuatro servicios sanos | ✅ **Completa** |
| **1** | `contracts` + `domain-core`: normalización RTM-02/03, aplicador, validador, banco T01–T08 | Vitest sin navegador, sin BD, sin red (RNF-15). Lote inválido → no aplica nada (RA-03) | ✅ **Completa** |
| **2** | **Spike de generación**: IR → plantillas Spring → ZIP de T01 | DoD 15.1 sobre T01: compila, arranca, CRUD, `409` al borrar padre con hijos | ✅ **Completa** |
| **3** | Migraciones, auth, proyectos, membresías, invitaciones, pizarras | RF-A01–A07 y RF-001–005 por HTTP | ✅ **Completa** |
| **4** | **Spike de colaboración**: Yjs + Hocuspocus, autorización en la conexión, persistencia binaria | CA-A08.1, CA-A08.2, CA-004.1, convergencia | ✅ **Completa** |
| **5** | Editor React Flow sobre el documento, validación en pantalla, presencia | Las cinco pruebas de la sección 15.4 con dos navegadores | ✅ **Completa** |
| **6** | Banco T01–T08 + OpenAPI, Postman y Compose en el ZIP | Ocho modelos generables compilados y ejecutados, con T07R y T08 | ✅ **Verificada el 05/09/2026** |
| **7** | Capa de IA: puertos, adaptador simulado, asistente por texto y voz | CA-032.1 y CA-032.2 con el adaptador `mock` en CI | ✅ **Completa** |
| **8** | Importación por imagen con vista previa + XMI 2.5.1 y perfil EA 2.1 en ambos sentidos | CA-042.1 · Importación real de nueve modelos en EA | ✅ **Implementada; reexportación externa pendiente de aceptación** |
| **10** | Integración: generar y descargar desde el editor, auditoría persistida | Guion 16.2 de punta a punta · el ZIP descargado contiene lo dibujado | ⚠️ **Integrada; falta el ensayo cronometrado** |

La fase 10 cerró las dos brechas P0 que arrastraba la fase 6: generar desde la
pizarra congelando el snapshot (RA-08) y descargar el ZIP, y persistir los lotes
en `audit_operations` (RF-A09/CA-023.1). Lo que queda abierto está en
[`docs/pendientes.md`](docs/pendientes.md), con qué falta, por qué importa y cómo
se comprueba que ya está.

### Pendientes

Todo lo que queda —incluidos los dos riesgos externos de abajo— vive en
[`docs/pendientes.md`](docs/pendientes.md). Cómo ponerla en marcha en local, en
la red del aula o en internet, y dónde van las claves de las IA:
[`docs/despliegue.md`](docs/despliegue.md). El contraste función por función
contra el manual de otro proyecto de la materia:
[`docs/comparacion-manual.md`](docs/comparacion-manual.md), y lo que de ahí sale
y merece construirse, con coste y forma de comprobarlo:
[`docs/actualizacion.md`](docs/actualizacion.md).

### Frentes que no esperan a su fase

Dos cosas de la sección 16 no son código y hay que empezarlas ya, porque el
riesgo es externo y no depende del esfuerzo del equipo:

- **Enterprise Architect 15**: nueve modelos aprobaron la importación real con
  tipos, identidad, geometría, cardinalidades y marcas. Falta la reexportación
  externa completa: el exportador automatizado de EA quedó sin responder.
  Evidencia en la [revisión de colaboración y XMI](docs/colaboracion-xmi-2026-09-10.md).
- **Voz y cámara en el navegador real**: comprobar permisos, captura y dictado
  con los dispositivos de la demostración. Las pruebas automáticas no acreditan
  la calidad del micrófono ni del reconocimiento de una fotografía real. El
  módulo móvil retirado ya no forma parte de esta validación.

---

## Decisiones registradas

Ver [`docs/adr/`](docs/adr/README.md). Las decisiones aceptadas hasta hoy:

- [ADR-001](docs/adr/ADR-001-monolito-modular-dos-procesos.md) — Monolito modular con dos procesos
- [ADR-002](docs/adr/ADR-002-crdt-para-colaboracion.md) — CRDT para la colaboración en tiempo real
- [ADR-003](docs/adr/ADR-003-modelo-canonico-comandos-lotes.md) — Modelo canónico único con comandos y lotes atómicos
- [ADR-004](docs/adr/ADR-004-varias-pizarras-generacion-seleccionada.md) — Varias pizarras y generación sobre una seleccionada
- [ADR-005](docs/adr/ADR-005-entidad-intermedia-muchos-a-muchos.md) — Entidad intermedia explícita para muchos a muchos
- [ADR-006](docs/adr/ADR-006-sin-event-sourcing-ni-cqrs.md) — Sin event sourcing ni CQRS completo
- [ADR-007](docs/adr/ADR-007-generacion-por-ir-y-plantillas.md) — Generación por representación intermedia y plantillas
- [ADR-008](docs/adr/ADR-008-dto-planos-relaciones-unidireccionales.md) — DTO planos y relaciones unidireccionales
- [ADR-009](docs/adr/ADR-009-runtime-compartido.md) — Runtime compartido entre navegador y servidor
- [ADR-010](docs/adr/ADR-010-docker-compose-iac-diferida.md) — Docker Compose, IaC diferida
- [ADR-011](docs/adr/ADR-011-generacion-limitada-capa-datos.md) — Generación móvil limitada a la capa de datos
- [ADR-014](docs/adr/ADR-014-autenticacion-propia-minima.md) — Autenticación propia mínima con roles por proyecto
- [ADR-015](docs/adr/ADR-015-proveedores-ia-tras-puertos.md) — Proveedores de IA detrás de puertos
- [ADR-016](docs/adr/ADR-016-matriz-de-versiones.md) — Matriz de versiones congelada, verificada el 29/08/2026

## Criterio de congelamiento

No se agregan requisitos P0 ni P1 salvo que una prueba, un spike o una
aclaración explícita del docente demuestre que falta algo necesario. Toda idea
nueva se registra en P2.
