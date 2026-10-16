/**
 * @uml/yjs-adapter
 *
 * Puerto del documento colaborativo. Traduce entre el modelo canonico plano, que
 * es donde viven las reglas, y el documento replicado, que es donde vive el
 * estado compartido.
 *
 * RA-11: el documento se persiste en su representacion binaria nativa. El JSON
 * canonico que produce `readBoardState` es proyeccion derivada y nunca
 * reconstruye el documento.
 *
 * RA-12: la colaboracion garantiza convergencia estructural, no validez
 * semantica. Dos usuarios pueden converger en un modelo invalido; el validador
 * lo marca antes de permitir generar.
 */
export * from './document.js';
export * from './apply.js';
