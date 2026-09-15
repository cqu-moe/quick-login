import { defineConfig } from "vite";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CONTRACT_DIGEST, PROTOCOL_VERSION } from "./src/shared/protocol-v3.generated.ts";

const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const packageVersion=JSON.parse(readFileSync(new URL("./package.json",import.meta.url),"utf8")).version;

export default defineConfig({
  define:{ __QUICKLOGIN_BUILD_ID__:JSON.stringify(sourceCommit) },
  plugins:[{name:"quicklogin-provenance",generateBundle(){
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
        content: resolve(import.meta.dirname, "src/content/index.ts"),
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
