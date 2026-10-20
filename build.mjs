// Builds dist/constellation.html: compiles each synth's .dsp with the Faust compiler
// (build-time only) and inlines the wasm, its metadata and the worklet code into
// web/index.html so the page runs from a single file.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p));

const SYNTHS = { ribbon35: "dsp/monotron.dsp", duo: "dsp/duo.dsp", delay: "dsp/delay.dsp" };

const synths = {};
for (const [name, dsp] of Object.entries(SYNTHS)) {
  execFileSync("npx", ["faust2wasm-ts", dsp, `build/${name}`, "-no-template"], { cwd: root, stdio: "inherit" });
  const meta = JSON.parse(read(`build/${name}/dsp-meta.json`));
  synths[name] = {
    wasm: read(`build/${name}/dsp-module.wasm`).toString("base64"),
    meta: { size: meta.size, inputs: meta.inputs, outputs: meta.outputs, ui: meta.ui },
  };
}

const assets = {
  synths,
  worklet: read("web/faust-runtime.js") + "\n" + read("web/faust-worklet.js"),
};

const page = read("web/index.html").toString()
  .replace("/*@ASSETS@*/", () => `const ASSETS = ${JSON.stringify(assets)};`);

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/constellation.html"), page);
console.log(`dist/constellation.html  ${(page.length / 1024).toFixed(1)} KB`);

// The same page as a complete document to open straight from disk. Outside the
// Claude viewer it can use Web MIDI and saves recordings as plain .wav files.
const standalone = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
${page}
</body></html>
`;
writeFileSync(join(root, "dist/constellation-standalone.html"), standalone);
console.log(`dist/constellation-standalone.html  ${(standalone.length / 1024).toFixed(1)} KB`);
