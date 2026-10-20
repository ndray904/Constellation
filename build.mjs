// Builds dist/constellation.html: compiles each synth's .dsp with the Faust compiler
// and each Airwindows reverb's unmodified C++ with clang (both build-time only),
// and inlines the wasm, its metadata and the worklet code into web/index.html so
// the page runs from a single file.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

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
const REVERBS = readdirSync(join(root, "airwindows/src")).sort();
const mathEnv = Object.fromEntries(["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "exp", "log", "log10", "pow"]
  .map((f) => [f, Math[f]]).concat([["fmod", (a, b) => a % b]]));
const reverbs = [];
mkdirSync(join(root, "build/airwindows"), { recursive: true });
const cstr = (x, ptr) => { const m = new Uint8Array(x.memory.buffer); let s = ""; while (m[ptr]) s += String.fromCharCode(m[ptr++]); return s; };
// How a module takes a knob change without clicking (web/faust-worklet.js):
// "clone" crossfades to a copy of the running reverb, so its state must be
// small enough to copy every few milliseconds; "glide" modules smooth their
// own controls (all the Aurora reverbs, see dsp/aurora/aurora.lib).
const CLONE_LIMIT = 8 * 1048576;
function cModule(name, out, extra = {}) {
  const bytes = read(out);
  const x = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: mathEnv }).exports;
  x.init(48000);
  const params = [];
  for (let i = 0; i < x.numParams(); i++) params.push({ name: cstr(x, x.paramName(i)), value: x.getParam(i) });
  const declick = extra.declick || "clone";
  if (declick === "clone" && x.memory.buffer.byteLength > CLONE_LIMIT) throw new Error(`${name}: too big to clone`);
  console.log(`${out}  ${(bytes.length / 1024).toFixed(1)} KB, ${(x.memory.buffer.byteLength / 1048576).toFixed(1)} MB state, ${declick}  ${params.map((p) => p.name).join(", ")}`);
  return { name, kind: "c", wasm: bytes.toString("base64"), params, ...extra, declick };
}
const CLANG = ["--target=wasm32", "-O3", "-std=c++17", "-ffreestanding", "-nostdlib", "-nostdinc++",
  "-fno-exceptions", "-fno-rtti", "-mnontrapping-fptoint", "-mbulk-memory", "-w"];
const LINK = ["-Wl,--no-entry", "-Wl,--export-memory", "-Wl,--strip-all"];
for (const name of REVERBS) {
  const out = `build/airwindows/${name}.wasm`;
  execFileSync("clang++", [
    ...CLANG, "-I", "airwindows/shim", "-I", `airwindows/src/${name}`, `-DAW_HEADER="${name}.h"`, `-DAW_CLASS=${name}`,
    `airwindows/src/${name}/${name}.cpp`, `airwindows/src/${name}/${name}Proc.cpp`,
    "airwindows/shim/wrapper.cpp", "airwindows/shim/longdouble.cpp", ...LINK, "-o", out,
  ], { cwd: root, stdio: "inherit" });
  // the page asks a plugin instance for its parameter displays (Airwindows
  // plugins need init() first)
  reverbs.push(cModule(name, out, { displayInit: true }));
}

