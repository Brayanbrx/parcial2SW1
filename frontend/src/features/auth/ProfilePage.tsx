import { useRef, useState } from 'react';
import { AppBar, Avatar } from '../../components/AppBar.js';
import { IconoLapiz, IconoLlave, IconoPapelera } from '../../components/icons.js';
import { avatarUrl, perfil } from '../../lib/api.js';
import { useAsyncAction, useSession } from './session.js';

/**
 * Perfil de la cuenta (RF-A10).
 *
 * Tres bloques independientes, cada uno con su propio envio y su propio aviso:
 * la foto, los datos y la contrasena. Separados porque fallan por motivos
 * distintos —una imagen demasiado grande no tiene nada que ver con una
 * contrasena mal escrita— y juntarlos obligaria a un solo mensaje de error que
 * no diria cual de las tres cosas se atasco.
 */
export function ProfilePage(): React.JSX.Element {
  const { user, logout, actualizarUsuario } = useSession();
  // Vive aqui y no dentro del bloque de la foto porque la barra superior
  // tambien lo necesita: al subir una foto tiene que dejar de mostrar las
  // iniciales sin recargar la pagina.
  const [avatarVersion, setAvatarVersion] = useState(() => Date.now());

  if (user === null) {
    return (
      <div className="marco">
        <main className="centrado">
          <div className="estado-ruta" role="status">
            <div className="girando" aria-hidden="true" />
            <p>Cargando tu perfil…</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="marco">
      <AppBar
        displayName={user.displayName}
        userId={user.id}
        avatarVersion={avatarVersion}
        onLogout={() => void logout()}
      />

      <main className="pagina pagina-estrecha">
        <header className="encabezado-pagina">
          <div>
            <h1>Mi cuenta</h1>
            <p className="subtitulo">Tu foto, tus datos y tu contraseña.</p>
          </div>
        </header>

        <BloqueFoto
          userId={user.id}
          displayName={user.displayName}
          version={avatarVersion}
          onCambio={setAvatarVersion}
        />

        <BloqueDatos
          displayName={user.displayName}
          email={user.email}
          onGuardado={actualizarUsuario}
        />

        <BloquePassword />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Foto
// ---------------------------------------------------------------------------

function BloqueFoto({
  userId,
  displayName,
  version,
  onCambio,
}: {
  readonly userId: string;
  readonly displayName: string;
  /** Cambia al subir o quitar: obliga al navegador a volver a pedir la imagen. */
  readonly version: number;
  onCambio(version: number): void;
}): React.JSX.Element {
  const { error, pending, run } = useAsyncAction();
  const [tieneFoto, setTieneFoto] = useState(true);
  const archivo = useRef<HTMLInputElement>(null);

  return (
    <section className="panel-perfil">
      <div className="cabecera-panel">
        <h2>Foto de perfil</h2>
        <p className="subtitulo">Se recorta a 256×256 antes de enviarse.</p>
      </div>

      <div className="fila-foto">
        {tieneFoto ? (
          <img
            className="avatar avatar-grande"
            src={avatarUrl(userId, version)}
            alt=""
            width={72}
            height={72}
            // Si no hay foto la ruta responde 404: en lugar de dejar el icono
            // de imagen rota, se cae a las iniciales.
            onError={() => setTieneFoto(false)}
          />
        ) : (
          <Avatar nombre={displayName} size={72} />
        )}

        <div className="acciones-foto">
          <button
            type="button"
            disabled={pending}
            data-testid="elegir-foto"
            onClick={() => archivo.current?.click()}
          >
            <IconoLapiz size={15} />
            {pending ? 'Subiendo…' : 'Cambiar foto'}
          </button>

          {tieneFoto && (
            <button
              type="button"
              className="peligro"
              disabled={pending}
              data-testid="quitar-foto"
              onClick={() =>
                void run(async () => {
                  await perfil.quitarAvatar();
                  setTieneFoto(false);
                  onCambio(Date.now());
                })
              }
            >
              <IconoPapelera size={15} />
              Quitar
            </button>
          )}

          <p className="ayuda">JPG, PNG o WebP.</p>
        </div>
      </div>

      <input
        ref={archivo}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        data-testid="archivo-foto"
        onChange={(evento) => {
          const elegido = evento.target.files?.[0];
          evento.target.value = '';
          if (elegido === undefined) return;

          void run(async () => {
            const recortada = await recortar(elegido);
            await perfil.subirAvatar(recortada.base64, recortada.mediaType);
            setTieneFoto(true);
            onCambio(Date.now());
          });
        }}
      />

      {error !== null && (
        <p className="aviso-error" role="alert" data-testid="error-foto">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * Recorta la imagen a un cuadrado de 256x256 y la reencoda como JPEG.
 *
 * Se hace en el navegador y no en el servidor por dos razones: una foto de
 * telefono son varios megabytes y no tiene sentido subirlos para tirarlos, y el
 * servidor no tiene una biblioteca de imagenes —anadirla por esto seria una
 * dependencia nativa entera—.
 *
 * El recorte es central, que es lo que espera quien sube un retrato.
 */
async function recortar(archivo: File): Promise<{ base64: string; mediaType: string }> {
  const LADO = 256;
  const imagen = await cargarImagen(archivo);

  const lienzo = document.createElement('canvas');
  lienzo.width = LADO;
  lienzo.height = LADO;

  const contexto = lienzo.getContext('2d');
  if (contexto === null) throw new Error('El navegador no pudo procesar la imagen.');

  const lado = Math.min(imagen.width, imagen.height);
  contexto.drawImage(
    imagen,
    (imagen.width - lado) / 2,
    (imagen.height - lado) / 2,
    lado,
    lado,
    0,
    0,
    LADO,
    LADO,
  );

  // 0.85: por encima el archivo crece sin que la diferencia se vea a 72 pixeles.
  const url = lienzo.toDataURL('image/jpeg', 0.85);
  return { base64: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg' };
}

function cargarImagen(archivo: File): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const imagen = new Image();

    imagen.onload = () => {
      URL.revokeObjectURL(url);
      resolver(imagen);
    };
    imagen.onerror = () => {
      URL.revokeObjectURL(url);
      rechazar(new Error('Ese archivo no es una imagen que el navegador pueda abrir.'));
    };

    imagen.src = url;
  });
}

// ---------------------------------------------------------------------------
// Datos basicos
// ---------------------------------------------------------------------------

function BloqueDatos({
  displayName,
  email,
  onGuardado,
}: {
  readonly displayName: string;
  readonly email: string;
  onGuardado(usuario: { id: string; email: string; displayName: string }): void;
}): React.JSX.Element {
  const { error, pending, run } = useAsyncAction();
  const [nombre, setNombre] = useState(displayName);
  const [guardado, setGuardado] = useState(false);

  return (
    <section className="panel-perfil">
      <div className="cabecera-panel">
        <h2>Datos</h2>
        <p className="subtitulo">El nombre es el que ven los demás en las pizarras.</p>
      </div>

      <form
        className="formulario-perfil"
        onSubmit={(evento) => {
          evento.preventDefault();
          setGuardado(false);
          void run(async () => {
            onGuardado(await perfil.actualizar(nombre.trim()));
            setGuardado(true);
          });
        }}
      >
        <label>
          <span>Nombre</span>
          <input
            required
            maxLength={120}
            data-testid="perfil-nombre"
            value={nombre}
            onChange={(evento) => {
              setNombre(evento.target.value);
              setGuardado(false);
            }}
          />
        </label>

        <label>
          <span>Correo</span>
          {/* De solo lectura: es la identidad de la cuenta y la direccion a la
              que llega la recuperacion. Cambiarlo sin verificar el buzon nuevo
              permitiria apropiarse de una cuenta. */}
          <input type="email" value={email} readOnly disabled data-testid="perfil-correo" />
          <span className="ayuda">El correo no se puede cambiar.</span>
        </label>

        <div className="acciones-formulario">
          <button
            type="submit"
            className="principal"
            disabled={pending || nombre.trim() === ''}
            data-testid="guardar-perfil"
          >
            {pending ? 'Guardando…' : 'Guardar cambios'}
          </button>
          {guardado && (
            <span className="aviso-ok" role="status" data-testid="perfil-guardado">
              Datos actualizados.
            </span>
          )}
        </div>
      </form>

      {error !== null && (
        <p className="aviso-error" role="alert" data-testid="error-perfil">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Contrasena
// ---------------------------------------------------------------------------

function BloquePassword(): React.JSX.Element {
  const { error, pending, run } = useAsyncAction();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [hecho, setHecho] = useState(false);

  const noCoinciden = repetida !== '' && nueva !== repetida;

  return (
    <section className="panel-perfil">
      <div className="cabecera-panel">
        <h2>Contraseña</h2>
        <p className="subtitulo">
          Al cambiarla se cierran las demás sesiones. La de esta pestaña sigue abierta.
        </p>
      </div>

      <form
        className="formulario-perfil"
        onSubmit={(evento) => {
          evento.preventDefault();
          setHecho(false);
          void run(async () => {
            await perfil.cambiarPassword(actual, nueva);
            setActual('');
            setNueva('');
            setRepetida('');
            setHecho(true);
          });
        }}
      >
        <label>
          <span>Contraseña actual</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            data-testid="password-actual"
            value={actual}
            onChange={(evento) => setActual(evento.target.value)}
          />
        </label>

        <label>
          <span>Contraseña nueva</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            data-testid="password-nueva"
            value={nueva}
            onChange={(evento) => setNueva(evento.target.value)}
          />
          <span className="ayuda">Al menos 8 caracteres.</span>
        </label>

        <label>
          <span>Repite la nueva</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            data-testid="password-repetida"
            aria-invalid={noCoinciden}
            value={repetida}
            onChange={(evento) => setRepetida(evento.target.value)}
          />
          {/* Se comprueba aqui y no en el servidor: la repeticion existe para
              atrapar una errata al teclear, no es un dato que el backend
              necesite. */}
          {noCoinciden && <span className="ayuda error">Las dos no coinciden.</span>}
        </label>

        <div className="acciones-formulario">
          <button
            type="submit"
            className="principal"
            disabled={pending || noCoinciden || nueva === ''}
            data-testid="cambiar-password"
          >
            <IconoLlave size={15} />
            {pending ? 'Cambiando…' : 'Cambiar contraseña'}
          </button>
          {hecho && (
            <span className="aviso-ok" role="status" data-testid="password-cambiada">
              Contraseña actualizada.
            </span>
          )}
        </div>
      </form>

      {error !== null && (
        <p className="aviso-error" role="alert" data-testid="error-password">
          {error}
        </p>
      )}
    </section>
  );
}
