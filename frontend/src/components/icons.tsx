/**
 * Iconografia de la plataforma.
 *
 * SVG en linea y no una libreria: el proyecto no tenia ninguna, y anadir una
 * dependencia entera —con su cadena de versiones y su peso— para dibujar quince
 * trazos no se paga. Todos heredan `currentColor` y el tamano del contexto, asi
 * que un icono dentro de un boton de peligro se pone rojo solo.
 *
 * Todos son decorativos: van junto a un texto o dentro de un boton que ya lleva
 * su nombre accesible. Por eso `aria-hidden`, y por eso ningun boton de icono
 * puede quedarse sin `aria-label`.
 */

export interface IconProps {
  readonly size?: number;
  readonly className?: string;
}

function Svg({
  size = 16,
  className,
  children,
}: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...(className === undefined ? {} : { className })}
    >
      {children}
    </svg>
  );
}

/** Proyecto: una carpeta de trabajo. */
export function IconoProyecto(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Svg>
  );
}

/** Pizarra: el marco de un diagrama. */
export function IconoPizarra(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 21h8M12 18v3" />
    </Svg>
  );
}

/** Diagrama de clases: dos cajas unidas, que es el isotipo del producto. */
export function IconoDiagrama(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="8" height="6" rx="1.5" />
      <rect x="13" y="15" width="8" height="6" rx="1.5" />
      <path d="M7 9v5a2 2 0 0 0 2 2h4" />
    </Svg>
  );
}

export function IconoMiembros(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3.25 3.25 0 0 1 0 6M17.5 14.2A5.5 5.5 0 0 1 20.5 19" />
    </Svg>
  );
}

export function IconoMas(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconoLapiz(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z" />
      <path d="M14.5 6.5 17.5 9.5" />
    </Svg>
  );
}

export function IconoPapelera(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 7h16M10 4h4M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

export function IconoInvitar(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="10" cy="8" r="3.25" />
      <path d="M4 19a6 6 0 0 1 12 0" />
      <path d="M18 8v6M15 11h6" />
    </Svg>
  );
}

export function IconoSalir(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </Svg>
  );
}

export function IconoVolver(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

export function IconoBuscar(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </Svg>
  );
}

export function IconoLlave(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M18 12v3M15.5 12v2.5" />
    </Svg>
  );
}

export function IconoChevron(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

/** IA del equipo: un destello, no un robot; colabora, no sustituye. */
export function IconoIA(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 3.5l1.6 4.4a2 2 0 0 0 1.2 1.2l4.4 1.6-4.4 1.6a2 2 0 0 0-1.2 1.2L12 18l-1.6-4.5a2 2 0 0 0-1.2-1.2L4.8 10.7l4.4-1.6a2 2 0 0 0 1.2-1.2Z" />
      <path d="M18.5 16.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z" />
    </Svg>
  );
}

export function IconoMicrofono(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </Svg>
  );
}

/** Comando de voz: ondas que actúan, distinto del micrófono de dictar. */
export function IconoOndas(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
    </Svg>
  );
}

export function IconoEnviar(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4.5 12h11M11 6.5l5.5 5.5-5.5 5.5" />
    </Svg>
  );
}

export function IconoAjustes(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Svg>
  );
}

export function IconoLibro(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5Z" />
    </Svg>
  );
}

export function IconoDetener(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </Svg>
  );
}

/** Importar: algo que entra a la pizarra. */
export function IconoImportar(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 4v10M8 10l4 4 4-4" />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}

/** Generar: código. */
export function IconoCodigo(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
    </Svg>
  );
}
