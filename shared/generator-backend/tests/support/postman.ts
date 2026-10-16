import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

/** Execute the exported requests AND their Postman scripts against the real Java API. */
export async function verifyPostman(baseUrl: string, source: string): Promise<void> {
  const collection = JSON.parse(source) as {
    variable: { key: string; value: string }[];
    item: {
      name: string;
      request: { method: string; url: string; body?: { raw: string } };
      event: { script: { exec: string[] } }[];
    }[];
  };
  const values = new Map(collection.variable.map((v) => [v.key, v.value]));
  values.set('baseUrl', baseUrl);
  const resolve = (input: string): string =>
    input.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      assert.ok(values.has(key), `Variable Postman no definida: ${key}`);
      return values.get(key)!;
    });
  for (const item of collection.item) {
    const response = await fetch(resolve(item.request.url), {
      method: item.request.method,
      ...(item.request.body
        ? { headers: { 'content-type': 'application/json' }, body: resolve(item.request.body.raw) }
        : {}),
    });
    const raw = await response.text();
    const pm = {
      test: (name: string, test: () => void) => {
        try {
          test();
        } catch (error) {
          throw new Error(`${item.name}: ${name}: ${raw}`, { cause: error });
        }
      },
      response: {
        code: response.status,
        json: () => JSON.parse(raw) as unknown,
        to: {
          have: { status: (code: number) => assert.equal(response.status, code) },
          be: {
            get json() {
              assert.match(response.headers.get('content-type') ?? '', /json/);
              return true;
            },
          },
        },
      },
      expect: (value: unknown) => ({
        to: { not: { equal: (other: unknown) => assert.notEqual(value, other) } },
      }),
      collectionVariables: { set: (key: string, value: string) => values.set(key, value) },
    };
    for (const event of item.event)
      runInNewContext(event.script.exec.join('\n'), { pm }, { timeout: 1000 });
  }
}
