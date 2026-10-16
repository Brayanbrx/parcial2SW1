# Banco de regresión T01–T08

Los ocho modelos de la sección 15.2 del plan maestro.

## Los JSON de este directorio son derivados

**No se editan a mano.** La fuente son las definiciones en
[`../src/definitions.ts`](../src/definitions.ts), donde los modelos se declaran
con nombres visuales y los nombres técnicos los deriva el normalizador real.

```bash
npm run fixtures:emit    # regenerar los JSON
npm run bank:report      # ver qué encuentra el validador en cada modelo
```

Una prueba comprueba que lo versionado coincide con lo que producen las
definiciones. Si falla, alguien editó el JSON a mano o cambió las definiciones
sin volver a emitir.

Escribir los nombres técnicos a mano garantizaría que en algún momento el banco
pruebe una normalización distinta de la que la plataforma aplica de verdad.

## Cobertura

| ID | Modelo | Qué ejercita |
|---|---|---|
| T01 | Cliente · Producto · Venta · DetalleVenta | 1:N, N:1, decimales, fechas, entidad intermedia |
| T02 | Proveedor · Compra · DetalleCompra · Producto | Mismo patrón, otra terminología |
| T03 | Cliente · Barbero · Servicio · Atencion | Caso de la aplicación móvil |
| T04 | Activo · Categoria · Responsable · Asignacion | Varias claves foráneas sobre una entidad |
| T05 | Cliente · Cuenta · Movimiento | Cadena de tres niveles |
| T06 | Alumno · Materia · Inscripcion | Muchos a muchos con atributos |
| T07 | Modelo hostil | Ver abajo |
| T07R | Modelo hostil resuelto | Lo mismo que T07, con la colisión arreglada, para que llegue al generador |
| T08 | Persona · Empleado · Docente · Estudiante · Departamento · Materia · Inscripcion | Generalización: ver abajo |

## T01 a T06 son válidos

El validador no encuentra **ningún error** en ellos. Avisos sí: nombres que se
normalizan, sobre todo. Los avisos permiten generar.

## T07 no es válido, y esa es su razón de ser

Contiene deliberadamente:

| Construcción | Qué ejercita | Resultado esperado |
|---|---|---|
| Clase `Order` | Reservada de PostgreSQL | Tabla `app_order`, ruta `/api/order` |
| Clase `Número de Cuenta` | Tildes y espacios | `NumeroCuenta` / `numero_cuenta` |
| Atributo `class` | Reservada de Java | Campo `appClass`, columna `class` |
| Clase `Detalle de Venta` sin clave | Inferencia RTM-04 rama 4 | Aviso: se generará `id : UUID` |
| `Detalle de Venta` + `detalle venta` | Colisión al normalizar | **Error** `DUPLICATE_CLASS_NAME` |
| Dos relaciones `Cliente`↔`Order` con roles | Derivación por rol (CA-015.1) | Dos campos distintos, sin error |
| Multiplicidad `0..1` | Opcionalidad RTM-06 | — |
| Atributo `código` único | Restricción de unicidad | — |

**Un solo error, el de la colisión.** Todo lo demás son avisos. Que `Order` y
`class` produzcan aviso y no error es el punto: la herramienta los resuelve y
sigue adelante en lugar de bloquear al usuario.

## T07R existe porque T07 no puede generarse

Un modelo con error no llega al generador por construcción. Pero todo lo demás
que contiene T07 —la reservada de PostgreSQL, la de Java, las tildes, la clase
sin clave, los dos roles, el `0..1` y el atributo único— es justo lo que hay que
**ver compilar de verdad**.

`T07R` se deriva de `T07` renombrando la clase que colisiona. Derivarlo y no
copiarlo garantiza que las dos versiones no se separen: cualquier cosa que se
añada a T07 aparece también en T07R.

## T08 es el único modelo con herencia

Los siete anteriores solo tienen claves foráneas, y una clave foránea se prueba
sola: si el campo está, funciona. La generalización se proyecta a tabla por
clase unida por la clave primaria (RTM-13), y eso falla de formas que compilan.

| Construcción | Qué ejercita |
|---|---|
| `Docente ▷ Empleado ▷ Persona` | Tres niveles. Con dos no se distingue heredar de la superclase de heredar de la raíz, y la clave primaria sale de la raíz |
| `Empleado` y `Estudiante` bajo `Persona` | Dos hermanas: cada una añade sus columnas sin ver las de la otra |
| `Departamento 1 ── N Empleado` | `Docente` hereda esa clave foránea, y su servicio inyecta un repositorio que su clase no menciona |
| `Docente 1 ── N Materia` | Una clave foránea que apunta a una hoja de la jerarquía, no a la raíz |
| Tres subclases sin clave propia | Aviso `PRIMARY_KEY_INHERITED`, no el `PRIMARY_KEY_GENERATED` de una clase suelta |

`GENERABLE_FIXTURE_IDS` es la lista que recorre el banco de generación: T01–T06,
T07R y T08. T07 queda fuera a propósito.

## Cómo se ejecuta el banco

```bash
npm run bank:report    # qué encuentra el validador en cada modelo (rápido)
npm run test:generated # solo T01 por la DoD 15.1 completa
npm run test:bank      # los ocho generables por la DoD 15.1 completa
```

`test:bank` compila y arranca ocho backends: son minutos. RNF-13 lo resuelve
así — cada cambio ejecuta al menos T01, la rama principal ejecuta el banco
completo.

## Por qué el escape es por nombre y no por elemento

`Order` recibe `app_order` en la tabla pero conserva `Order` como nombre de
código. Es deliberado: RTM-08 deriva la ruta REST del nombre de código
precisamente para que el prefijo no se filtre a las URL. Lo mismo al revés con
`class`, que se escapa en el código Java pero no en la columna, porque `class`
no es reservada en PostgreSQL.
