import { build, defineConfig } from "vite";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CONTRACT_DIGEST, PROTOCOL_VERSION } from "./src/shared/protocol-v3.generated.ts";

const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const packageVersion=JSON.parse(readFileSync(new URL("./package.json",import.meta.url),"utf8")).version;

export default defineConfig({
  define:{ __QUICKLOGIN_BUILD_ID__:JSON.stringify(sourceCommit) },
  plugins:[{
    name: "quicklogin-content-script",
    async generateBundle() {
      // Manifest content scripts cannot import shared ES chunks from the popup.
      const result = await build({
        configFile: false,
        publicDir: false,
        logLevel: "warn",
        build: {
          write: false,
          lib: { entry: resolve(import.meta.dirname, "src/content/index.ts"), name: "QuickLoginContent", formats: ["iife"] },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const files = outputs.flatMap(output => "output" in output ? output.output : []);
      const chunk = files[0];
      if (files.length !== 1 || !chunk || chunk.type !== "chunk" || !chunk.isEntry ||
          chunk.imports.length || chunk.dynamicImports.length) {
        throw new Error("Content script must bundle into one self-contained classic script");
      }
      this.emitFile({ type: "asset", fileName: "content.js", source: chunk.code });
    },
  },{name:"quicklogin-provenance",generateBundle(){
    this.emitFile({type:"asset",fileName:"build-info.json",source:JSON.stringify({
      extensionVersion:packageVersion,sourceCommit,protocolVersion:PROTOCOL_VERSION,contractDigest:CONTRACT_DIGEST,
    },null,2)+"\n"});
  }}],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, "src/background/index.ts"),
        popup: resolve(import.meta.dirname, "popup.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
