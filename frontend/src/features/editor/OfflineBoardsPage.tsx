import { Link } from 'react-router';
import { AppBar } from '../../components/AppBar.js';
import { cachedBoards } from '../../lib/offline.js';
import { useSession } from '../auth/session.js';

export function OfflineBoardsPage(): React.JSX.Element {
  const { user, logout } = useSession();
  const boards = user === null ? [] : cachedBoards(user.id);
  return (
    <div className="marco">
      <AppBar displayName={user?.displayName} userId={user?.id} onLogout={() => void logout()} />
      <main className="pagina">
        <header className="encabezado-pagina">
          <div>
            <h1>Pizarras sin conexión</h1>
            <p className="subtitulo">
              Puedes abrir las pizarras guardadas en este navegador. Los cambios se sincronizarán
              cuando vuelvas a conectarte.
            </p>
          </div>
        </header>
        <ul className="rejilla-tarjetas" data-testid="pizarras-offline">
          {boards.map((board) => (
            <li key={board.id} className="estado-vacio-panel">
              <Link to={`/pizarras/${board.id}`}>{board.displayName}</Link>
              <p>{board.role === 'VIEWER' ? 'Solo lectura' : 'Edición local disponible'}</p>
            </li>
          ))}
        </ul>
        {boards.length === 0 && (
          <p>
            No hay pizarras guardadas para esta cuenta. Abre una pizarra con conexión para que esté
            disponible aquí.
          </p>
        )}
        <p>
          Crear proyectos, administrar miembros y usar el asistente o la generación requiere
          conexión.
        </p>
      </main>
    </div>
  );
}
