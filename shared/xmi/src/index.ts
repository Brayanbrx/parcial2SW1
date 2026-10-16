/**
 * @uml/xmi
 *
 * Interoperabilidad con Enterprise Architect (RF-050 a RF-053).
 *
 * La variante de XMI se determina con archivos reales exportados de la
 * instalacion del laboratorio, no con el estandar teorico. Mientras no haya
 * ninguno, el serializador emite UML 2.1 estandar y el parser acepta las
 * variantes de notacion que se ven en la practica, reportando lo que no entiende
 * en lugar de descartarlo en silencio.
 *
 * Si hay que recortar, exportar es lo que no se sacrifica: el caso de uso del
 * docente es hacer el diagrama de secuencia sobre clases que ya existen.
 */
export * from './serialize.js';
export * from './enterprise-architect.js';
export * from './parse.js';
export * from './to-proposal.js';
export * from './to-batch.js';
