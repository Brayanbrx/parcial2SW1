import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { IconoChevron } from '../../components/icons.js';
import { api, ApiError, type ProjectMember, type ProjectInvite } from '../../lib/api.js';

export function ProjectMembers({
  projectId,
  userId,
  owner,
  invitation,
  onRefresh,
  onRevoke,
}: {
  projectId: string;
  userId: string;
  owner: boolean;
  invitation: string | null;
  onRefresh(): Promise<void>;
  onRevoke(code: string): void;
}): React.JSX.Element {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (invitation !== null) setExpanded(true);
  }, [invitation]);
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    const [users, links] = await Promise.all([
      api.listMembers(projectId),
      owner ? api.listInvites(projectId) : Promise.resolve([]),
    ]);
    setMembers(users);
    setInvites(links);
    setLoaded(true);
  }, [projectId, owner]);
  useEffect(() => {
    let active = true;
    let running = false;
    const load = async (): Promise<void> => {
      if (running) return;
      running = true;
      try {
        await refresh();
        if (active) setError(null);
      } catch (cause) {
        if (active && cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) {
          navigate('/proyectos', { replace: true });
          return;
        }
        if (active)
          setError(cause instanceof Error ? cause.message : 'No se pudo cargar la colaboración.');
      } finally {
        running = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load();
        void onRefresh().catch(() => undefined);
      }
    }, 5000);
    const focus = (): void => {
      void load();
      void onRefresh().catch(() => undefined);
    };
    window.addEventListener('focus', focus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh, invitation, onRefresh, navigate]);
  async function change(action: () => Promise<unknown>, message: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
      await onRefresh();
      setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="colaboradores-proyecto"
      aria-labelledby="colaboradores-titulo"
      data-testid="miembros-proyecto"
    >
      <h2 id="colaboradores-titulo">
        <button
          type="button"
          className="resumen-colaboradores"
          data-testid="alternar-colaboradores"
          aria-expanded={expanded}
          aria-controls="detalle-colaboradores"
          onClick={() => setExpanded((value) => !value)}
        >
          <span>Colaboradores</span>
          {loaded && (
            <span className="conteo-colaboradores">
              {members.length} {members.length === 1 ? 'miembro' : 'miembros'}
              {owner &&
                invites.length > 0 &&
                ` · ${invites.length} ${invites.length === 1 ? 'invitación' : 'invitaciones'}`}
            </span>
          )}
          <span className="flecha-colaboradores" aria-hidden="true">
            <IconoChevron size={16} />
          </span>
        </button>
      </h2>
      {error !== null && (
        <p role="alert" className="aviso-error">
          {error}
        </p>
      )}
      {notice !== null && <p role="status">{notice}</p>}
      <div id="detalle-colaboradores" className="detalle-colaboradores" hidden={!expanded}>
        <p className="pista">
          Editores: pueden modificar las pizarras. Lectores: pueden verlas y exportarlas.
        </p>
        {!loaded && error === null && <p role="status">Cargando participantes…</p>}
        <ul className="lista-colaboradores">
          {members.map((member) => (
            <li key={member.id} data-testid={`miembro-${member.id}`}>
              <span>
                <strong>
                  {member.displayName}
                  {member.id === userId ? ' (tú)' : ''}
                </strong>
                <small>{member.email}</small>
              </span>
              {owner && member.role !== 'OWNER' ? (
                <>
                  <select
                    aria-label={`Rol de ${member.email}`}
                    value={member.role}
                    disabled={busy}
                    onChange={(e) =>
                      void change(
                        () =>
                          api.changeMemberRole(
                            projectId,
                            member.id,
                            e.target.value as 'EDITOR' | 'VIEWER',
                          ),
                        'Permiso actualizado.',
                      )
                    }
                  >
                    <option value="EDITOR">Editor</option>
                    <option value="VIEWER">Lector</option>
                  </select>
                  <button
                    type="button"
                    className="peligro"
                    disabled={busy}
                    aria-label={`Retirar a ${member.email}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `¿Retirar a ${member.displayName} del proyecto? Perderá acceso a todas sus pizarras.`,
                        )
                      )
                        void change(
                          () => api.removeMember(projectId, member.id),
                          'Participante retirado.',
                        );
                    }}
                  >
                    Retirar
                  </button>
                </>
              ) : (
                <span className="insignia-rol">
                  {member.role === 'OWNER'
                    ? 'Propietario'
                    : member.role === 'EDITOR'
                      ? 'Editor'
                      : 'Lector'}
                </span>
              )}
            </li>
          ))}
        </ul>
        {!owner && (
          <button
            type="button"
            className="peligro"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm('¿Salir de este proyecto? Necesitarás otra invitación para volver.')
              ) {
                setBusy(true);
                void api
                  .removeMember(projectId, userId)
                  .then(() => navigate('/proyectos'))
                  .catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : 'No se pudo salir.');
                    setBusy(false);
                  });
              }
            }}
          >
            Salir del proyecto
          </button>
        )}
        {owner && (
          <>
            <h3>Invitaciones</h3>
            {invites.length > 0 && (
              <p className="pista">
                Revocar un código impide que se unan más personas. Los miembros actuales conservan
                su acceso.
              </p>
            )}
            {loaded && invites.length === 0 && <p>No hay invitaciones activas.</p>}
            <ul className="lista-colaboradores">
              {invites.map((invite) => (
                <li key={invite.id}>
                  <span>
                    <code>{invite.code}</code>
                    <small>
                      {invite.role === 'EDITOR' ? 'Editor' : 'Lector'} ·{' '}
                      {new Date(invite.expiresAt).getTime() <= Date.now()
                        ? 'Caducada'
                        : `Vence ${new Date(invite.expiresAt).toLocaleString()}`}
                    </small>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Revocar invitación ${invite.code}`}
                    onClick={() =>
                      void change(async () => {
                        await api.revokeInvite(projectId, invite.id);
                        onRevoke(invite.code);
                      }, 'Invitación revocada.')
                    }
                  >
                    Revocar
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
