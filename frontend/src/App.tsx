import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { lazy, Suspense, useLayoutEffect } from 'react';
import { LoginPage } from './features/auth/LoginPage.js';
import { ProfilePage } from './features/auth/ProfilePage.js';
import { ResetPage } from './features/auth/ResetPage.js';
import { VerificationPage } from './features/auth/VerificationPage.js';
import { SessionProvider, useSession } from './features/auth/session.js';
import { ProjectPage, ProjectsPage } from './features/projects/ProjectsPage.js';
import { InteractiveTourProvider } from './features/help/InteractiveTour.js';
import { OfflineBoardsPage } from './features/editor/OfflineBoardsPage.js';

const BoardPage = lazy(async () => {
  const { BoardPage } = await import('./features/editor/BoardPage.js');
  return { default: BoardPage };
});

export function App(): React.JSX.Element {
  return (
    <SessionProvider>
      <BrowserRouter>
        <InteractiveTourProvider>
          <Suspense
            fallback={
              <main className="centrado" role="status">
                Cargando la aplicación…
              </main>
            }
          >
            <Rutas />
          </Suspense>
        </InteractiveTourProvider>
      </BrowserRouter>
    </SessionProvider>
  );
}

function Rutas(): React.JSX.Element {
  const { user, loading, offline } = useSession();
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    // Cada pantalla comienza por su cabecera, aunque la anterior estuviera
    // desplazada (por ejemplo al abrir una pizarra desde un teléfono).
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  // Sin esta espera, una recarga con sesion viva mandaria al usuario al login
  // durante el instante que tarda la renovacion, y perderia la ruta que tenia.
  if (loading) {
    return (
      <main className="centrado">
        {/* `role="status"` para que un lector de pantalla anuncie la espera:
            de otro modo la pagina se queda muda hasta que aparece algo. */}
        <div className="estado-ruta" role="status">
          <div className="girando" aria-hidden="true" />
          <p>Restaurando tu sesión…</p>
        </div>
      </main>
    );
  }

  if (user === null) {
    return (
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/activar" element={<VerificationPage />} />
        {/* Restablecer se llega desde el correo, sin sesion: tiene que existir
            tambien para quien no ha entrado. */}
        <Route path="/restablecer" element={<ResetPage />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    );
  }

  return (
    <>
      {offline && !pathname.startsWith('/pizarras/') && pathname !== '/sin-conexion' && (
        <p className="advertencia banda" role="status" data-testid="aviso-sin-conexion">
          Sin conexión. Conservamos lo que estás escribiendo; espera a reconectar para enviarlo.{' '}
          <Link to="/sin-conexion">Ver pizarras guardadas</Link>
        </p>
      )}
      <Routes>
        <Route path="/proyectos" element={<ProjectsPage />} />
        <Route path="/cuenta" element={<ProfilePage />} />
        <Route path="/activar" element={<VerificationPage />} />
        <Route path="/restablecer" element={<ResetPage />} />
        <Route path="/proyectos/:projectId" element={<ProjectPage />} />
        <Route path="/pizarras/:boardId" element={<BoardPage />} />
        <Route path="/sin-conexion" element={<OfflineBoardsPage />} />
        <Route path="*" element={<Navigate to="/proyectos" replace />} />
      </Routes>
    </>
  );
}
