import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { IconoDiagrama } from '../../components/icons.js';
import { ThemeSelect } from '../../components/ThemeProvider.js';
import { perfil } from '../../lib/api.js';
import { useAsyncAction, useSession } from './session.js';

/** Registro e inicio de sesión en una sola pantalla (RF-A01 y RF-A02). */
export function LoginPage(): React.JSX.Element {
  const { login, register } = useSession();
  const navegar = useNavigate();
  const { error, pending, run } = useAsyncAction();

  // «olvide» es un tercer modo del mismo formulario y no una ruta aparte: el
  // correo ya esta escrito, y mandar a otra pagina obligaria a teclearlo otra vez.
  const [modo, setModo] = useState<'entrar' | 'registrar' | 'olvide'>('entrar');
  const [enviado, setEnviado] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  // Solo cambia el `type` del campo. La contrasena y su envio no se tocan.
  const [verPassword, setVerPassword] = useState(false);
  const [activacion, setActivacion] = useState<string | null>(null);

  return (
    <main className="acceso">
      <div className="acceso-apariencia">
        <ThemeSelect />
      </div>
      {/* Mitad izquierda: quien llega por un enlace no sabe que es esto.
          El dibujo son dos clases y su relacion —lo que la herramienta hace—
          no una ilustracion decorativa. */}
      <section className="acceso-marca" aria-hidden="true">
        <div className="acceso-marca-contenido">
          <span className="isotipo grande">
            <IconoDiagrama size={26} />
          </span>
          <h2>UMLFORGE AI</h2>
          <p className="lema">Diagramas de clases en equipo.</p>
          <p className="acceso-detalle">
            Edita diagramas UML, comparte pizarras y genera un proyecto Java a partir del modelo.
          </p>

          <DiagramaDecorativo />
        </div>
      </section>

      <section className="acceso-formulario">
        <form
          className="tarjeta"
          onSubmit={(evento) => {
            evento.preventDefault();
            void run(async () => {
              if (modo === 'olvide') {
                await perfil.pedirRecuperacion(email);
                // Se confirma el envio siempre, haya cuenta o no: el servidor
                // responde igual en los dos casos a proposito, y contarlo aqui
                // convertiria el formulario en un comprobador de correos.
                setEnviado(true);
                return;
              }

              if (modo === 'entrar') await login(email, password);
              else {
                const result = await register(email, displayName, password);
                setActivacion(
                  result.emailSent
                    ? `Revisa tu correo ${email}. Te enviamos un enlace para activar la cuenta; caduca en 24 horas. Revisa también spam.`
                    : 'Tu cuenta está creada, pero no pudimos enviar el correo. Solicita otro enlace de activación.',
                );
                setPassword('');
                setModo('entrar');
                return;
              }
              void navegar('/proyectos');
            });
          }}
        >
          <div className="acceso-titulo">
            <h1>
              {modo === 'entrar'
                ? 'Bienvenido de nuevo'
                : modo === 'registrar'
                  ? 'Crea tu cuenta'
                  : 'Recupera tu acceso'}
            </h1>
            <p className="subtitulo">
              {modo === 'entrar'
                ? 'Entra para seguir con tus diagramas.'
                : modo === 'registrar'
                  ? 'Te enviaremos un enlace para activar tu cuenta.'
                  : 'Te enviamos un enlace para elegir una contraseña nueva.'}
            </p>
          </div>

          <div className="pestanas" role="group" aria-label="Entrar o crear una cuenta">
            <button
              type="button"
              className={modo === 'entrar' ? 'activa' : ''}
              aria-pressed={modo === 'entrar'}
              onClick={() => {
                setModo('entrar');
                setEnviado(false);
              }}
            >
              Entrar
            </button>
            <button
              type="button"
              className={modo === 'registrar' ? 'activa' : ''}
              aria-pressed={modo === 'registrar'}
              onClick={() => {
                setModo('registrar');
                setEnviado(false);
              }}
            >
              Crear cuenta
            </button>
          </div>

          <label>
            <span>Correo</span>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="tu@correo.com"
              data-testid="email"
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
            />
          </label>

          {modo === 'registrar' && (
            <label>
              <span>Nombre</span>
              <input
                required
                placeholder="Cómo te verán los demás"
                data-testid="displayName"
                value={displayName}
                onChange={(evento) => setDisplayName(evento.target.value)}
              />
            </label>
          )}

          {modo !== 'olvide' && (
            <label>
              <span>Contraseña</span>
              <span className="campo-con-accion">
                <input
                  type={verPassword ? 'text' : 'password'}
                  required
                  minLength={modo === 'registrar' ? 8 : 1}
                  autoComplete={modo === 'registrar' ? 'new-password' : 'current-password'}
                  data-testid="password"
                  aria-describedby={modo === 'registrar' ? 'ayuda-password' : undefined}
                  value={password}
                  onChange={(evento) => setPassword(evento.target.value)}
                />
                <button
                  type="button"
                  className="fantasma ver-password"
                  aria-pressed={verPassword}
                  aria-label={verPassword ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                  onClick={() => setVerPassword((previo) => !previo)}
                >
                  {verPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </span>
              {modo === 'registrar' && (
                <span className="ayuda" id="ayuda-password">
                  Al menos 8 caracteres.
                </span>
              )}
            </label>
          )}

          {error !== null && (
            <p className="aviso-error" role="alert" data-testid="error-sesion">
              {error}
            </p>
          )}

          {activacion && (
            <p className="aviso-ok" role="status" data-testid="activacion-pendiente">
              {activacion}
            </p>
          )}
          <Link to="/activar" className="enlace-discreto">
            ¿No recibiste el enlace de activación?
          </Link>

          {enviado && (
            <p className="aviso-ok" role="status" data-testid="recuperacion-enviada">
              Si existe una cuenta con ese correo, recibirás un enlace para cambiar la contraseña.
            </p>
          )}

          <button type="submit" className="principal" disabled={pending} data-testid="enviar">
            {pending
              ? 'Un momento…'
              : modo === 'entrar'
                ? 'Entrar'
                : modo === 'registrar'
                  ? 'Crear cuenta'
                  : 'Enviarme el enlace'}
          </button>

          {modo === 'entrar' ? (
            <button
              type="button"
              className="fantasma enlace-discreto"
              data-testid="olvide-password"
              onClick={() => {
                setModo('olvide');
                setEnviado(false);
              }}
            >
              ¿Olvidaste tu contraseña?
            </button>
          ) : modo === 'olvide' ? (
            <button
              type="button"
              className="fantasma enlace-discreto"
              onClick={() => {
                setModo('entrar');
                setEnviado(false);
              }}
            >
              Volver a entrar
            </button>
          ) : null}
        </form>
      </section>
    </main>
  );
}

/**
 * Dos clases y una relacion, dibujadas con la misma retorica del editor.
 *
 * Decorativo: no representa ningun modelo real y no lleva texto que un lector
 * de pantalla deba anunciar. Lo envuelve un `aria-hidden` mas arriba.
 */
function DiagramaDecorativo(): React.JSX.Element {
  return (
    <svg className="acceso-diagrama" viewBox="0 0 320 180" fill="none" focusable="false">
      <path d="M96 52h60" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" />
      <path d="M156 52v60h-52" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" />

      <g className="caja">
        <rect x="16" y="24" width="80" height="56" rx="8" />
        <path d="M16 42h80" />
        <path d="M28 56h34M28 68h46" strokeWidth="1.5" />
      </g>

      <g className="caja">
        <rect x="156" y="24" width="88" height="56" rx="8" />
        <path d="M156 42h88" />
        <path d="M168 56h40M168 68h30" strokeWidth="1.5" />
      </g>

      <g className="caja">
        <rect x="60" y="112" width="96" height="52" rx="8" />
        <path d="M60 130h96" />
        <path d="M72 144h50" strokeWidth="1.5" />
      </g>
    </svg>
  );
}
