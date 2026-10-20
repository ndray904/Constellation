// Builds dist/constellation.html: compiles each synth's .dsp with the Faust compiler
// and each Airwindows reverb's unmodified C++ with clang (both build-time only),
// and inlines the wasm, its metadata and the worklet code into web/index.html so
// the page runs from a single file.
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

// ---- Airwindows reverbs (Nebula): C++ -> wasm32 with clang, no libc ----------
// airwindows/src holds the plugins' LinuxVST sources unmodified; airwindows/shim
// stands in for the VST SDK, libm (Math.* imported from JS) and a tiny runtime.
const REVERBS = ["Galactic3", "Infinity", "StarChild2"];
const mathEnv = Object.fromEntries(["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "exp", "log", "log10", "pow"]
  .map((f) => [f, Math[f]]).concat([["fmod", (a, b) => a % b]]));
const reverbs = [];
mkdirSync(join(root, "build/airwindows"), { recursive: true });
for (const name of REVERBS) {
  const out = `build/airwindows/${name}.wasm`;
  execFileSync("clang++", [
    "--target=wasm32", "-O3", "-std=c++17", "-ffreestanding", "-nostdlib", "-nostdinc++",
    "-fno-exceptions", "-fno-rtti", "-mnontrapping-fptoint", "-mbulk-memory", "-w",
    "-I", "airwindows/shim", "-I", `airwindows/src/${name}`, `-DAW_HEADER="${name}.h"`, `-DAW_CLASS=${name}`,
    `airwindows/src/${name}/${name}.cpp`, `airwindows/src/${name}/${name}Proc.cpp`,
    "airwindows/shim/wrapper.cpp", "airwindows/shim/longdouble.cpp",
    "-Wl,--no-entry", "-Wl,--export-memory", "-Wl,--strip-all", "-o", out,
  ], { cwd: root, stdio: "inherit" });
  // read the parameter names and defaults from the plugin itself
  const bytes = read(out);
  const x = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: mathEnv }).exports;
  x.init(48000);
  const cstr = (ptr) => { const m = new Uint8Array(x.memory.buffer); let s = ""; while (m[ptr]) s += String.fromCharCode(m[ptr++]); return s; };
  const params = [];
  for (let i = 0; i < x.numParams(); i++) params.push({ name: cstr(x.paramName(i)), value: x.getParam(i) });
  reverbs.push({ name, wasm: bytes.toString("base64"), params });
  console.log(`${out}  ${(bytes.length / 1024).toFixed(1)} KB  ${params.map((p) => p.name).join(", ")}`);
}

const assets = {
  synths,
  reverbs,
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
