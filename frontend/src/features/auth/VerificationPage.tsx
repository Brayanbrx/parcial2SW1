import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { verification } from '../../lib/api.js';
import { useAsyncAction } from './session.js';

export function VerificationPage(): React.JSX.Element {
  const location = useLocation();
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  const [done, setDone] = useState(false);
  const { error, pending, run } = useAsyncAction();

  return (
    <main className="acceso-formulario acceso-suelto">
      <div className="tarjeta">
        <div className="acceso-titulo">
          <h1>{done ? 'Cuenta activada' : 'Activa tu cuenta'}</h1>
          <p className="subtitulo">
            {done
              ? 'Tu correo está confirmado. Ya puedes iniciar sesión.'
              : 'Confirma tu correo para comenzar a crear tus diagramas.'}
          </p>
        </div>
        {done ? (
          <p className="aviso-ok" role="status" data-testid="cuenta-activada">
            Tu cuenta está lista.
          </p>
        ) : token ? (
          <button
            className="principal"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                await verification.confirm(token);
                setDone(true);
                window.history.replaceState(null, '', location.pathname);
              })
            }
          >
            {pending ? 'Activando…' : 'Activar mi cuenta'}
          </button>
        ) : (
          <p className="aviso-error" role="alert">
            Falta el código de activación. Abre el enlace completo del correo o solicita uno nuevo.
          </p>
        )}
        {error && (
          <p className="aviso-error" role="alert">
            {error}
          </p>
        )}
        {!done && <ResendVerification />}
        <Link to="/entrar">Ir a iniciar sesión</Link>
      </div>
    </main>
  );
}

export function ResendVerification(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { error, pending, run } = useAsyncAction();
  return (
    <form
      className="formulario-perfil"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          setSent(false);
          await verification.resend(email);
          setSent(true);
        });
      }}
    >
      <label>
        <span>Correo de tu cuenta</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setSent(false);
          }}
        />
      </label>
      <button className="secundario" disabled={pending}>
        {pending ? 'Solicitando…' : 'Reenviar enlace de activación'}
      </button>
      {sent && (
        <p className="aviso-ok" role="status">
          Si tu cuenta está pendiente, recibirás un enlace. Revisa también spam. Espera un minuto
          antes de volver a solicitarlo.
        </p>
      )}
      {error && (
        <p className="aviso-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
