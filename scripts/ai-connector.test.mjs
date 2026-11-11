/* global Response, AbortController, EventTarget, Event, MessageEvent, queueMicrotask */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { writeFile, stat } from 'node:fs/promises';
import { serverUrl, inferOllama, inferVm, runConnection } from './ai-connector.mjs';

const task = {
  type: 'task',
  id: '00000000-0000-4000-8000-000000000001',
  model: 'modelo',
  system: 'Política UML',
  prompt: 'Crea Persona; $(echo secreto)',
  json: true,
  timeoutMs: 30000,
};
test('acepta HTTPS y localhost, rechaza destinos ambiguos y HTTP remoto', () => {
  assert.equal(serverUrl('https://uml.example.com'), 'https://uml.example.com');
  assert.equal(serverUrl('http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
  for (const url of [
    'http://public.example.com',
    'https://user:secret@example.com',
    'https://example.com/?secret=x',
    'https://example.com/path',
    'file:///tmp/a',
  ])
    assert.throws(() => serverUrl(url));
});
test('Ollama recibe el contexto anunciado y rechaza respuestas cortadas', async () => {
  const previous = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        done: true,
        done_reason: 'stop',
        message: { content: '{"operations":[]}' },
      }),
    );
  };
  try {
    assert.equal(await inferOllama(task), '{"operations":[]}');
    assert.equal(body.options.num_ctx, 16384);
    assert.equal(body.format, 'json');
    assert.equal(body.messages[1].content, task.prompt);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ done: true, done_reason: 'length', message: { content: 'incompleta' } }),
      );
    await assert.rejects(inferOllama(task), /completa/);
    await assert.rejects(
      inferOllama(task, undefined, 'https://another.example.com'),
      /esta computadora/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});
test('IA de VM usa stdin y argumentos fijos, sin shell, conserva el modelo y elimina archivos temporales', async () => {
  let captured;
  const spawnProcess = (executable, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    let prompt = '';
    child.stdin.on('data', (chunk) => {
      prompt += chunk.toString();
    });
    child.stdin.on('finish', () => {
      captured = { executable, args, options, prompt };
      const output = args[args.indexOf('--output-last-message') + 1];
      void writeFile(output, JSON.stringify({ answer: '{"operations":[]}' })).then(() =>
        child.emit('exit', 0),
      );
    });
    return child;
  };
  assert.equal(
    await inferVm(task, new AbortController().signal, {
      executable: '/usr/local/bin/codex',
      spawnProcess,
    }),
    '{"operations":[]}',
  );
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.windowsHide, true);
  assert.equal(captured.args.at(-1), '-');
  assert.equal(captured.args.includes(task.prompt), false);
  assert.equal(captured.args[captured.args.indexOf('--model') + 1], task.model);
  assert.equal(captured.args.includes('--ignore-user-config'), true);
  assert.equal(captured.args.includes('shell_tool'), true);
  assert.match(captured.prompt, /Crea Persona/);
  await assert.rejects(stat(captured.options.cwd), { code: 'ENOENT' });
});
test('una cancelación previa nunca inicia un proceso de IA de VM', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    inferVm(task, controller.signal, {
      spawnProcess: () => {
        assert.fail('no debe iniciar');
      },
    }),
  );
});
test('cancelar una tarea libera su lugar y una respuesta vieja no afecta la siguiente', async () => {
  let socket;
  class FakeWebSocket extends EventTarget {
    readyState = 1;
    sent = [];
    constructor(_url) {
      super();
      socket = this; // eslint-disable-line @typescript-eslint/no-this-alias
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
    receive(message) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
    }
  }
  const active = [];
  const running = runConnection({
    url: 'https://uml.example.com',
    token: 'x'.repeat(64),
    kind: 'VM',
    models: [{ name: 'modelo', contextWindow: 16384 }],
    concurrency: 1,
    WebSocketClass: FakeWebSocket,
    log() {},
    infer: (_input, signal) => new Promise((resolve) => active.push({ signal, resolve })),
  });
  await new Promise((done) => queueMicrotask(done));
  assert.equal(socket.sent[0].type, 'hello');
  socket.receive({ type: 'ready' });
  socket.receive(task);
  assert.equal(active.length, 1);
  socket.receive({ type: 'cancel', id: task.id });
  assert.equal(active[0].signal.aborted, true);
  const next = { ...task, id: '00000000-0000-4000-8000-000000000002' };
  socket.receive(next);
  assert.equal(active.length, 2);
  active[0].resolve('tardía');
  active[1].resolve('correcta');
  await new Promise((done) => queueMicrotask(done));
  assert.deepEqual(
    socket.sent.filter((message) => message.type === 'result'),
    [{ type: 'result', id: next.id, text: 'correcta' }],
  );
  socket.close();
  await running;
});
