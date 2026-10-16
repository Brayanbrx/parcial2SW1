import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { IconoDiagrama } from '../../components/icons.js';
import { perfil } from '../../lib/api.js';
import { useAsyncAction, useSession } from './session.js';

/**
 * Elegir una contrasena nueva desde el enlace del correo (RF-A11).
 *
 * El testigo llega en la direccion. No se guarda en ningun sitio ni se muestra:
 * se usa una vez y el servidor lo consume.
 */
export function ResetPage(): React.JSX.Element {
  const [parametros] = useSearchParams();
  const navegar = useNavigate();
  const { error, pending, run } = useAsyncAction();
  const { logout } = useSession();

  const token = parametros.get('token') ?? '';
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [hecho, setHecho] = useState(false);

  const noCoinciden = repetida !== '' && nueva !== repetida;

  if (token === '') {
    return (
      <main className="centrado">
        <div className="estado-ruta" role="alert">
          <h1>Ese enlace está incompleto</h1>
          <p>Falta el código de recuperación. Pide uno nuevo desde la pantalla de acceso.</p>
          <Link to="/entrar">Volver a entrar</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="acceso-formulario acceso-suelto">
      <div className="tarjeta">
        <div className="acceso-titulo">
          <span className="isotipo" aria-hidden="true">
            <IconoDiagrama size={16} />
          </span>
          <h1>Elige una contraseña nueva</h1>
          <p className="subtitulo">
            Al guardarla se cerrarán todas las sesiones abiertas de esta cuenta.
          </p>
        </div>

        {hecho ? (
          <>
            <p className="aviso-ok" role="status" data-testid="password-restablecida">
              Contraseña actualizada. Ya puedes entrar con ella.
            </p>
            <button
              type="button"
              className="principal"
              onClick={() => void navegar('/entrar')}
              data-testid="ir-a-entrar"
            >
              Ir a entrar
            </button>
          </>
        ) : (
          <form
            className="formulario-perfil"
            onSubmit={(evento) => {
              evento.preventDefault();
              void run(async () => {
                await perfil.restablecer(token, nueva);
                // El servidor revoca los refrescos; React tambien debe dejar de
                // tratar la sesion anterior como activa al volver a /entrar.
                await logout();
                setHecho(true);
              });
            }}
          >
            <label>
              <span>Contraseña nueva</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                data-testid="nueva-password"
                value={nueva}
                onChange={(evento) => setNueva(evento.target.value)}
              />
              <span className="ayuda">Al menos 8 caracteres.</span>
            </label>

            <label>
              <span>Repítela</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                data-testid="repetir-password"
                aria-invalid={noCoinciden}
                value={repetida}
                onChange={(evento) => setRepetida(evento.target.value)}
              />
              {noCoinciden && <span className="ayuda error">Las dos no coinciden.</span>}
            </label>

            {error !== null && (
              <p className="aviso-error" role="alert" data-testid="error-restablecer">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="principal"
              disabled={pending || noCoinciden || nueva === ''}
              data-testid="guardar-password"
            >
              {pending ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </form>
        )}

        <Link to="/entrar" className="enlace-discreto">
          Volver a entrar
        </Link>
      </div>
    </main>
  );
}
