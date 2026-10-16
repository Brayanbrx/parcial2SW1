import type { FixtureSpec } from './build.js';

/**
 * Banco de regresion (plan maestro 15.2).
 *
 * Los modelos se declaran con nombres visuales. Los nombres tecnicos los deriva
 * el normalizador real, no se escriben aqui.
 *
 * T01 a T06 son modelos validos: el validador no debe encontrar ningun error en
 * ellos. T07 es lo contrario: existe para que encuentre exactamente los que se
 * enumeran en su ficha.
 */

const T01: FixtureSpec = {
  id: 'T01',
  title: 'Ventas',
  coverage: '1:N, N:1, decimales, fechas y entidad intermedia',
  classes: [
    {
      name: 'Cliente',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'correo', type: 'String', required: true, unique: true },
        { name: 'telefono', type: 'String' },
      ],
    },
    {
      name: 'Producto',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'precio', type: 'Decimal', required: true },
        { name: 'stock', type: 'Integer', required: true },
      ],
    },
    {
      name: 'Venta',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'fecha', type: 'DateTime', required: true },
        { name: 'total', type: 'Decimal', required: true },
      ],
    },
    {
      // RM-01: la relacion muchos a muchos entre Venta y Producto se modela con
      // esta clase intermedia explicita y dos relaciones N:1.
      name: 'Detalle de Venta',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'cantidad', type: 'Integer', required: true },
        { name: 'precio unitario', type: 'Decimal', required: true },
        { name: 'subtotal', type: 'Decimal', required: true },
      ],
    },
  ],
  relationships: [
    { from: 'Cliente', fromMultiplicity: '1', to: 'Venta', toMultiplicity: '0..*' },
    { from: 'Venta', fromMultiplicity: '1', to: 'Detalle de Venta', toMultiplicity: '0..*' },
    { from: 'Producto', fromMultiplicity: '1', to: 'Detalle de Venta', toMultiplicity: '0..*' },
  ],
};

const T02: FixtureSpec = {
  id: 'T02',
  title: 'Compras',
  coverage: 'Mismo patron que T01 con otra terminologia',
  classes: [
    {
      name: 'Proveedor',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'razon social', type: 'String', required: true },
        { name: 'nit', type: 'String', required: true, unique: true },
      ],
    },
    {
      name: 'Producto',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'costo', type: 'Decimal', required: true },
      ],
    },
    {
      name: 'Compra',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'fecha', type: 'Date', required: true },
        { name: 'total', type: 'Decimal', required: true },
      ],
    },
    {
      name: 'Detalle de Compra',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'cantidad', type: 'Integer', required: true },
        { name: 'costo unitario', type: 'Decimal', required: true },
      ],
    },
  ],
  relationships: [
    { from: 'Proveedor', fromMultiplicity: '1', to: 'Compra', toMultiplicity: '0..*' },
    { from: 'Compra', fromMultiplicity: '1', to: 'Detalle de Compra', toMultiplicity: '0..*' },
    { from: 'Producto', fromMultiplicity: '1', to: 'Detalle de Compra', toMultiplicity: '0..*' },
  ],
};

const T03: FixtureSpec = {
  id: 'T03',
  title: 'Barberia',
  coverage: 'Caso de la aplicacion movil: varias claves foraneas en la entidad de registro',
  classes: [
    {
      name: 'Cliente',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'telefono', type: 'String' },
      ],
    },
    {
      name: 'Barbero',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'activo', type: 'Boolean', required: true },
      ],
    },
    {
      name: 'Servicio',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'precio', type: 'Decimal', required: true },
        { name: 'duracion minutos', type: 'Integer', required: true },
      ],
    },
    {
      name: 'Atencion',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'fecha', type: 'DateTime', required: true },
        { name: 'monto', type: 'Decimal', required: true },
        { name: 'observacion', type: 'String' },
      ],
    },
  ],
  relationships: [
    { from: 'Cliente', fromMultiplicity: '1', to: 'Atencion', toMultiplicity: '0..*' },
    { from: 'Barbero', fromMultiplicity: '1', to: 'Atencion', toMultiplicity: '0..*' },
    { from: 'Servicio', fromMultiplicity: '1', to: 'Atencion', toMultiplicity: '0..*' },
  ],
};

const T04: FixtureSpec = {
  id: 'T04',
  title: 'Inventario de activos',
  coverage: 'Varias claves foraneas sobre una entidad y una relacion opcional',
  classes: [
    {
      name: 'Categoria',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true, unique: true },
      ],
    },
    {
      name: 'Responsable',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'correo', type: 'String', required: true, unique: true },
      ],
    },
    {
      name: 'Activo',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'codigo', type: 'String', required: true, unique: true },
        { name: 'descripcion', type: 'String', required: true },
        { name: 'valor', type: 'Decimal', required: true },
        { name: 'fecha alta', type: 'Date', required: true },
      ],
    },
    {
      name: 'Asignacion',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'fecha inicio', type: 'Date', required: true },
        { name: 'fecha fin', type: 'Date' },
      ],
    },
  ],
  relationships: [
    { from: 'Categoria', fromMultiplicity: '1', to: 'Activo', toMultiplicity: '0..*' },
    { from: 'Activo', fromMultiplicity: '1', to: 'Asignacion', toMultiplicity: '0..*' },
    { from: 'Responsable', fromMultiplicity: '1', to: 'Asignacion', toMultiplicity: '0..*' },
  ],
};

