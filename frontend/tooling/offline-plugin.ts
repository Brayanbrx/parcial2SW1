import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Precache a complete production build, including the lazy editor and fonts. */
export function offlinePlugin(): Plugin {
  let publicDir: string;
  return {
    name: 'uml-offline-shell',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((file) =>
        /\.(?:html|js|css|woff2?|ttf|svg|png)$/.test(file),
      );
      const hash = createHash('sha256');
      for (const file of files.sort()) {
        const item = bundle[file]!;
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      for (const entry of readdirSync(publicDir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const absolute = resolve(entry.parentPath, entry.name);
        const relative = absolute.slice(publicDir.length + 1).replaceAll('\\', '/');
        files.push(relative);
        hash.update(readFileSync(absolute));
      }
      const template = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
      const version = hash.update(template).digest('hex').slice(0, 20);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('= __CACHE_NAME__;', `= ${JSON.stringify(`uml-shell-v1-${version}`)};`)
          .replace('= __ASSETS__;', `= ${JSON.stringify(files.map((file) => `/${file}`))};`),
      });
    },
  };
}
