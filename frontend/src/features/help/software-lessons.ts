export interface SoftwareLesson {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly keywords: string;
  readonly where: string;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly practice: string;
  readonly tip: string;
}

export const softwareLessons: readonly SoftwareLesson[] = [
  {
    id: 'projects',
    title: 'Proyectos y pizarras',
    question: '¿Cómo empiezo mi primer diagrama?',
    keywords: 'empezar inicio crear nuevo proyecto pizarra tablero',
    where: 'Mis proyectos → Crear proyecto → Nueva pizarra',
    summary:
      'Un proyecto reúne tus pizarras y participantes. Cada pizarra contiene un diagrama independiente.',
    steps: [
      'En Mis proyectos escribe un nombre en Nuevo proyecto y pulsa Crear proyecto.',
      'Dentro del proyecto, escribe el nombre de una pizarra y pulsa Nueva pizarra.',
      'Abre la pizarra pulsando su nombre. Para volver al proyecto, usa el enlace Proyecto de la barra superior.',
    ],
    practice:
      'Prueba con un proyecto Sistema de ventas y una pizarra Ventas. Cierra esta ayuda para realizar los pasos cuando quieras.',
    tip: 'Si ya te invitaron, usa Unirme con un código en Mis proyectos. No necesitas crear otro proyecto.',
  },
  {
    id: 'diagram',
    title: 'Clases y atributos',
    question: '¿Cómo dibujo una clase y añado sus campos?',
    keywords:
      'dibujar diagrama entidad tabla campo atributo clase nombre tipo clave primaria requerido unico',
    where: 'Pizarra → Nueva clase → Propiedades',
    summary:
      'Una clase representa un concepto, como Cliente. Sus atributos describen los datos que guardarás, como nombre o correo.',
    steps: [
      'Pulsa Nueva clase. En Propiedades cambia su nombre a Cliente.',
      'En Nuevo atributo escribe nombre y pulsa Añadir. Selecciona el tipo String para texto, u otro tipo según el dato.',
      'Revisa Clave primaria, Requerido y Único según tus necesidades. Selecciona cada clase para editarla y arrástrala para organizar el diagrama.',
    ],
    practice:
      'Crea Cliente con un atributo nombre de tipo String. Añade un identificador id de tipo UUID y márcalo como Clave primaria.',
    tip: 'Herramientas y Propiedades muestran u ocultan los paneles. Tab y Enter permiten recorrer y seleccionar elementos. Los cambios se comparten automáticamente mientras estás conectado.',
  },
  {
    id: 'relationships',
    title: 'Relaciones entre clases',
    question: '¿Cómo conecto dos clases?',
    keywords:
      'conectar unir relacion asociacion herencia generalizacion composicion agregacion cardinalidad multiplicidad',
    where: 'Pizarra → Herramientas → Asociación',
    summary:
      'Las relaciones indican cómo se vinculan los conceptos. Las multiplicidades expresan cuántos elementos pueden participar en cada extremo.',
    steps: [
      'Crea las dos clases que necesitas conectar, por ejemplo Cliente y Pedido.',
      'Elige Asociación en Herramientas, pulsa la clase de origen y después la de destino.',
      'Selecciona la relación y revisa sus propiedades y multiplicidades. Usa Generalización para herencia solo cuando una clase sea una especialización de otra.',
    ],
    practice:
      'Relaciona Cliente con Pedido. Revisa si tu negocio permite varios pedidos por cliente y ajusta las multiplicidades.',
    tip: 'Vuelve a Seleccionar o pulsa Escape para salir de una herramienta. Selecciona un elemento antes de editar sus propiedades.',
  },
  {
    id: 'collaboration',
    title: 'Invitar y colaborar',
    question: '¿Cómo invito a alguien y qué puede hacer?',
    keywords:
      'invitar invitacion codigo compartir colaborar colaboracion equipo permisos rol lector editor miembro guardar guardado sincronizar conexion',
    where: 'Proyecto → Invitar al proyecto → Editor / Lector',
    summary:
      'Los participantes acceden mediante invitaciones. Un editor puede modificar; un lector puede consultar y descargar, pero no editar ni generar.',
    steps: [
      'Desde el proyecto, si tienes permisos, genera una invitación como editor o lector.',
      'Comparte el código con la persona. Ella inicia sesión y lo introduce en Unirme con un código.',
      'Abre la misma pizarra con tu equipo. Consulta el indicador En vivo y la presencia de participantes para saber si la colaboración está conectada.',
    ],
    practice:
      'Decide qué rol darías a quien solo revisará el diagrama: lector. Usa editor para quien deba modificarlo.',
    tip: 'Si ves Solo lectura, solicita permiso de edición al propietario. Si aparece Sin conexión, recupera la conexión y verifica el estado antes de salir; no supongas que tus cambios ya llegaron al servidor.',
  },
  {
    id: 'assistant',
    title: 'Trabajar con la IA',
    question: '¿Cómo le pido ayuda al asistente?',
    keywords:
      'ia inteligencia artificial asistente agente preguntar consultar instruir texto voz dictar microfono',
    where: 'Pizarra → Asistente → Aprender a usar la IA',
    summary:
      'Consultar responde preguntas sobre tu diagrama. Instruir prepara propuestas de cambios por texto o voz que tú revisas antes de aplicar.',
    steps: [
      'En Asistente elige Consultar para entender el modelo, o Instruir para solicitar un cambio concreto.',
      'Escribe la acción, la clase y sus detalles. Si usas Dictar, pulsa Parar y revisa el texto antes de Enviar.',
      'Lee la propuesta antes de Aplicar. Si no es lo que necesitas, déjala sin aplicar y corrige la solicitud. Responde a las aclaraciones cuando falte información.',
    ],
    practice:
      'Abre Aprender a usar la IA para practicar y cargar ejemplos como borradores sin enviarlos automáticamente.',
    tip: 'La guía de IA explica el proceso con más detalle. Las solicitudes reales necesitan acceso al servidor; esta ayuda no consume llamadas de IA.',
  },
  {
    id: 'import',
    title: 'Importar y exportar',
    question: '¿Cómo recupero un diagrama desde XMI o una imagen?',
    keywords:
      'importar exportar xmi png imagen foto camara archivo enterprise architect reemplazar',
    where: 'Pizarra → Importar',
    summary:
      'Puedes importar un XMI o una imagen y revisar el resultado antes de aplicarlo. Exportar XMI permite llevar el modelo a otra herramienta compatible.',
    steps: [
      'En Importar elige Añadir a lo que hay o Reemplazar el contenido según lo que quieras conservar.',
      'Usa Importar XMI o la opción de imagen/cámara. Revisa el modelo propuesto, las observaciones y los cambios antes de aplicarlos.',
      'Para exportar, pulsa Exportar XMI, revisa el nombre y selecciona el formato compatible con tu herramienta de destino.',
      'Para guardar una imagen, pulsa Exportar imagen PNG, elige el nombre y pulsa Guardar PNG. Incluye el diagrama completo con el tema actual, aunque algunas clases queden fuera de la vista. Los lectores también pueden descargarla.',
    ],
    practice:
      'Antes de reemplazar un diagrama importante, exporta su XMI. Después puedes revisar una importación y descartarla si no coincide.',
    tip: 'Reemplazar cambia el contenido actual al aplicar. El reconocimiento de imágenes puede cometer errores; comprueba nombres, tipos y relaciones.',
  },
  {
    id: 'validation',
    title: 'Corregir errores del modelo',
    question: '¿Por qué no puedo generar el proyecto?',
    keywords:
      'errores error validacion revision bloqueado generar fallo advertencia aviso clave tipos',
    where: 'Pizarra → Revisión del modelo / Propiedades',
    summary:
      'La revisión comprueba la estructura del diagrama. Los errores bloquean la generación hasta que se corrijan.',
    steps: [
      'Lee los errores y avisos de Revisión del modelo.',
      'Selecciona la clase o relación afectada. Revisa nombres, tipos, claves y multiplicidades en Propiedades según el mensaje.',
      'Vuelve a Generar cuando no haya errores. Si el botón sigue deshabilitado, comprueba también tu rol y si hay una generación en curso.',
    ],
    practice:
      'Si un mensaje pide una clave primaria, revisa el atributo identificador de esa clase y marca Clave primaria según el diseño.',
    tip: 'Resolver la validación permite generar código; también debes revisar que el diagrama represente correctamente las reglas de tu negocio.',
  },
  {
    id: 'generation',
    title: 'Generar y descargar aplicaciones',
    question: '¿Cómo descargo el backend o la aplicación Android?',
    keywords:
      'generar generacion descargar descarga backend spring java flutter android apk aplicacion zip codigo',
    where: 'Pizarra → Generar → Generar proyecto',
    summary:
      'La web genera un paquete de código desde el diagrama. Puedes incluir el backend y, opcionalmente, el proyecto Flutter Android.',
    steps: [
      'Abre Generar, revisa Paquete Java y corrige los errores del modelo que impidan continuar.',
      'Activa Incluir app Android si también necesitas la app móvil. Pulsa Generar proyecto.',
      'Al terminar, usa Descargar backend o Descargar Android + backend. Descomprime el ZIP y sigue el README incluido para ejecutar o compilar el proyecto.',
    ],
    practice:
      'Decide si necesitas solo el backend o también Android antes de generar. Cada descarga corresponde a una versión del diagrama.',
    tip: 'El ZIP Android contiene el proyecto Flutter: no es una APK lista para instalar. La APK se compila con Flutter: el ZIP trae apk.bat y apk.sh, que con Flutter instalado compilan el APK e incluso lo instalan en el teléfono por USB con una sola orden. Los lectores pueden descargar generaciones existentes. El servidor no guarda los ZIP: los vuelve a emitir desde la versión congelada del diagrama. Eliminar, en el historial, retira esa versión y la generación deja de poder descargarse; no afecta a lo que ya descargaste.',
  },
  {
    id: 'account',
    title: 'Cuenta y preferencias',
    question: '¿Dónde cambio mi perfil o cierro sesión?',
    keywords:
      'cuenta perfil foto avatar nombre contraseña password tema oscuro claro salir cerrar sesion',
    where: 'Barra superior → Menú de usuario → Mi cuenta',
    summary:
      'Desde tu cuenta puedes revisar tus datos de perfil. El selector de tema permite ajustar la apariencia de la interfaz.',
    steps: [
      'Desde Mis proyectos o un proyecto, abre el menú de tu usuario y entra en Mi cuenta.',
      'Usa los controles del perfil para cambiar tus datos, foto o contraseña. Revisa los mensajes de confirmación o error.',
      'Cambia el tema desde la barra superior. Usa Cerrar sesión en el menú, o Salir en el editor, cuando termines en un equipo compartido.',
    ],
    practice:
      'Localiza el menú de usuario y el selector de tema. No necesitas cambiar tus datos para completar esta lección.',
    tip: 'Puedes volver a abrir esta ayuda cuando la necesites. El progreso de lectura se guarda en este navegador; no certifica que hayas ejecutado las acciones.',
  },
];

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const ignoredWords = new Set([
  'a',
  'al',
  'como',
  'con',
  'de',
  'del',
  'el',
  'en',
  'es',
  'la',
  'las',
  'lo',
  'los',
  'me',
  'mi',
  'mis',
  'para',
  'por',
  'puedo',
  'que',
  'quiero',
  'se',
  'un',
  'una',
  'usar',
  'y',
]);

export function findSoftwareLessons(query: string): readonly SoftwareLesson[] {
  const words =
    normalize(query)
      .match(/[a-z0-9]+/g)
      ?.filter((word) => !ignoredWords.has(word)) ?? [];
  if (words.length === 0) return softwareLessons;
  return softwareLessons
    .map((lesson) => {
      const text = normalize(`${lesson.title} ${lesson.question} ${lesson.keywords}`);
      return { lesson, score: words.filter((word) => text.includes(word)).length };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ lesson }) => lesson);
}

export const softwareProgressKey = 'uml.software-learning.v1';

export function readSoftwareProgress(raw: string | null): readonly string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value)
      ? softwareLessons.filter((lesson) => value.includes(lesson.id)).map((lesson) => lesson.id)
      : [];
  } catch {
    return [];
  }
}
