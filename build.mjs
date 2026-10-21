// Builds dist/constellation.html: compiles each synth's .dsp with the Faust compiler
// and each Airwindows reverb's unmodified C++ with clang (both build-time only),
// and inlines the wasm, its metadata and the worklet code into web/index.html so
// the page runs from a single file.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p));

// ---- libm: musl's math library in wasm, the imports of every module --------
// libm/musl holds the needed musl sources unmodified; libm/inc and
// libm/builtins.c stand in for the bits of its build that aren't the math.
const LIBM_EXPORTS = ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "exp", "log", "log10", "pow", "fmod"]
  .flatMap((f) => [f, f + "f"]);
mkdirSync(join(root, "build"), { recursive: true });
execFileSync("clang", [
  "--target=wasm32", "-O2", "-std=c99", "-ffreestanding", "-D_XOPEN_SOURCE=700", "-w",
  "-I", "libm/inc", "-I", "libm/musl/arch/generic", "-I", "libm/musl/src/include", "-I", "libm/musl/src/internal", "-idirafter", "libm/musl/include",
  "libm/builtins.c", ...readdirSync(join(root, "libm/musl/src/math")).filter((f) => f.endsWith(".c")).map((f) => `libm/musl/src/math/${f}`),
  "-nostdlib", "-Wl,--no-entry", ...LIBM_EXPORTS.map((f) => `-Wl,--export=${f}`), "-Wl,--strip-all", "-o", "build/libm.wasm",
], { cwd: root, stdio: "inherit" });
const libmBytes = read("build/libm.wasm");
const libm = new WebAssembly.Instance(new WebAssembly.Module(libmBytes)).exports;
console.log(`build/libm.wasm  ${(libmBytes.length / 1024).toFixed(1)} KB`);

const SYNTHS = { ribbon35: "dsp/monotron.dsp", duo: "dsp/duo.dsp", delay: "dsp/delay.dsp" };

// Faust computes every branch of a select, so a module with all the filter
// models runs all six filters all the time. The page gets one module per
// model instead, with the model fixed (and mc.vcfFixed, which drops the other
// filters even inside a feedback loop), so only the chosen filter runs; the
// worklet swaps between them. The module with the model as a control is still
// built (build/<name>), for the offline tests.
const FILTER_MODELS = 6;
const synths = {};
mkdirSync(join(root, "build/variants"), { recursive: true });
writeFileSync(join(root, "build/variants/monotron-common.lib"), read("dsp/monotron-common.lib"));
const faust = (dsp, out) => {
  execFileSync("npx", ["faust2wasm-ts", dsp, out, "-no-template"], { cwd: root, stdio: "inherit" });
  const meta = JSON.parse(read(`${out}/dsp-meta.json`));
  return {
    wasm: read(`${out}/dsp-module.wasm`).toString("base64"),
    meta: { size: meta.size, inputs: meta.inputs, outputs: meta.outputs, ui: meta.ui },
  };
};
for (const [name, dsp] of Object.entries(SYNTHS)) {
  faust(dsp, `build/${name}`);
  const source = read(dsp).toString();
  const control = /nentry\("\[\d+\]filter model", 0, 0, 5, 1\)/;
  if (!control.test(source)) throw new Error(`${dsp}: filter model control not found`);
  synths[name] = [];
  for (let m = 0; m < FILTER_MODELS; m++) {
    const variant = `build/variants/${name}-${m}.dsp`;
    writeFileSync(join(root, variant), source.replace(control, String(m)).replaceAll("mc.vcf(", "mc.vcfFixed("));
    synths[name].push(faust(variant, `build/variants/${name}-${m}`));
  }
}

// ---- Airwindows reverbs (Nebula): C++ -> wasm32 with clang, no libc ----------
// airwindows/src holds the plugins' LinuxVST sources unmodified; airwindows/shim
// stands in for the VST SDK, libm (Math.* imported from JS) and a tiny runtime.
const REVERBS = readdirSync(join(root, "airwindows/src")).sort();
const mathEnv = Object.fromEntries(["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "exp", "log", "log10", "pow", "fmod"]
  .map((f) => [f, libm[f]]));
const reverbs = [];
mkdirSync(join(root, "build/airwindows"), { recursive: true });
const cstr = (x, ptr) => { const m = new Uint8Array(x.memory.buffer); let s = ""; while (m[ptr]) s += String.fromCharCode(m[ptr++]); return s; };
// A knob change crossfades to a copy of the running reverb
// (web/faust-worklet.js), so its state must be small enough to copy every few
// milliseconds.
const CLONE_LIMIT = 8 * 1048576;
function cModule(name, out, extra = {}) {
  const bytes = read(out);
  const x = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: mathEnv }).exports;
  x.init(48000);
  const params = [];
  for (let i = 0; i < x.numParams(); i++) params.push({ name: cstr(x, x.paramName(i)), value: x.getParam(i) });
  if (x.memory.buffer.byteLength > CLONE_LIMIT) throw new Error(`${name}: too big to copy per change`);
  console.log(`${out}  ${(bytes.length / 1024).toFixed(1)} KB, ${(x.memory.buffer.byteLength / 1048576).toFixed(1)} MB state  ${params.map((p) => p.name).join(", ")}`);
  return { name, wasm: bytes.toString("base64"), params, ...extra };
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

const assets = {
  libm: libmBytes.toString("base64"),
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

// GitHub Pages serves docs/ from main at https://ndray904.github.io/Constellation/.
mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(join(root, "docs/index.html"), standalone);
writeFileSync(join(root, "docs/.nojekyll"), "");
