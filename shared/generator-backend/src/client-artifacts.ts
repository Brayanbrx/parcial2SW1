import type { GenerationIr, IrEntity } from '@uml/generation-ir';

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const idVariable = (entity: IrEntity): string => `${entity.variableName}Id`;

/** Optional links start null, so only required links constrain creation order. */
function creationPlan(ir: GenerationIr): { entities: IrEntity[]; warnings: string[] } {
  const pending = new Map(ir.entities.map((entity) => [entity.sourceClassId, entity]));
  const entities: IrEntity[] = [];
  const warnings: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].filter(
      (entity) =>
        (entity.superEntityId === null || !pending.has(entity.superEntityId)) &&
        entity.relationships.every((link) => link.optional || !pending.has(link.targetEntityId)),
    );
    if (ready.length === 0) {
      warnings.push(
        `Hay dependencias obligatorias ciclicas: ${[...pending.values()].map((e) => e.className).join(', ')}. Las altas de ejemplo necesitan datos previos o revisar las multiplicidades; no ejecutar la coleccion completa sobre una base vacia.`,
      );
      entities.push(...pending.values());
      break;
    }
    for (const entity of ready) {
      entities.push(entity);
      pending.delete(entity.sourceClassId);
    }
  }
  return { entities, warnings };
}

