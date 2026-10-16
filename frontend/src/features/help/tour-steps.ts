export type TourKind = 'projects' | 'project' | 'board' | 'account';
export interface TourStep {
  readonly id: string;
  readonly target: string;
  readonly title: string;
  readonly text: string;
  readonly action?: 'input' | 'click';
  readonly reveal?: readonly string[];
  readonly unavailable?: string;
}

export const tours: Record<TourKind, { title: string; steps: readonly TourStep[] }> = {
  projects: {
    title: 'Tu primer proyecto',
    steps: [
      {
        id: 'name',
        target: 'nombre-proyecto',
        title: 'Ponle nombre a tu proyecto',
        text: 'Escribe un nombre, por ejemplo Sistema de ventas. Aquí reunirás sus diagramas y participantes.',
        action: 'input',
      },
      {
        id: 'create',
        target: 'crear-proyecto',
        title: 'Crea el espacio de trabajo',
        text: 'Pulsa Crear proyecto cuando el nombre esté listo. Entrarás al proyecto y continuaremos con tu primera pizarra.',
        action: 'click',
      },
      {
        id: 'list',
        target: 'lista-proyectos',
        title: 'O abre un proyecto existente',
        text: 'Pulsa el nombre del proyecto en el que quieras trabajar. El recorrido seguirá en esa pantalla.',
      },
      {
        id: 'join',
        target: 'codigo-invitacion',
        title: 'También puedes unirte a un equipo',
        text: 'Si alguien te pasó un código, escríbelo aquí y pulsa Unirme. El código determina tu permiso como editor o lector.',
      },
    ],
  },
  project: {
    title: 'Prepara tu pizarra',
    steps: [
      {
        id: 'name',
        target: 'nombre-pizarra',
        title: 'Nombra tu diagrama',
        text: 'Escribe el nombre de tu pizarra. Un proyecto puede contener varios diagramas independientes.',
        action: 'input',
      },
      {
        id: 'create',
        target: 'crear-pizarra',
        title: 'Añade la pizarra',
        text: 'Pulsa Nueva pizarra. Cuando aparezca en la lista, podrás abrirla para empezar a dibujar.',
        action: 'click',
      },
      {
        id: 'open',
        target: 'lista-pizarras',
        title: 'Entra al editor',
        text: 'Pulsa el nombre de una pizarra. Te acompañaré por las herramientas del editor.',
      },
      {
        id: 'invite',
        target: 'invitar-editor',
        title: 'Invita a tu equipo',
        text: 'Editor genera un código para quienes modificarán el diagrama. Lector es para quienes solo revisarán. Comparte el código que generes.',
        unavailable:
          'Las invitaciones las administra el propietario. Puedes omitir este paso si tu rol no permite invitar.',
      },
    ],
  },
  board: {
    title: 'Aprende en tu diagrama',
    steps: [
      {
        id: 'create',
        target: 'crear-clase',
        title: 'Añade tu primera clase',
        text: 'Pulsa Nueva clase para crear una entidad real en esta pizarra. Si ya tienes clases, selecciona una y omite este paso.',
        action: 'click',
      },
      {
        id: 'name',
        target: 'nombre-clase',
        title: 'Dale un nombre que describa el concepto',
        text: 'Escribe Cliente, Producto u otro concepto de tu sistema. Las propiedades se actualizan al editar.',
        action: 'input',
        reveal: ['alternar-panel'],
        unavailable: 'Selecciona una clase del diagrama para ver su nombre y sus propiedades.',
      },
      {
        id: 'attribute',
        target: 'nuevo-atributo',
        title: 'Describe sus datos',
        text: 'Escribe el nombre de un atributo, por ejemplo correo, y pulsa Añadir. Después podrás elegir su tipo y marcar si es requerido, único o clave primaria.',
        action: 'input',
        reveal: ['alternar-panel'],
        unavailable: 'Selecciona una clase para añadir o revisar sus atributos.',
      },
      {
        id: 'relationships',
        target: 'tool-association',
        title: 'Conecta tus conceptos',
        text: 'Elige Asociación y pulsa la clase de origen y luego la de destino. Selecciona la línea para revisar sus multiplicidades. Necesitas dos clases para conectarlas.',
        reveal: ['alternar-toolbox'],
      },
      {
        id: 'validation',
        target: 'panel-validacion',
        title: 'Revisa el modelo antes de generar',
        text: 'Aquí aparecen errores y avisos del diagrama. Selecciona el elemento afectado y corrige sus propiedades. Los errores bloquean la generación.',
        reveal: ['alternar-panel'],
      },
      {
        id: 'assistant',
        target: 'entrada-asistente',
        title: 'Pide ayuda con tus palabras',
        text: 'En Consultar puedes preguntar sobre el diagrama. En Instruir, escribe un cambio concreto; Enviar prepara una propuesta que debes revisar antes de Aplicar.',
        reveal: ['alternar-panel', 'pestana-asistente'],
      },
      {
        id: 'import',
        target: 'modo-importacion',
        title: 'Recupera trabajo que ya tienes',
        text: 'Elige Añadir a lo que hay o Reemplazar el contenido antes de importar XMI o una imagen. Revisa la propuesta antes de aplicarla. Exportar XMI te permite conservar una copia.',
        reveal: ['alternar-panel', 'pestana-importar'],
      },
      {
        id: 'generation',
        target: 'incluir-flutter',
        title: 'Elige lo que vas a construir',
        text: 'Activa esta opción si también necesitas el proyecto Flutter Android. Sin ella generarás el backend. El ZIP contiene código; la APK se compila con apk.bat o apk.sh desde su raíz (Flutter instalado), que también la instalan en el teléfono por USB.',
        reveal: ['alternar-panel', 'pestana-generar'],
      },
      {
        id: 'download',
        target: 'generar',
        title: 'Genera cuando estés listo',
        text: 'Pulsa Generar proyecto cuando tu modelo esté listo. Al terminar aparecerán las descargas. Si el botón está bloqueado, revisa errores y permisos; puedes finalizar este recorrido sin generar.',
        reveal: ['alternar-panel', 'pestana-generar'],
      },
    ],
  },
  account: {
    title: 'Tu cuenta',
    steps: [
      {
        id: 'profile',
        target: 'perfil-nombre',
        title: 'Tu identidad en el equipo',
        text: 'Aquí puedes editar tu nombre de perfil. Guarda el cambio solo cuando quieras actualizarlo.',
      },
      {
        id: 'photo',
        target: 'elegir-foto',
        title: 'Personaliza tu perfil',
        text: 'Este control permite elegir una foto. Puedes conservar la actual y pasar al siguiente paso.',
      },
      {
        id: 'password',
        target: 'password-actual',
        title: 'Actualiza tu contraseña',
        text: 'Para cambiarla, introduce la actual y repite la nueva en los campos correspondientes. El recorrido no necesita que escribas ninguna contraseña.',
      },
    ],
  },
};

export function tourForPath(path: string): TourKind | null {
  if (path === '/proyectos') return 'projects';
  if (/^\/proyectos\/[^/]+$/.test(path)) return 'project';
  if (/^\/pizarras\/[^/]+$/.test(path)) return 'board';
  return path === '/cuenta' ? 'account' : null;
}

export const tourProgressKey = 'uml.interactive-tour.v1';
export function readTourStep(raw: string | null, kind: TourKind): number {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (
      value &&
      typeof value === 'object' &&
      'kind' in value &&
      'step' in value &&
      value.kind === kind
    ) {
      return tours[kind].steps.findIndex((step) => step.id === value.step);
    }
  } catch {
    /* Reading the guide is possible without storage. */
  }
  return -1;
}
