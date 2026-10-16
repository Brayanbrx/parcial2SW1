# Fixtures XMI

Archivos reales exportados de la instalación del laboratorio. **No** archivos
construidos a mano contra el estándar teórico.

## Muestra real incorporada

`architect-practica1.xmi` es el archivo exportado por Enterprise Architect 15
que se usó para ajustar y probar el parser. Contiene tipos Java en
`primitivetypes`, atributos en la extensión nativa, conectores y el diagrama
`Logical`.

La instalación de destino es **Enterprise Architect 15** (confirmado el 29 de
agosto de 2026). EA 15 puede publicar en XMI 1.1, XMI 2.1 y XMI 2.4.2.

El parser de `@uml/xmi` se prueba ahora contra esa muestra real y contra el
archivo generado anteriormente por la app. La prueba comprueba nombres, tipos,
relaciones y avisos. La apertura del archivo nuevo en una instalación EA real
sigue siendo la validación final de interoperabilidad.

### Qué hay que hacer

1. Abrir Enterprise Architect 15 en la máquina del laboratorio.
2. Si se desea ampliar la cobertura, exportar otros diagramas en **XMI 2.1**
   a este directorio; la prueba los recorrerá automáticamente.
3. Ejecutar `npm test`.
4. Abrir en EA un archivo generado por `npm run up` → exportar XMI, y comprobar
   que se ve el diagrama.
5. Confirmar con el docente si exige importación **y** exportación, o si basta
   con exportar.

Si hay que recortar, **exportar es lo que no se sacrifica**: el caso de uso del
docente es hacer el diagrama de secuencia sobre clases que ya existen. RF-050 es
P0; RF-051 es P1.

## Por qué archivos reales y no sintéticos

La variante de XMI que produce EA tiene extensiones propias y decisiones de
serialización que el estándar no fija — dónde cuelga el modelo, cómo escribe el
tipo de un atributo, si los extremos de una asociación van dentro de la
asociación o dentro de la clase.

Un parser escrito contra el estándar y probado contra archivos sintéticos falla
el día de la defensa contra el archivo que el docente abre en su máquina. Por eso
el nuestro acepta las tres notaciones de tipo que se ven en la práctica y busca
el modelo sin depender de una ruta fija — pero esas son mitigaciones, no una
verificación.

## Qué exporta la plataforma

La descarga usa UML/XMI 2.1 con el perfil de Enterprise Architect. La cabecera
`exporter="Enterprise Architect" exporterVersion="6.5"` activa su importador
nativo; un comentario identifica a la app como productor. Ver el
[resultado de la importación real y su corrección](../../docs/compatibilidad-xmi-2026-09-05.md).

| Elemento | Cómo se emite |
|---|---|
| Clase | `packagedElement` con `xmi:type="uml:Class"` |
| Atributo | `ownedAttribute` con referencia a tipos EAJava declarados en `xmi:Extension/primitivetypes`; respaldo en `properties.type` |
| Clave primaria | `isID="true"` — UML estándar, significa exactamente eso |
| Obligatorio | `lowerValue` a 1; opcional, a 0 |
| Relación | `uml:Association` con dos `ownedEnd`, cada uno con su multiplicidad |
| Identidad | UUID como `EAID_...`, paquete `EAPK_...` y referencias coherentes |
| Diagrama | Extensión EA con posiciones, tamaños, conectores y opciones de detalle |

La marca de atributo único se conserva en una extensión propia: `isUnique` de
UML describe repetidos en una colección, no unicidad de columna. Las extensiones
EA contienen tipos y presentación; ignorarlas puede perder esa información.
`serializeToXmi` sigue disponible como serializador genérico con tipos en el modelo.
