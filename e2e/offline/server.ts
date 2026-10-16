// Isolated browser-test fixture. Never imported by the application or deployment.
import { Server } from '@hocuspocus/server';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { seedDocument } from '@uml/yjs-adapter';
import * as Y from 'yjs';

const root = resolve('frontend/dist');
const users = {
  ana: { id: '00000000-0000-4000-8000-000000000001', email: 'ana@example.com', displayName: 'Ana' },
  beto: {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'beto@example.com',
    displayName: 'Beto',
  },
};
const boards = ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011'];
const roles = new Map<string, string>();
const sessions = new Set<string>();
const saved = new Map<string, Uint8Array>();
const server = new Server({
  address: '127.0.0.1',
  port: 4187,
  quiet: true,
  debounce: 0,
  async onAuthenticate(data) {
    if (!sessions.has(data.token) || roles.get(data.token) === 'NONE')
      throw new Error('sin-acceso-a-la-pizarra');
    data.connectionConfig.readOnly = roles.get(data.token) === 'VIEWER';
    return { userId: data.token };
  },
  async onStateless({ connection }) {
    const role = roles.get(connection.context.userId as string);
    if (role === undefined || role === 'NONE') return;
    const readOnly = role === 'VIEWER';
    if (connection.readOnly !== readOnly) {
      connection.readOnly = readOnly;
      connection.sendStateless(JSON.stringify({ type: 'access-changed', readOnly }));
    }
  },
  async onLoadDocument({ document, documentName }) {
    const state = saved.get(documentName);
    if (state) Y.applyUpdate(document, state);
    else seedDocument(document);
  },
  async onStoreDocument({ document, documentName }) {
    saved.set(documentName, Y.encodeStateAsUpdate(document));
  },
  async onRequest({ request, response }) {
    const url = new URL(request.url ?? '/', 'http://localhost:4187');
    const cookieId = /offline-test-session=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
    // Como en producción: la cookie solo renueva o cierra la sesión. Los datos
    // requieren acceso Bearer para ejercitar también la renovación tras un 401.
    const token = ['/api/auth/refresh', '/api/auth/logout'].includes(url.pathname)
      ? cookieId
      : request.headers.authorization?.replace('Bearer ', '');
    const user = Object.values(users).find((item) => item.id === token);
    const json = (value: unknown, status = 200): void => {
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(value));
    };
    if (url.pathname === '/test/reset') {
      roles.clear();
      sessions.clear();
      saved.clear();
      for (const item of Object.values(users)) roles.set(item.id, 'EDITOR');
      json({ ok: true });
    } else if (url.pathname === '/test/role') {
      roles.set(url.searchParams.get('id') ?? '', url.searchParams.get('role') ?? 'VIEWER');
      json({ ok: true });
    } else if (url.pathname === '/test/expire') {
      sessions.delete(url.searchParams.get('id') ?? '');
      json({ ok: true });
    } else if (url.pathname === '/test/close') {
      // Así cierra el proceso real cuando caduca el token de acceso: la sala se
      // cierra con un motivo, sin tocar la sesión ni los permisos.
      const reason = url.searchParams.get('reason') ?? 'token-invalido';
      for (const document of server.hocuspocus.documents.values())
        for (const connection of document.getConnections())
          connection.close({ code: reason === 'token-invalido' ? 4401 : 4403, reason });
      json({ ok: true });
    } else if (url.pathname === '/api/auth/login') {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const input = JSON.parse(body) as { email: string };
      const account = Object.values(users).find((item) => item.email === input.email)!;
      sessions.add(account.id);
      response.setHeader(
        'set-cookie',
        `offline-test-session=${account.id}; HttpOnly; SameSite=Lax; Path=/`,
      );
      json({ accessToken: account.id, user: account });
    } else if (url.pathname === '/api/auth/logout') {
      if (token) sessions.delete(token);
      response.setHeader('set-cookie', 'offline-test-session=; Max-Age=0; Path=/');
      json({ ok: true });
    } else if (url.pathname.startsWith('/api/')) {
      if (!user || !token || !sessions.has(token))
        json({ error: { code: 'unauthorized', message: 'Sesión expirada' } }, 401);
      else if (url.pathname === '/api/auth/refresh') json({ accessToken: user.id, user });
      else if (url.pathname === '/api/auth/me') json(user);
      else if (url.pathname === '/api/projects') json([]);
      else if (/^\/api\/boards\/[^/]+$/.test(url.pathname)) {
        const id = url.pathname.split('/').pop()!;
        if (roles.get(token) === 'NONE') json({ error: { message: 'Sin acceso' } }, 403);
        else if (!boards.includes(id)) json({ error: { message: 'No existe' } }, 404);
        else
          json({
            id,
            projectId: 'project',
            displayName: `Pizarra ${boards.indexOf(id) + 1}`,
            room: id,
            role: roles.get(token),
          });
      } else if (url.pathname.endsWith('/audit')) json({ batchId: 'test' });
      else json([]);
    } else {
      const path = url.pathname === '/' || !extname(url.pathname) ? '/index.html' : url.pathname;
      const file = resolve(root, `.${path}`);
      if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) {
        response.writeHead(404);
        response.end();
      } else {
        const types: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.ttf': 'font/ttf',
        };
        try {
          const bytes = await readFile(file);
          response.writeHead(200, {
            'content-type': types[extname(file)] ?? 'application/octet-stream',
            'cache-control': 'no-cache',
          });
          response.end(bytes);
        } catch {
          response.writeHead(404);
          response.end();
        }
      }
    }
    // Hocuspocus's default HTTP handler must not write a second response.
    throw null;
  },
});
await server.listen();
