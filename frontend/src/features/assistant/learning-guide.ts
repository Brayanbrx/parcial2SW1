import type { SemanticModel } from '@uml/contracts';

export type AssistantMode = 'instruir' | 'preguntar';
export const learningSteps = [
  {
    title: 'Elige lo que necesitas',
    text: 'Consultar sirve para entender el diagrama o revisar si está listo para generar código. Instruir sirve para proponer cambios en clases, atributos y relaciones. Una consulta no modifica tu pizarra.',
    tip: 'Empieza consultando qué contiene tu diagrama.',
  },
  {
    title: 'Escribe una instrucción concreta',
    text: 'Indica la acción, el nombre exacto de la clase y los detalles del cambio. Por ejemplo, al añadir un atributo, incluye su nombre y tipo. Pide un cambio a la vez; si falta información, responde a la aclaración del asistente.',
    tip: 'El ejemplo se adapta a la pizarra actual. Puedes editarlo antes de enviarlo.',
  },
  {
    title: 'También puedes dictar',
    text: 'Pulsa Dictar, concede acceso al micrófono y habla con claridad. Pulsa Parar y revisa nombres, tipos y negaciones en el texto. Solo pulsa Enviar cuando esté correcto.',
    tip: 'Si no aparece Dictar, escribe tu solicitud. El reconocimiento depende del navegador, sus permisos y, en algunos casos, de internet.',
  },
  {
    title: 'Revisa antes de aplicar',
    text: 'Enviar una instrucción prepara una propuesta. Lee el resumen y comprueba las clases, atributos y relaciones afectados antes de pulsar Aplicar o Sí, aplicar. Si no coincide con tu intención, no la apliques y escribe una instrucción corregida.',
    tip: 'Si otro participante cambia el diagrama, una propuesta puede quedar desactualizada. Vuelve a enviarla y revisa la nueva propuesta.',
  },
] as const;

export function instructionExample(model: SemanticModel): string {
  const first = model.classes[0];
  if (!first) return 'Crea una clase Cliente con un atributo nombre de tipo String.';
  let name = 'notaIA';
  for (
    let suffix = 2;
    first.attributes.some((attribute) => attribute.codeName === name);
    suffix++
  ) {
    name = `notaIA${suffix}`;
  }
  return `Agrega el atributo ${name} de tipo String a la clase ${first.codeName}.`;
}