const T05: FixtureSpec = {
  id: 'T05',
  title: 'Cuentas y movimientos',
  coverage: 'Cadena de tres niveles de dependencia',
  classes: [
    {
      name: 'Cliente',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'documento', type: 'String', required: true, unique: true },
      ],
    },
    {
      name: 'Cuenta',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'numero', type: 'String', required: true, unique: true },
        { name: 'saldo', type: 'Decimal', required: true },
        { name: 'activa', type: 'Boolean', required: true },
      ],
    },
    {
      name: 'Movimiento',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'fecha', type: 'DateTime', required: true },
        { name: 'monto', type: 'Decimal', required: true },
        { name: 'concepto', type: 'String', required: true },
      ],
    },
  ],
  relationships: [
    { from: 'Cliente', fromMultiplicity: '1', to: 'Cuenta', toMultiplicity: '0..*' },
    { from: 'Cuenta', fromMultiplicity: '1', to: 'Movimiento', toMultiplicity: '0..*' },
  ],
};

const T06: FixtureSpec = {
  id: 'T06',
  title: 'Inscripciones',
  coverage: 'Muchos a muchos con atributos, resuelto con entidad intermedia (RM-01)',
  classes: [
    {
      name: 'Alumno',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'registro', type: 'String', required: true, unique: true },
      ],
    },
    {
      name: 'Materia',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'sigla', type: 'String', required: true, unique: true },
        { name: 'creditos', type: 'Integer', required: true },
      ],
    },
    {
      name: 'Inscripcion',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'gestion', type: 'Integer', required: true },
        { name: 'nota', type: 'Decimal' },
        { name: 'fecha', type: 'Date', required: true },
      ],
    },
  ],
  relationships: [
    { from: 'Alumno', fromMultiplicity: '1', to: 'Inscripcion', toMultiplicity: '0..*' },
    { from: 'Materia', fromMultiplicity: '1', to: 'Inscripcion', toMultiplicity: '0..*' },
  ],
};

/**
 * T07 es obligatorio y contiene deliberadamente todo lo que puede salir mal.
 * Ejercita de una sola vez normalizacion, las tres listas de reservadas,
 * inferencia de clave, colisiones, derivacion por rol y opcionalidad.
 *
 * A diferencia de los seis anteriores, este modelo **no es valido**: su razon de
 * ser es que el validador encuentre exactamente los hallazgos de su ficha.
 */
const T07: FixtureSpec = {
  id: 'T07',
  title: 'Modelo hostil',
  coverage:
    'Reservada de PostgreSQL, tildes y espacios, reservada de Java, clase sin clave, ' +
    'colision al normalizar, dos relaciones entre el mismo par con roles, 0..1 y unico',
  classes: [
    {
      // Reservada de PostgreSQL: la tabla sera `app_order`, pero la ruta REST
      // sigue siendo `/api/order` (RTM-08).
      name: 'Order',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'fecha', type: 'DateTime', required: true },
        // Reservada de Java: el campo sera `appClass`.
        { name: 'class', type: 'String' },
        { name: 'total', type: 'Decimal', required: true },
      ],
    },
    {
      // Tildes y espacios.
      name: 'Número de Cuenta',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'código', type: 'String', required: true, unique: true },
      ],
    },
    {
      name: 'Cliente',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
      ],
    },
    {
      // Sin clave primaria: el generador emitira `id : UUID` y avisara.
      name: 'Detalle de Venta',
      attributes: [{ name: 'cantidad', type: 'Integer', required: true }],
    },
    {
      // Normaliza al mismo identificador que la clase anterior: es error.
      name: 'detalle venta',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nota', type: 'String' },
      ],
    },
  ],
  relationships: [
    // Dos relaciones entre el mismo par con roles distintos: producen dos campos
    // distintos en `Order` y ambas deben compilar (CA-015.1).
    {
      from: 'Cliente',
      fromMultiplicity: '1',
      fromRole: 'facturacion',
      to: 'Order',
      toMultiplicity: '0..*',
    },
    {
      from: 'Cliente',
      fromMultiplicity: '1',
      fromRole: 'envio',
      to: 'Order',
      toMultiplicity: '0..*',
    },
    // Multiplicidad 0..1.
    { from: 'Cliente', fromMultiplicity: '1', to: 'Número de Cuenta', toMultiplicity: '0..1' },
    { from: 'Order', fromMultiplicity: '1', to: 'Detalle de Venta', toMultiplicity: '0..*' },
  ],
};