function sample(type: string, index: number): unknown {
  switch (type) {
    case 'String':
      return `ejemplo-${index}`;
    case 'Integer':
    case 'Long':
      return index;
    case 'Decimal':
      return 10.5;
    case 'Boolean':
      return true;
    case 'Date':
      return '2026-09-01';
    case 'DateTime':
      return '2026-09-01T12:00:00';
    case 'UUID':
      return `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
    default:
      throw new Error(`Tipo sin ejemplo: ${type}`);
  }
}

function exampleDto(ir: GenerationIr, entity: IrEntity): Record<string, unknown> {
  const index = ir.entities.indexOf(entity) + 1;
  return Object.fromEntries([
    ...entity.attributes.map((a) => [a.fieldName, sample(a.conceptualType, index)]),
    ...entity.relationships.map((r) => {
      const target = ir.entities.find((e) => e.sourceClassId === r.targetEntityId)!;
      return [
        r.queryParameterName,
        r.optional
          ? null
          : sample(target.primaryKey.conceptualType, ir.entities.indexOf(target) + 1),
      ];
    }),
  ]);
}

function postmanBody(ir: GenerationIr, entity: IrEntity, update = false): string {
  const body = exampleDto(ir, entity);
  const mutable = entity.attributes.find(
    (a) =>
      !a.primaryKey &&
      !a.unique &&
      ['String', 'Integer', 'Long', 'Decimal', 'Boolean'].includes(a.conceptualType),
  );
  if (update && mutable) {
    const previous = body[mutable.fieldName];
    body[mutable.fieldName] =
      typeof previous === 'number'
        ? previous + 1
        : typeof previous === 'boolean'
          ? !previous
          : `${String(previous)}-editado`;
  }
  const references = [
    { field: entity.primaryKey.fieldName, entity },
    ...entity.relationships
      .filter((r) => !r.optional)
      .map((r) => ({
        field: r.queryParameterName,
        entity: ir.entities.find((e) => e.sourceClassId === r.targetEntityId)!,
      })),
  ];
  for (const ref of references) body[ref.field] = `{{${idVariable(ref.entity)}}}`;
  let raw = JSON.stringify(body, null, 2);
  for (const ref of references) {
    if (['Integer', 'Long'].includes(ref.entity.primaryKey.conceptualType)) {
      const token = `{{${idVariable(ref.entity)}}}`;
      raw = raw.replaceAll(JSON.stringify(token), token);
    }
  }
  return raw;
}

export function postmanCollection(ir: GenerationIr): string {
  const plan = creationPlan(ir);
  const make = (entity: IrEntity, method: string, label: string, status: number) => {
    const path = `/api/${entity.resourcePath}`;
    const raw = `{{baseUrl}}${path}${['PUT', 'DELETE', 'GET_ONE'].includes(method) ? `/{{${idVariable(entity)}}}` : ''}`;
    const writes = method === 'POST' || method === 'PUT';
    const checks = [
      `pm.test('HTTP ${status}', function () { pm.response.to.have.status(${status}); });`,
      ...(status === 204
        ? []
        : [`pm.test('Respuesta JSON', function () { pm.response.to.be.json; });`]),
      ...(method === 'POST'
        ? [
            `if (pm.response.code === 201) {`,
            `  const body = pm.response.json();`,
            `  pm.test('Identificador presente', function () { pm.expect(body[${JSON.stringify(entity.primaryKey.fieldName)}]).to.not.equal(null); pm.expect(body[${JSON.stringify(entity.primaryKey.fieldName)}]).to.not.equal(undefined); });`,
            `  pm.collectionVariables.set(${JSON.stringify(idVariable(entity))}, String(body[${JSON.stringify(entity.primaryKey.fieldName)}]));`,
            `}`,
          ]
        : []),
    ];
    return {
      name: `${label} ${entity.displayName}`,
      event: [{ listen: 'test', script: { type: 'text/javascript', exec: checks } }],
      request: {
        method: method === 'GET_ONE' ? 'GET' : method,
        header: writes ? [{ key: 'Content-Type', value: 'application/json' }] : [],
        ...(writes
          ? {
              body: {
                mode: 'raw',
                raw: postmanBody(ir, entity, method === 'PUT'),
                options: { raw: { language: 'json' } },
              },
            }
          : {}),
        // A raw URL avoids inconsistent host/path components after variable substitution.
        url: raw,
      },
    };
  };
  return json({
    info: {
      name: `${ir.project.displayName} API`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description: [
        'CRUD de demostracion: ejecutar en una base de prueba. Crea, consulta, actualiza y BORRA los registros de ejemplo. IDs editables en variables de coleccion; no usar IDs de datos reales. Relaciones opcionales empiezan en null. Las altas repetidas con la misma clave devuelven el registro existente.',
        ...plan.warnings,
      ].join('\n'),
    },
    variable: [
      { key: 'baseUrl', value: 'http://localhost:8081' },
      ...ir.entities.map((e, i) => ({
        key: idVariable(e),
        value: String(sample(e.primaryKey.conceptualType, i + 1)),
      })),
    ],
    item: [
      ...plan.entities.map((e) => make(e, 'POST', 'Crear', 201)),
      ...plan.entities.flatMap((e) => [
        make(e, 'GET', 'Listar', 200),
        make(e, 'GET_ONE', 'Obtener', 200),
        make(e, 'PUT', 'Modificar', 200),
      ]),
      ...[...plan.entities].reverse().map((e) => make(e, 'DELETE', 'Eliminar', 204)),
    ],
  });
}

export function postmanEnvironment(ir: GenerationIr): string {
  return json({
    name: `${ir.project.displayName} - local`,
    values: [{ key: 'baseUrl', value: 'http://localhost:8081', enabled: true }],
    _postman_variable_scope: 'environment',
  });
}

const jsonType = (javaType: string): string =>
  ['Integer', 'Long', 'BigDecimal'].includes(javaType)
    ? 'number'
    : javaType === 'Boolean'
      ? 'boolean'
      : 'string';
const dartType = (javaType: string): string =>
  ['Integer', 'Long'].includes(javaType)
    ? 'int'
    : javaType === 'BigDecimal'
      ? 'num'
      : javaType === 'Boolean'
        ? 'bool'
        : 'String';

export function dtoContract(ir: GenerationIr): string {
  return json({
    schemaVersion: 1,
    project: ir.project.artifactId,
    errors: {
      timestamp: 'ISO-8601 UTC',
      status: 'integer',
      error: 'string',
      message: 'string',
      path: 'string',
      fieldErrors: 'object: field -> message',
    },
    resources: ir.entities.map((e) => ({
      className: e.className,
      dto: e.dtoName,
      path: `/api/${e.resourcePath}`,
      primaryKey: e.primaryKey.fieldName,
      createKeyOptional: e.primaryKey.conceptualType === 'UUID',
      fields: [
        ...e.attributes.map((a) => ({
          name: a.fieldName,
          javaType: a.javaType,
          jsonType: jsonType(a.javaType),
          dartType: dartType(a.javaType),
          nullable: a.nullable,
          primaryKey: a.primaryKey,
          maxLength: a.length,
          precision: a.precision,
          scale: a.scale,
        })),
        ...e.relationships.map((r) => ({
          name: r.queryParameterName,
          javaType: r.targetPrimaryKeyJavaType,
          jsonType: jsonType(r.targetPrimaryKeyJavaType),
          dartType: dartType(r.targetPrimaryKeyJavaType),
          nullable: r.optional,
          references: r.targetClassName,
        })),
      ],
      filters: e.relationships.map((r) => r.queryParameterName),
      example: exampleDto(ir, e),
    })),
  });
}

export function clientGuide(ir: GenerationIr): string {
  return [
    '# Contrato para Flutter y otros clientes',
    '',
    'El controlador recibe y devuelve DTOs planos. Las entidades JPA quedan dentro del backend. Las relaciones viajan mediante la clave del destino; no enviar objetos anidados. Los DTOs incluyen atributos heredados.',
    '',
    '## Operaciones',
    '',
    '- GET /api/recurso: lista JSON (sin paginacion). GET /api/recurso/{id}: un DTO.',
    '- POST: DTO completo; devuelve 201 y el DTO persistido. UUID omitido se genera; las claves Integer/Long/String deben enviarse. Con la misma clave existente devuelve el registro previo, no actualiza sus campos.',
    '- PUT /{id}: reemplaza los campos editables, no es PATCH. Enviar todos los obligatorios. La clave puede omitirse; si se incluye debe coincidir con la ruta. null limpia campos opcionales.',
    '- DELETE /{id}: 204 sin cuerpo. No llamar jsonDecode sobre esta respuesta. Borrar primero dependientes; las referencias existentes pueden producir 409.',
    '- Los filtros por clave foranea estan enumerados debajo. Usar un filtro por solicitud: si se envian varios, el controlador actual utiliza el primero declarado.',
    '',
    '## Tipos y errores',
    '',
    'String/UUID: String. Integer/Long: int. Boolean: bool. Decimal: numero JSON, usar num al leer (puede llegar como entero); evitar aritmetica binaria de double para importes exactos. Date: YYYY-MM-DD. DateTime: YYYY-MM-DDTHH:mm:ss sin zona (LocalDateTime); no añadir Z ni convertir de zona implicitamente. Los campos anulables requieren tipos Dart con ?. Ver docs/dto-contract.json para cada recurso.',
    '',
    'Errores: {timestamp,status,error,message,path,fieldErrors}. 400: entrada invalida; 404: registro o referencia inexistente; 409: unicidad/integridad. fieldErrors asocia campos a mensajes de validacion. Mostrar message y conservar el formulario/dictado para corregirlo.',
    '',
    '## Conexion',
    '',
    'Postman en el PC: http://localhost:8081. Android Emulator: http://10.0.2.2:8081. Telefono fisico: IP LAN del equipo y puerto 8081, ambos en la misma red y firewall configurado. localhost en un telefono apunta al propio telefono. Flutter nativo no necesita CORS; Flutter web requiere incluir su origen exacto en CORS_ALLOWED_ORIGINS. HTTP de desarrollo puede requerir habilitacion especifica del cliente; usar HTTPS en despliegue publico.',
    '',
    'Este backend genera CRUD y restricciones estructurales del diagrama; no inventa reglas como descontar inventario o calcular una venta. El cliente debe añadir su flujo de negocio. No incluye autenticacion ni sincronizacion offline automatica. Antes de exponerlo publicamente, añadir los permisos del caso de uso y HTTPS. Para reintentos offline conservar IDs estables; reenviar una alta UUID sin ID puede crear otro registro.',
    '',
    '## Recursos de este diagrama',
    '',
    ...ir.entities.flatMap((e) => [
      `### ${e.dtoName}`,
      '',
      `Ruta: /api/${e.resourcePath}. Clave: ${e.primaryKey.fieldName} (${e.primaryKey.javaType}).`,
      `Filtros: ${e.relationships.map((r) => `${r.queryParameterName} (${r.targetPrimaryKeyJavaType})`).join(', ') || 'ninguno'}.`,
      '',
      '```json',
      JSON.stringify(exampleDto(ir, e), null, 2),
      '```',
      '',
    ]),
    ...creationPlan(ir).warnings,
    '',
  ].join('\n');
}
