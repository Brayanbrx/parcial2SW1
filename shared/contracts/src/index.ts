/**
 * @uml/contracts — fuente unica de verdad de los contratos.
 *
 * De este paquete se derivan los tipos estaticos, el validador en ejecucion y el
 * esquema JSON que se le entrega al modelo de lenguaje como formato de salida.
 * Mantener a mano un esquema JSON y aparte los tipos garantiza que en algun
 * momento discrepen, y el sintoma seria un lote que el asistente produce y el
 * editor rechaza sin motivo aparente.
 */
export * from './vocabulary.js';
export * from './severity.js';
export * from './model.js';
export * from './commands.js';
export * from './validation.js';
