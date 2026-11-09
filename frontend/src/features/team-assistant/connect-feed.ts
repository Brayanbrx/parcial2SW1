import type { HocuspocusProvider } from '@hocuspocus/provider';
import { teamAiApi } from '../../lib/api.js';
import { createTeamFeedTransport, type TeamFeedSnapshot } from './transport.js';

/** El panel monta esta conexión y llama stop al desmontarse/cambiar de cuenta. */
export function connectTeamFeed(options: {
  boardId: string;
  projectId: string;
  provider?: HocuspocusProvider;
  panelVisible: boolean;
  onChange: (snapshot: TeamFeedSnapshot) => void;
  onError: (error: unknown) => void;
}) {
  const transport = createTeamFeedTransport({
    ...options,
    loadPage: (cursor, signal) => teamAiApi.changes(options.boardId, cursor, signal),
    loadSettings: (signal) => teamAiApi.settings(options.projectId, signal),
  });
  let panelVisible = options.panelVisible;
  const visibility = () =>
    transport.setVisible(panelVisible && document.visibilityState === 'visible');
  const stateless = ({ payload }: { payload: string }) => transport.acceptEvent(payload);
  const reconnect = () => {
    void transport.refresh(true);
  };
  options.provider?.on('stateless', stateless);
  options.provider?.on('synced', reconnect);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('online', reconnect);
  visibility();
  // Con el panel oculto se carga una vez el historial: es la referencia para
  // contar como nuevo solo lo que llegue después. No inicia ningún sondeo.
  if (!panelVisible || document.visibilityState !== 'visible') void transport.refresh(true);
  return {
    acceptEvent: transport.acceptEvent,
    refresh: transport.refresh,
    retry: transport.retry,
    setPanelVisible(value: boolean) {
      panelVisible = value;
      visibility();
    },
    stop() {
      transport.stop();
      options.provider?.off('stateless', stateless);
      options.provider?.off('synced', reconnect);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', reconnect);
    },
  };
}
