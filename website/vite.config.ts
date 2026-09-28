import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const root = import.meta.dirname;
export default defineConfig({
  root, appType: 'mpa',
  plugins: [{ name: 'static-page-partials', transformIndexHtml: { order: 'pre', handler(html) {
    return html.replace(/<!-- (header|footer) -->/g, (_, name: string) => readFileSync(resolve(root, `${name}.html`), 'utf8'));
  } } }],
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: Object.fromEntries(['index', 'download/index', 'faq/index', 'privacy/index', 'changelog/index', '404'].map(page => [page.replace('/index', ''), resolve(root, `${page}.html`)])) } },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
});
