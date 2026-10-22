import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { releaseContent } from "./releases.ts";
const root = import.meta.dirname;
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const releases = releaseContent(resolve(root, "../docs/releases"), JSON.parse(readFileSync(resolve(root, "../package.json"), "utf8")).version);
export default defineConfig({
  root,
  define: { __QUICKLOGIN_WEBSITE_RELEASE__: JSON.stringify(`${JSON.parse(readFileSync(resolve(root, "../package.json"), "utf8")).version}+${sourceCommit}`) },
  appType: "mpa",
  plugins: [
    {
      name: "release-notes",
      transformIndexHtml(html) { return html.replace("<!-- release-entries -->", releases.html); },
      generateBundle() { this.emitFile({ type: "asset", fileName: "changelog/rss.xml", source: releases.rss }); },
      configureServer(server) {
        server.middlewares.use("/changelog/rss.xml", (_request, response) => {
          response.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
          response.end(releases.rss);
        });
      },
    },
    {
      name: "static-page-partials",
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          return html.replace(/<!-- (header|footer) -->/g, (_, name: string) =>
            readFileSync(resolve(root, `${name}.html`), "utf8"),
          );
        },
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(
        [
          "index",
          "popup-preview",
          "download/index",
          "faq/index",
          "privacy/index",
          "changelog/index",
          "404",
        ].map((page) => [
          page.replace("/index", ""),
          resolve(root, `${page}.html`),
        ]),
      ),
    },
  },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
