import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { avatarUrl } from '../lib/api.js';
import { ThemeSelect } from './ThemeProvider.js';
import { SoftwareGuide } from '../features/help/SoftwareGuide.js';
import { IconoChevron, IconoDiagrama, IconoSalir, IconoProyecto } from './icons.js';

/**
 * Barra superior de las pantallas administrativas.
 *
 * Es presentacional: recibe el usuario y la funcion de salir, y no sabe de
 * donde vienen. La sesion se sigue gestionando exactamente donde se gestionaba.
 *
 * «Salir» pasa al menu del usuario porque antes era un boton permanente al lado
 * del titulo, con el mismo peso visual que las acciones que uno si usa a
 * menudo. Cerrar sesion se hace una vez al dia.
 */
export function AppBar({
  displayName,
  userId,
  avatarVersion = 0,
  onLogout,
}: {
  readonly displayName: string | undefined;
  /** Para la foto de perfil. Sin el, el avatar son las iniciales. */
  readonly userId?: string | undefined;
  /**
   * Cambia cuando la persona sube o quita su foto.
   *
   * Sin esto la barra se queda con lo que decidio al montarse: si no habia
   * foto, el avatar cayo a las iniciales y no vuelve a mirar. Cambiar el
   * numero fuerza otra peticion y remonta el componente.
   */
  readonly avatarVersion?: number;
  onLogout(): void;
}): React.JSX.Element {
  return (
    <header className="app-bar">
      <Link to="/proyectos" className="marca" aria-label="UMLFORGE AI, ir a mis proyectos">
        <span className="isotipo" aria-hidden="true">
          <IconoDiagrama size={18} />
        </span>
        <span className="nombre-producto">UMLFORGE AI</span>
      </Link>

      <div className="separa" />
      <SoftwareGuide />
      <ThemeSelect />

      <MenuUsuario
        displayName={displayName}
        userId={userId}
        avatarVersion={avatarVersion}
        onLogout={onLogout}
      />
    </header>
  );
}

/**
 * Menu del usuario.
 *
 * Se cierra al pulsar fuera y con Escape, y devuelve el foco al disparador:
 * un menu que se queda abierto detras de otra cosa, o que deja el foco
 * perdido, es peor que no tenerlo.
 */
function MenuUsuario({
  displayName,
  userId,
  avatarVersion,
  onLogout,
}: {
  readonly displayName: string | undefined;
  readonly userId?: string | undefined;
  readonly avatarVersion: number;
  onLogout(): void;
}): React.JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const disparador = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto) return;

    const alPulsarFuera = (evento: MouseEvent): void => {
      if (!contenedor.current?.contains(evento.target as Node)) setAbierto(false);
    };
    const alTeclear = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      setAbierto(false);
      disparador.current?.focus();
    };

    document.addEventListener('mousedown', alPulsarFuera);
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('mousedown', alPulsarFuera);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto]);

  const nombre = displayName ?? '';

  return (
    <div className="menu-usuario" ref={contenedor}>
      <button
        type="button"
        ref={disparador}
        className="fantasma disparador-usuario"
        aria-haspopup="menu"
        aria-expanded={abierto}
        data-testid="menu-usuario"
        onClick={() => setAbierto((previo) => !previo)}
      >
        {/* La clave remonta el avatar cuando la foto cambia: es lo que hace
            que deje de mostrar las iniciales en cuanto hay una. */}
        <Avatar key={avatarVersion} nombre={nombre} userId={userId} version={avatarVersion} />
        <span className="nombre-usuario">{nombre}</span>
        <IconoChevron size={14} />
      </button>

      {abierto && (
        <div className="desplegable" role="menu">
          <p className="cabecera-desplegable">
            <span className="titulo">{nombre}</span>
            <span className="meta">Sesión iniciada</span>
          </p>
          <Link
            to="/cuenta"
            role="menuitem"
            className="opcion-desplegable enlace-menu"
            data-testid="mi-cuenta"
            onClick={() => setAbierto(false)}
          >
            <IconoProyecto size={15} />
            Mi cuenta
          </Link>

          <button
            type="button"
            role="menuitem"
            className="fantasma opcion-desplegable"
            data-testid="salir"
            onClick={() => {
              setAbierto(false);
              onLogout();
            }}
          >
            <IconoSalir size={15} />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

/** Iniciales sobre un color derivado del nombre: estable entre recargas. */
export function Avatar({
  nombre,
  userId,
  version = 0,
  size = 28,
}: {
  readonly nombre: string;
  readonly userId?: string | undefined;
  readonly version?: number;
  readonly size?: number;
}): React.JSX.Element {
  const iniciales = nombre.trim().slice(0, 2).toUpperCase() || '?';
  const matiz = [...nombre].reduce((total, letra) => total + letra.charCodeAt(0), 0) % 360;
  // Si la persona no tiene foto la ruta responde 404 y se vuelve a las
  // iniciales, en lugar de dejar el icono de imagen rota.
  const [sinFoto, setSinFoto] = useState(false);

  if (userId !== undefined && !sinFoto) {
    return (
      <img
        className="avatar"
        src={avatarUrl(userId, version)}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        onError={() => setSinFoto(true)}
      />
    );
  }

  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: `oklch(0.55 0.13 ${matiz})`,
        fontSize: size * 0.4,
      }}
    >
      {iniciales}
    </span>
  );
}
