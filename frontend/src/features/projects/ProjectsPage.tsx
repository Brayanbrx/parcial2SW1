import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AppBar } from '../../components/AppBar.js';
import {
  IconoInvitar,
  IconoLlave,
  IconoMas,
  IconoMiembros,
  IconoPapelera,
  IconoPizarra,
  IconoProyecto,
  IconoLapiz,
  IconoVolver,
} from '../../components/icons.js';
import { api, type ProjectDetail, type ProjectSummary } from '../../lib/api.js';
import { useAsyncAction, useSession } from '../auth/session.js';
import { ProjectMembers } from './ProjectMembers.js';

const ROLE_LABEL = { OWNER: 'Propietario', EDITOR: 'Editor', VIEWER: 'Lector' } as const;

/** Lista de proyectos y creación (RF-001, RF-A04). */
export function ProjectsPage(): React.JSX.Element {
  const { user, logout, offline } = useSession();
  const { error, pending, run } = useAsyncAction();
  const [proyectos, setProyectos] = useState<readonly ProjectSummary[]>([]);
  const [nombre, setNombre] = useState('');
  const [codigoInvitacion, setCodigoInvitacion] = useState('');
  const navegar = useNavigate();

  const recargar = useCallback(async () => {
    setProyectos(await api.listProjects());
  }, []);

  useEffect(() => {
    if (!offline) void run(recargar);
  }, [recargar, run, offline]);

  return (
    <div className="marco">
      <AppBar displayName={user?.displayName} userId={user?.id} onLogout={() => void logout()} />

      <main className="pagina">
        <header className="encabezado-pagina">
          <div>
            <h1>Mis proyectos</h1>
            <p className="subtitulo">Tus diagramas y proyectos compartidos.</p>
          </div>
        </header>

        {/* Crear y unirse son dos cosas distintas y antes eran dos campos
            gigantes seguidos, indistinguibles. Ahora la accion principal va
            primero y unirse queda a un lado, con su propio icono. */}
        <section className="barra-acciones">
          <form
            className="accion-principal"
            onSubmit={(evento) => {
              evento.preventDefault();
              void run(async () => {
                const creado = await api.createProject(nombre.trim());
                setNombre('');
                await recargar();
                void navegar(`/proyectos/${creado.id}`);
              });
            }}
          >
            <label>
              <span>Nuevo proyecto</span>
              <input
                required
                placeholder="Sistema de ventas"
                data-testid="nombre-proyecto"
                value={nombre}
                onChange={(evento) => setNombre(evento.target.value)}
              />
            </label>
            <button
              type="submit"
              className="principal"
              disabled={pending}
              data-testid="crear-proyecto"
            >
              <IconoMas size={15} />
              {pending ? 'Creando…' : 'Crear proyecto'}
            </button>
          </form>

          <form
            className="accion-secundaria"
            onSubmit={(evento) => {
              evento.preventDefault();
              void run(async () => {
                const aceptada = await api.acceptInvite(codigoInvitacion.trim());
                setCodigoInvitacion('');
                await recargar();
                void navegar(`/proyectos/${aceptada.projectId}`);
              });
            }}
          >
            <label>
              <span>Unirme con un código</span>
              <input
                required
                placeholder="Código de invitación"
                data-testid="codigo-invitacion"
                value={codigoInvitacion}
                onChange={(evento) => setCodigoInvitacion(evento.target.value)}
              />
            </label>
            <button type="submit" disabled={pending} data-testid="aceptar-invitacion">
              <IconoLlave size={15} />
              Unirme
            </button>
          </form>
        </section>

        {error !== null && (
          <p className="aviso-error" role="alert">
            {error}
          </p>
        )}

        <ul className="rejilla-tarjetas" data-testid="lista-proyectos">
          {proyectos.length === 0 && (
            <li className="estado-vacio-panel">
              <span className="icono-vacio" aria-hidden="true">
                <IconoProyecto size={22} />
              </span>
              <h2>Aún no tienes proyectos</h2>
              <p>Crea un proyecto o únete con un código de invitación.</p>
            </li>
          )}

          {proyectos.map((proyecto) => (
            <li key={proyecto.id} className="tarjeta-recurso">
              <Link to={`/proyectos/${proyecto.id}`} className="cuerpo-tarjeta">
                <span className="icono-recurso" aria-hidden="true">
                  <IconoProyecto size={17} />
                </span>
                <strong>{proyecto.displayName}</strong>
              </Link>

              <div className="pie-tarjeta">
                <span className="dato-tarjeta">
                  <IconoPizarra size={14} />
                  {proyecto.boardCount} {proyecto.boardCount === 1 ? 'pizarra' : 'pizarras'}
                </span>
                <span className="dato-tarjeta">
                  <IconoMiembros size={14} />
                  {proyecto.memberCount} {proyecto.memberCount === 1 ? 'miembro' : 'miembros'}
                </span>
                <span className={`insignia-rol rol-${proyecto.role.toLowerCase()}`}>
                  {ROLE_LABEL[proyecto.role]}
                </span>

                {/* RF-001: solo el propietario borra, y borrar un proyecto se
                    lleva sus pizarras por delante. Por eso se confirma con el
                    nombre escrito: un dialogo de «¿seguro?» se acepta sin
                    leerlo. El boton es discreto —icono, sin relleno— porque una
                    accion destructiva no debe competir por la atencion. */}
                {proyecto.role === 'OWNER' && (
                  <button
                    type="button"
                    className="icono peligro accion-tarjeta"
                    disabled={pending}
                    data-testid={`eliminar-proyecto-${proyecto.displayName}`}
                    aria-label={`Eliminar el proyecto ${proyecto.displayName}`}
                    title="Eliminar el proyecto y todas sus pizarras"
                    onClick={() => {
                      const escrito = window.prompt(
                        `Esto elimina «${proyecto.displayName}» y sus ${proyecto.boardCount} pizarra(s), ` +
                          'para todos sus miembros. Escribe el nombre del proyecto para confirmar:',
                      );
                      if (escrito?.trim() !== proyecto.displayName) return;

                      void run(async () => {
                        await api.deleteProject(proyecto.id);
                        await recargar();
                      });
                    }}
                  >
                    <IconoPapelera size={15} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

/** Pizarras del proyecto e invitaciones (RF-002, RF-A05). */
export function ProjectPage(): React.JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  // Una ruta nueva necesita su propio estado: una respuesta o invitacion del
  // proyecto anterior no debe aparecer ni operar bajo la nueva direccion.
  return <ProjectSession key={projectId} projectId={projectId} />;
}

function ProjectSession({
  projectId,
}: {
  readonly projectId: string | undefined;
}): React.JSX.Element {
  const { user, logout, offline } = useSession();
  const { error, pending, run } = useAsyncAction();
  const [proyecto, setProyecto] = useState<ProjectDetail | null>(null);
  const [nombre, setNombre] = useState('');
  const [invitacion, setInvitacion] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    if (projectId === undefined) return;
    setProyecto(await api.getProject(projectId));
  }, [projectId]);

  useEffect(() => {
    if (!offline) void run(recargar);
  }, [recargar, run, offline]);

  if (proyecto === null) {
    return (
      <div className="marco">
        <AppBar displayName={user?.displayName} userId={user?.id} onLogout={() => void logout()} />
        <main className="centrado">
          <div className="estado-ruta" role={error === null ? 'status' : 'alert'}>
            {error === null ? (
              <>
                <div className="girando" aria-hidden="true" />
                <p>Cargando el proyecto…</p>
              </>
            ) : (
              <>
                <p>{error}</p>
                <Link to="/proyectos">Volver a mis proyectos</Link>
                <button type="button" disabled={pending} onClick={() => void run(recargar)}>
                  Reintentar
                </button>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  const puedeEscribir = proyecto.role !== 'VIEWER';

  return (
    <div className="marco">
      <AppBar displayName={user?.displayName} userId={user?.id} onLogout={() => void logout()} />

      <main className="pagina">
        <header className="encabezado-pagina">
          <Link to="/proyectos" className="volver" aria-label="Volver a mis proyectos">
            <IconoVolver size={18} />
          </Link>
          <div>
            <h1>{proyecto.displayName}</h1>
            <p className="subtitulo">
              {proyecto.boards.length} {proyecto.boards.length === 1 ? 'pizarra' : 'pizarras'} en
              este proyecto
            </p>
          </div>
          <span className={`insignia-rol rol-${proyecto.role.toLowerCase()}`}>
            {ROLE_LABEL[proyecto.role]}
          </span>
        </header>

        <section className="barra-acciones">
          <form
            className="accion-principal"
            onSubmit={(evento) => {
              evento.preventDefault();
              void run(async () => {
                await api.createBoard(proyecto.id, nombre.trim());
                setNombre('');
                await recargar();
              });
            }}
          >
            <label>
              <span>Nueva pizarra</span>
              <input
                required
                placeholder="Diagrama de clases"
                data-testid="nombre-pizarra"
                value={nombre}
                onChange={(evento) => setNombre(evento.target.value)}
                disabled={!puedeEscribir}
              />
            </label>
            <button
              type="submit"
              className="principal"
              disabled={pending || !puedeEscribir}
              data-testid="crear-pizarra"
              title={
                puedeEscribir ? 'Crear una pizarra en este proyecto' : 'Tu rol es de solo lectura'
              }
            >
              <IconoMas size={15} />
              {pending ? 'Creando…' : 'Nueva pizarra'}
            </button>
          </form>

          {proyecto.role === 'OWNER' && (
            <div className="accion-secundaria invitaciones">
              <span className="etiqueta-bloque">Invitar al proyecto</span>
              <div className="botones-invitar">
                <button
                  type="button"
                  disabled={pending}
                  data-testid="invitar-editor"
                  title="Genera un código para alguien que va a dibujar"
                  onClick={() =>
                    void run(async () => {
                      const creada = await api.createInvite(proyecto.id, 'EDITOR');
                      setInvitacion(creada.code);
                    })
                  }
                >
                  <IconoInvitar size={15} />
                  Editor
                </button>
                <button
                  type="button"
                  disabled={pending}
                  data-testid="invitar-lector"
                  title="Genera un código para alguien que solo va a mirar"
                  onClick={() =>
                    void run(async () => {
                      const creada = await api.createInvite(proyecto.id, 'VIEWER');
                      setInvitacion(creada.code);
                    })
                  }
                >
                  <IconoInvitar size={15} />
                  Lector
                </button>
              </div>
              {invitacion !== null && (
                <code className="codigo" data-testid="codigo-generado" title="Cópialo y compártelo">
                  {invitacion}
                </code>
              )}
            </div>
          )}
        </section>

        {error !== null && (
          <p className="aviso-error" role="alert">
            {error}
          </p>
        )}

        {user !== null && (
          <ProjectMembers
            key={proyecto.id}
            projectId={proyecto.id}
            userId={user.id}
            owner={proyecto.role === 'OWNER'}
            invitation={invitacion}
            onRevoke={(code) => setInvitacion((current) => (current === code ? null : current))}
            onRefresh={recargar}
          />
        )}

        <ul className="rejilla-tarjetas" data-testid="lista-pizarras">
          {proyecto.boards.length === 0 && (
            <li className="estado-vacio-panel">
              <span className="icono-vacio" aria-hidden="true">
                <IconoPizarra size={22} />
              </span>
              <h2>Este proyecto no tiene pizarras</h2>
              <p>
                {puedeEscribir
                  ? 'Crea la primera para empezar a dibujar el diagrama de clases.'
                  : 'Cuando alguien cree una, aparecerá aquí.'}
              </p>
            </li>
          )}

          {proyecto.boards.map((pizarra) => (
            <li key={pizarra.id} className="tarjeta-recurso">
              {/* El nombre accesible del enlace es exactamente el de la pizarra:
                  nada mas dentro, para que quien navega con lector de pantalla
                  oiga «Ventas, enlace» y no una frase con relleno. */}
              <Link to={`/pizarras/${pizarra.id}`} className="cuerpo-tarjeta">
                <span className="icono-recurso" aria-hidden="true">
                  <IconoPizarra size={17} />
                </span>
                <strong>{pizarra.displayName}</strong>
              </Link>

              <div className="pie-tarjeta">
                <span className="dato-tarjeta">Abrir el editor</span>

                {/* RF-003: renombrar y eliminar. Las rutas existian desde la
                    fase 3 y estaban probadas, pero no habia forma de llegar a
                    ellas desde la interfaz. */}
                {puedeEscribir && (
                  <>
                    <button
                      type="button"
                      className="icono accion-tarjeta"
                      disabled={pending}
                      title="Cambiar el nombre de la pizarra"
                      aria-label={`Renombrar la pizarra ${pizarra.displayName}`}
                      data-testid={`renombrar-${pizarra.displayName}`}
                      onClick={() => {
                        const nuevoNombre = window.prompt('Nuevo nombre', pizarra.displayName);
                        if (nuevoNombre === null || nuevoNombre.trim() === '') return;
                        if (nuevoNombre.trim() === pizarra.displayName) return;

                        void run(async () => {
                          await api.renameBoard(pizarra.id, nuevoNombre.trim());
                          await recargar();
                        });
                      }}
                    >
                      <IconoLapiz size={15} />
                    </button>
                    <button
                      type="button"
                      className="icono peligro"
                      disabled={pending}
                      title="Eliminar la pizarra y su diagrama, para todos"
                      aria-label={`Eliminar la pizarra ${pizarra.displayName}`}
                      data-testid={`eliminar-pizarra-${pizarra.displayName}`}
                      onClick={() => {
                        // El diagrama se pierde y no hay papelera. Se pide
                        // escribir el nombre en lugar de un «¿seguro?», que se
                        // acepta sin leerlo.
                        const escrito = window.prompt(
                          `Esto elimina la pizarra «${pizarra.displayName}» y su diagrama, ` +
                            'para todos. Escribe su nombre para confirmar:',
                        );
                        if (escrito?.trim() !== pizarra.displayName) return;

                        void run(async () => {
                          await api.deleteBoard(pizarra.id);
                          await recargar();
                        });
                      }}
                    >
                      <IconoPapelera size={15} />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