/**
 * T07 con la colision resuelta.
 *
 * T07 no llega al generador por construccion: tiene un error, y un modelo con
 * error no se genera. Pero todo lo demas que contiene —la reservada de
 * PostgreSQL, la de Java, las tildes, la clase sin clave, los dos roles, el
 * `0..1` y el atributo unico— es justo lo que hay que ver compilar de verdad.
 *
 * Se deriva de T07 renombrando la clase que colisiona. Derivarlo y no copiarlo
 * garantiza que las dos versiones no se separen: cualquier cosa que se anada a
 * T07 aparece tambien aqui.
 */
const T07R: FixtureSpec = {
  ...T07,
  id: 'T07R',
  title: 'Modelo hostil resuelto',
  coverage: T07.coverage + ', con la colision resuelta para que llegue al generador',
  classes: T07.classes.map((clase) =>
    clase.name === 'detalle venta' ? { ...clase, name: 'nota de venta' } : clase,
  ),
};

/**
 * T08 existe porque la herencia no se parece a nada mas del banco.
 *
 * Los siete modelos anteriores solo tienen claves foraneas, y una clave foranea
 * se prueba a si misma: si el campo esta, funciona. La generalizacion se
 * proyecta a tabla por clase unida por la clave primaria, y ahi hay cuatro
 * cosas que solo fallan ejecutando:
 *
 *   - `Docente` cuelga de `Empleado`, que cuelga de `Persona`. Con dos niveles
 *     no se distingue heredar de la superclase de heredar de la raiz, y la
 *     clave primaria viene de la raiz.
 *   - `Empleado` y `Estudiante` son hermanas: cada una anade sus columnas sin
 *     ver las de la otra.
 *   - `Departamento` apunta a `Empleado`, asi que `Docente` hereda esa clave
 *     foranea y su servicio tiene que inyectar un repositorio que su clase no
 *     menciona.
 *   - `Materia` apunta a `Docente`, que es una hoja de la jerarquia: la clave
 *     foranea referencia la tabla hija, no la de la raiz.
 */
const T08: FixtureSpec = {
  id: 'T08',
  title: 'Institucion con jerarquia',
  coverage:
    'Generalizacion en cadena de tres niveles, dos hermanas, clave foranea heredada y ' +
    'clave foranea que apunta a una subclase',
  classes: [
    {
      name: 'Persona',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'correo', type: 'String' },
      ],
    },
    {
      // Sin clave propia: la hereda de Persona, y por eso no produce el aviso
      // PRIMARY_KEY_GENERATED que produciria una clase suelta sin clave.
      name: 'Empleado',
      attributes: [
        { name: 'fecha de ingreso', type: 'Date', required: true },
        { name: 'salario', type: 'Decimal', required: true },
      ],
    },
    {
      name: 'Docente',
      attributes: [{ name: 'escalafon', type: 'String' }],
    },
    {
      name: 'Estudiante',
      attributes: [{ name: 'matricula', type: 'String', required: true, unique: true }],
    },
    {
      name: 'Departamento',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
      ],
    },
    {
      name: 'Materia',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'nombre', type: 'String', required: true },
        { name: 'creditos', type: 'Integer', required: true },
      ],
    },
    {
      name: 'Inscripcion',
      attributes: [
        { name: 'id', type: 'UUID', primaryKey: true },
        { name: 'fecha', type: 'Date', required: true },
        { name: 'nota', type: 'Decimal' },
      ],
    },
  ],
  relationships: [
    // El origen es la subclase y el destino la superclase. Las multiplicidades
    // no significan nada en una generalizacion; se declaran por uniformidad.
    {
      kind: 'GENERALIZATION',
      from: 'Empleado',
      fromMultiplicity: '1',
      to: 'Persona',
      toMultiplicity: '1',
    },
    {
      kind: 'GENERALIZATION',
      from: 'Docente',
      fromMultiplicity: '1',
      to: 'Empleado',
      toMultiplicity: '1',
    },
    {
      kind: 'GENERALIZATION',
      from: 'Estudiante',
      fromMultiplicity: '1',
      to: 'Persona',
      toMultiplicity: '1',
    },
    // La clave foranea la recibe Empleado, y Docente la hereda.
    { from: 'Departamento', fromMultiplicity: '1', to: 'Empleado', toMultiplicity: '0..*' },
    // Y esta apunta a una subclase.
    { from: 'Docente', fromMultiplicity: '1', to: 'Materia', toMultiplicity: '0..*' },
    { from: 'Estudiante', fromMultiplicity: '1', to: 'Inscripcion', toMultiplicity: '0..*' },
    { from: 'Materia', fromMultiplicity: '1', to: 'Inscripcion', toMultiplicity: '0..*' },
  ],
};

export const FIXTURE_SPECS: readonly FixtureSpec[] = [T01, T02, T03, T04, T05, T06, T07, T07R, T08];

/** Los que el validador debe aceptar sin un solo error. */
export const VALID_FIXTURE_IDS = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07R', 'T08'] as const;

/**
 * Los que pasan por el generador (RNF-13).
 *
 * T07 queda fuera a proposito: su razon de ser es que el validador lo rechace.
 */
export const GENERABLE_FIXTURE_IDS = VALID_FIXTURE_IDS;
