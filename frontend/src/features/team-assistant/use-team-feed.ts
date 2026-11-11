import { useEffect, useRef, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { apiRequest, ContractMismatchError, type ProjectMember } from '../../lib/api.js';
import { connectTeamFeed } from './connect-feed.js';
import type { TeamFeedSnapshot } from './transport.js';

const empty: TeamFeedSnapshot = {
  messages: [],
  proposals: [],
  settings: null,
  initialMessageIds: null,
};
export function useTeamFeed(
  boardId: string,
  projectId: string,
  userId: string,
  provider: HocuspocusProvider | null,
  visible: boolean,
) {
  const [snapshot, setSnapshot] = useState(empty);
  const [members, setMembers] = useState<readonly ProjectMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const connection = useRef<ReturnType<typeof connectTeamFeed> | null>(null);
  const visibility = useRef(visible);
  visibility.current = visible;
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const known = new Set<string>();
    let membersLoading = false;
    const loadMembers = async () => {
      if (membersLoading) return;
      membersLoading = true;
      try {
        const rows = await apiRequest<ProjectMember[]>(`/projects/${projectId}/members`, {
          signal: controller.signal,
        });
        if (!alive) return;
        rows.forEach((member) => known.add(member.id));
        setMembers(rows);
      } catch {
        /* El feed conserva identificadores cuando el directorio no está disponible. */
      } finally {
        membersLoading = false;
      }
    };
    setLoading(true);
    setSnapshot(empty);
    const feed = connectTeamFeed({
      boardId,
      projectId,
      panelVisible: visibility.current,
      onChange(next) {
        if (!alive) return;
        setSnapshot(next);
        setLoading(false);
        setError(null);
        setStale(false);
        if (
          next.messages.some((m) =>
            [m.authorId, m.addressedToId].some((id) => id && !known.has(id)),
          )
        )
          void loadMembers();
      },
      onError(cause) {
        if (!alive) return;
        setLoading(false);
        setStale(cause instanceof ContractMismatchError);
        setError(cause instanceof Error ? cause.message : 'No se pudo recuperar la actividad.');
      },
    });
    connection.current = feed;
    void loadMembers();
    return () => {
      alive = false;
      controller.abort();
      feed.stop();
      connection.current = null;
    };
  }, [boardId, projectId, userId]);
  useEffect(() => {
    const event = ({ payload }: { payload: string }) => connection.current?.acceptEvent(payload);
    const synced = () => {
      void connection.current?.refresh();
    };
    provider?.on('stateless', event);
    provider?.on('synced', synced);
    if (provider?.synced) synced();
    return () => {
      provider?.off('stateless', event);
      provider?.off('synced', synced);
    };
  }, [provider]);
  useEffect(() => {
    connection.current?.setPanelVisible(visible);
  }, [visible]);
  return {
    snapshot,
    members,
    error,
    stale,
    loading,
    refresh: () => connection.current?.refresh() ?? Promise.resolve(),
    async refreshSnapshot() {
      const feed = connection.current;
      await feed?.refresh(true);
      return feed?.snapshot() ?? empty;
    },
    retry: () => connection.current?.retry() ?? Promise.resolve(),
  };
}
