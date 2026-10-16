import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { GenerationIr } from '@uml/generation-ir';
import { dtoContract } from './client-artifacts.js';
import { defaultTemplatesRoot, sha256 } from './fingerprint.js';
import { generateSpringProjectFiles } from './project-generator.js';
import type { GeneratedFile, GeneratedSpringProject } from './types.js';
import { createProjectZip } from './zip.js';

async function templates(
  directory: string,
  replacements: Record<string, string>,
): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  async function visit(folder: string, prefix: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await visit(resolve(folder, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.tpl')) continue;
      let content = (await readFile(resolve(folder, entry.name), 'utf8')).replaceAll('\r\n', '\n');
      for (const [key, value] of Object.entries(replacements))
        content = content.replaceAll(key, value);
      files.push({ path: prefix + entry.name.slice(0, -4), content });
    }
  }
  await visit(directory, '');
  return files;
}
export async function generateMobileProject(ir: GenerationIr): Promise<GeneratedSpringProject> {
  if (ir.entities.length === 0) throw new Error('El proyecto movil necesita al menos una clase.');
  if (
    ir.entities.some(
      (e) =>
        ['_uml_sync_receipts', '_uml_mobile_sessions'].includes(e.tableName) ||
        e.attributes.some(
          (a) => a.fieldName === 'umlSyncVersion' || a.columnName === '_uml_sync_version',
        ),
    )
  )
    throw new Error('El modelo utiliza nombres reservados para sincronizacion movil.');
  const java = `${ir.project.packageName}`;
  const handlers = ir.entities
    .map((e, index) => {
      const pk = e.primaryKey.javaType === 'UUID' ? 'java.util.UUID' : e.primaryKey.javaType;
      const key =
        pk === 'String'
          ? 'node.asText()'
          : pk === 'java.util.UUID'
            ? 'java.util.UUID.fromString(node.asText())'
            : `${pk}.valueOf(node.asText())`;
      return `Map.entry("${e.resourcePath}", new Handler(${java}.model.${e.className}.class, ${java}.dto.${e.dtoName}.class, node -> ${key}, id -> service${index}.findById((${pk}) id), dto -> service${index}.create((${java}.dto.${e.dtoName}) dto), (id,dto) -> service${index}.update((${pk}) id, (${java}.dto.${e.dtoName}) dto), id -> service${index}.delete((${pk}) id), "${e.primaryKey.fieldName}"))`;
    })
    .join(',\n');
  const extra = await templates(resolve(defaultTemplatesRoot(), 'mobile-backend'), {
    __PACKAGE__: java,
    __DEPENDENCIES__: ir.entities
      .map((e, index) => `, ${java}.service.${e.serviceName} service${index}`)
      .join(''),
    __HANDLERS__: handlers,
  });
  const backend = [
    ...(await generateSpringProjectFiles(ir, { mobileRuntime: true })),
    { path: 'src/main/resources/mobile-contract.json', content: dtoContract(ir) },
    {
      path: 'railway.json',
      content: JSON.stringify(
        {
          $schema: 'https://railway.com/railway.schema.json',
          build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
          deploy: {
            healthcheckPath: '/actuator/health',
            healthcheckTimeout: 180,
            restartPolicyType: 'ON_FAILURE',
            restartPolicyMaxRetries: 5,
          },
        },
        null,
        2,
      ),
    },
    ...extra.map((f) => ({
      ...f,
      path: `src/main/java/${ir.project.packagePath}/mobilesupport/${f.path}`,
    })),
  ];
  const collection = JSON.parse(
    backend.find((f) => f.path === 'postman/collection.json')!.content,
  ) as { auth?: unknown; item: unknown[] };
  collection.auth = {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
  };
  collection.item.unshift({
    name: 'Iniciar sesion',
    request: {
      method: 'POST',
      auth: { type: 'noauth' },
      url: '{{baseUrl}}/session/login',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: { mode: 'raw', raw: '{"username":"{{username}}","password":"{{password}}"}' },
    },
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            "pm.test('Login',()=>pm.response.to.have.status(200));",
            "if(pm.response.code===200) pm.collectionVariables.set('accessToken',pm.response.json().accessToken);",
          ],
        },
      },
    ],
  });
  const mobile = await templates(resolve(defaultTemplatesRoot(), 'flutter'), {
    __APP_ID__: ir.project.artifactId.replaceAll('-', '_'),
    __TITLE_JSON__: JSON.stringify(ir.project.displayName).replaceAll('$', '\\$'),
    __SCHEMA_HASH__: sha256(Buffer.from(dtoContract(ir))).slice(0, 16),
  });
  // apk.bat / apk.sh en la raiz del ZIP: compilar e instalar sin entrar en
  // carpetas ni recordar la secuencia de Flutter. Solo delegan en
  // mobile/tool/apk.dart, que es donde vive la logica.
  const wrappers = await templates(resolve(defaultTemplatesRoot(), 'mobile-package'), {
    __TITLE__: ir.project.displayName,
  });
  const files: GeneratedFile[] = [
    ...wrappers,
    ...backend.map((f) => ({
      path: `backend/${f.path}`,
      content:
        f.path === 'postman/collection.json'
          ? JSON.stringify(collection, null, 2)
          : f.path === 'docs/flutter-api.md'
            ? f.content
                .replace(
                  'No incluye autenticacion ni sincronizacion offline automatica.',
                  'Este paquete incluye autenticacion Bearer de administrador y sincronizacion offline mediante /mobile-sync. Consultar ../../mobile/README.md.',
                )
                .replace(
                  'Para reintentos offline conservar IDs estables; reenviar una alta UUID sin ID puede crear otro registro.',
                  'Para reintentos offline usar /mobile-sync con el mismo operationId, ID, datos y base; los CRUD directos no ofrecen recibos de idempotencia.',
                )
            : f.content,
    })),
    ...mobile.map((f) => ({ ...f, path: `mobile/${f.path}` })),
    { path: 'mobile/assets/contract.json', content: dtoContract(ir) },
    {
      path: 'README.md',
      content: `# ${ir.project.displayName}: Spring Boot + Flutter Android\n\nComandos de compilacion, USB y autodespliegue local: ver [COMANDOS.md](COMANDOS.md). Desde PowerShell usa .\\apk.bat deploy para backend + instalacion, o .\\apk.bat run --usb para recarga en caliente. El ZIP contiene fuentes; el APK se crea en mobile/dist al compilar.\n\n1. Con Flutter instalado, ejecuta apk.bat (Windows) o sh apk.sh (Linux/macOS) desde esta carpeta: compila el APK y lo deja en mobile/dist. Con el telefono conectado por USB y la depuracion activada, apk.bat install lo instala y lo abre; apk.bat run abre flutter run con recarga en caliente. A mano: dentro de mobile, dart run tool/bootstrap.dart, flutter pub get y flutter run.\n2. Inicia sesion sin internet con usuario admin y contraseña admin. Cada APK crea esta cuenta local y usa el modelo incluido; no necesita backend para login ni CRUD.\n3. Opcional: ejecuta dart run tool/start_backend.dart para configurar y arrancar el backend con semilla admin/admin y secretos aleatorios. Un .env existente conserva sus valores.\n4. Para usarlo, activa Conectar a un servidor en el login e introduce su URL y credenciales. Los registros del modo local y del servidor se guardan por separado.\n5. En Asistente importa modelos de texto LiteRT-LM o GGUF y modelos de voz Whisper GGML .bin. Selecciona cada uno por separado; no se incluyen ni descargan pesos automaticamente. Consulta mobile/docs/local-models.md.\n6. IA en linea (opcional): copia mobile/ai.env.example a mobile/ai.env, pega las mismas lineas de infra/.env del generador (AI_LLM_PROVIDER, AI_LLM_MODEL, AI_SPEECH_*, *_API_KEY) y vuelve a ejecutar apk.bat; o escribelas en la app en Asistente > IA en linea. Ni ai.env ni sus claves entran en Git.\n\nLee mobile/README.md para limites de sincronizacion y compilacion Android. Para Postman, define username y password en un entorno local privado y ejecuta primero Iniciar sesion. El backend de este paquete requiere Bearer token; el ZIP Spring independiente sigue disponible sin este perfil.\n`,
    },
  ];
  // The paired manifest lists the authentication/sync files as well.
  const manifest = files.find((f) => f.path === 'backend/generation-manifest.json')!;
  const manifestData = JSON.parse(manifest.content) as Record<string, unknown>;
  manifestData['mobileRuntime'] = true;
  manifestData['files'] = files
    .filter((f) => f.path.startsWith('backend/'))
    .map((f) => f.path.slice(8))
    .sort();
  const finalFiles = files
    .map((f) => (f === manifest ? { ...f, content: JSON.stringify(manifestData, null, 2) } : f))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return {
    artifactName: `${ir.project.artifactId}-android.zip`,
    ir,
    files: finalFiles,
    zip: await createProjectZip(finalFiles),
  };
}
