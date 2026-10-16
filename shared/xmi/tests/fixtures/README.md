# Muestras de interoperabilidad

- `app-ejemplo-legacy.xmi`: `exportadodeapp.xmi`, primer archivo de la app
  entregado por el usuario; 11 clases, 44 atributos y 12 relaciones.
- `app-ea-header-legacy.xmi`: `ExportadoNuevo.xmi`, exportación posterior de la
  app, con paquete y extensión de EA pero cabecera `Plataforma UML`;
  11 clases, 44 atributos tipados y 13 relaciones (incluye autorrelación de Materia).
- `ea-roundtrip-missing-types.xmi`: `exportadodeimportado.xmi`, obtenido por el
  usuario al importar el archivo anterior en EA y exportarlo otra vez. Conserva
  clases y atributos pero pierde los 44 tipos. Es evidencia de un fallo, no un
  ejemplo de exportación correcta. Su codificación original es Windows-1252.
- `ea-association-class.xmi`: `PracticaProbar.xmi`, exportado por Architect.
  Contiene una `Inscripcion` vacía y otra `uml:AssociationClass` con cuatro
  atributos, enlazada mediante proxies a la asociación Estudiante–Curso.
  Se usa para verificar su conversión a entidad intermedia y su composición
  con Calificacion. Se conservan los bytes originales Windows-1252.

Los archivos se conservan sin editar. Las pruebas verifican que la pérdida de
tipos produzca avisos: el fallback `String` del parser no prueba interoperabilidad.
La muestra nativa de referencia está en `fixtures/xmi/architect-practica1.xmi`.
