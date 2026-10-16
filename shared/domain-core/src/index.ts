/**
 * @uml/domain-core
 *
 * Nucleo de dominio: normalizacion de nombres (RTM-02, RTM-03), resolucion de
 * clave primaria (RTM-04), validador (RF-017) y aplicador de comandos (4.7).
 *
 * RA-05: una implementacion, dos lugares de ejecucion. Este paquete corre igual
 * en el navegador y en el servidor.
 *
 * RNF-15: se prueba sin navegador, sin base de datos, sin WebSocket, sin
 * proveedor de IA y sin sistema de archivos. Si alguna vez necesita alguna de
 * esas cosas, la dependencia esta en el sitio equivocado.
 */
export * from './reserved-words.js';
export * from './naming.js';
export * from './primary-key.js';
export * from './inheritance.js';
export * from './validate.js';
export * from './apply.js';
export * from './proposal-preconditions.js';