// ---- Aurora: Faust standard-library reverbs, Texture and Cloud Seed ----------
// Faust: dsp/aurora/*.dsp. C++: unmodified sources in aurora/src behind the
// wrappers in aurora/shim, built like the Airwindows plugins.
// The end of a wasm module's data segments (Faust keeps its JSON description
// there, at address 0, on top of where the DSP state lives).
function dataEnd(bytes) {
  let pos = 8, end = 0;
  const leb = () => { let v = 0, shift = 0, b; do { b = bytes[pos++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80); return v >>> 0; };
  while (pos < bytes.length) {
    const id = bytes[pos++], size = leb(), next = pos + size;
    if (id === 11) {
      for (let n = leb(); n > 0; n--) {
        const kind = leb();
        if (kind !== 0) throw new Error("unexpected data segment kind");
        if (bytes[pos++] !== 0x41) throw new Error("data segment offset is not i32.const");
        const offset = leb(); pos++;                    // i32.const offset, end
        const len = leb();
        end = Math.max(end, offset + len);
        pos += len;
      }
    }
    pos = next;
  }
  return end;
}
// Whether a fresh instance can skip Faust's full state clear: true when
// clearing just the data segments gives the same state (some constructs, like
// smooth_init, start from non-zero values that only the clear writes).
const { FaustMono } = createRequire(import.meta.url)("./web/faust-runtime.js");
function freshMatchesInit(bytes, meta) {
  const mod = new WebAssembly.Module(bytes);
  const a = new FaustMono(mod, meta, 48000), b = new FaustMono(mod, meta, 48000, 128, { fresh: true });
  return Buffer.compare(Buffer.from(a.memory.buffer, 0, meta.size), Buffer.from(b.memory.buffer, 0, meta.size)) === 0;
}
const AURORA_FAUST = ["plate", "jpverb", "greyhole", "zita", "freeverb", "gemini", "centaurus", "sagittarius", "annihilator", "lyra", "virgo"];
const aurora = [];
mkdirSync(join(root, "build/aurora"), { recursive: true });
for (const name of AURORA_FAUST) {
  execFileSync("npx", ["faust2wasm-ts", `dsp/aurora/${name}.dsp`, `build/aurora/${name}`, "-no-template"], { cwd: root, stdio: "inherit" });
  const meta = JSON.parse(read(`build/aurora/${name}/dsp-meta.json`));
  const sliders = [];
  const walk = (items) => items.forEach((it) => (it.items ? walk(it.items) : sliders.push(it)));
  walk(meta.ui);
  const metaOf = (it, key) => ((it.meta || []).find((m) => key in m) || {})[key];
  const controls = sliders.map((it) => ({ index: it.index, min: it.min, max: it.max, log: metaOf(it, "scale") === "log" }));
  const params = sliders.map((it, i) => {
    const c = controls[i];
    const value = c.log ? Math.log(it.init / c.min) / Math.log(c.max / c.min) : (it.init - c.min) / (c.max - c.min);
    return { name: it.label, value, min: c.min, max: c.max, log: c.log, unit: metaOf(it, "unit") || "" };
  });
  const declick = "glide";
  const wasm = read(`build/aurora/${name}/dsp-module.wasm`);
  const m = { size: meta.size, inputs: meta.inputs, outputs: meta.outputs, ui: meta.ui, dataEnd: dataEnd(wasm) };
  m.fresh = freshMatchesInit(wasm, m);
  aurora.push({ name, kind: "faust", wasm: wasm.toString("base64"), meta: m, controls, params, declick });
  console.log(`build/aurora/${name}  ${(meta.size / 1048576).toFixed(1)} MB state, ${declick}, ${m.fresh ? "fast" : "full"} init  ${params.map((p) => p.name).join(", ")}`);
}
const AURORA_C = {
  texture: ["-DTEST", "-I", "aurora/src/mutable", "aurora/shim/texture.cpp"],
  cloudseed: ["-DBUFFER_SIZE=128", "-DMAX_STR_SIZE=32", "-I", "aurora/src/cloudseed", "-include", "cmath", "aurora/shim/cloudseed.cpp",
    "aurora/src/cloudseed/Parameters.cpp", "aurora/src/cloudseed/DSP/Biquad.cpp", "aurora/src/cloudseed/DSP/RandomBuffer.cpp"],
};
for (const [name, args] of Object.entries(AURORA_C)) {
  const out = `build/aurora/${name}.wasm`;
  execFileSync("clang++", [...CLANG, "-I", "aurora/shim", "-I", "airwindows/shim", ...args, ...LINK, "-o", out], { cwd: root, stdio: "inherit" });
  // both wrappers glide (see aurora/shim); CloudSeed is slow to create, so the
  // host makes it once and keeps it
  aurora.push(cModule(name, out, { declick: "glide", ...(name === "cloudseed" ? { keep: true } : {}) }));
}

writeFileSync(join(root, "build/aurora/modules.json"), JSON.stringify(aurora));   // for test/aurora.cjs

const assets = {
  synths,
  reverbs,
  aurora,
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
