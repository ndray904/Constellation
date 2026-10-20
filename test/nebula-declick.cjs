// Runs Nebula's AudioWorklet processor (web/faust-worklet.js) in Node and checks
// that dragging a reverb's controls no longer clicks: each change crossfades
// from the running reverb to a clone with the new settings.
// Usage: node test/nebula-declick.cjs   (after node build.mjs)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const SR = 48000;

// The worklet code, with stand-ins for the AudioWorkletGlobalScope it expects.
const processors = {};
const scope = {
  sampleRate: SR,
  AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
  registerProcessor: (name, cls) => { processors[name] = cls; },
  WebAssembly, Math, Float32Array, Uint8Array, Uint32Array, Object, Array,
};
vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(root, "web/faust-runtime.js"), "utf8") + "\n" + fs.readFileSync(path.join(root, "web/faust-worklet.js"), "utf8"), scope);
const Airwindows = processors.reverb;

const env = Object.fromEntries(["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "exp", "log", "log10", "pow"]
  .map((f) => [f, Math[f]]).concat([["fmod", (a, b) => a % b]]));
function defaults(name) {
  const x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(root, `build/airwindows/${name}.wasm`))), { env }).exports;
  x.init(SR);
  return Array.from({ length: x.numParams() }, (_, i) => x.getParam(i));
}

// Plays a 220 Hz tone through one reverb for 2 s; `changes(t)` returns the
// parameter messages to send at time t. Returns the left output.
function play(name, changes) {
  const proc = new Airwindows({ processorOptions: { modules: [{ wasm: fs.readFileSync(path.join(root, `build/airwindows/${name}.wasm`)), params: defaults(name) }] } });
  const out = [];
  for (let b = 0; b < SR * 2 / 128; b++) {
    const t = b * 128 / SR;
    for (const msg of changes(t, b)) proc.port.onmessage({ data: msg });
    const L = new Float32Array(128), R = new Float32Array(128);
    for (let k = 0; k < 128; k++) L[k] = R[k] = 0.25 * Math.sin(2 * Math.PI * 220 * (b * 128 + k) / SR);
    const oL = new Float32Array(128), oR = new Float32Array(128);
    proc.process([[L, R]], [[oL, oR]]);
    out.push(...oL);
  }
  return { out, proc };
}
// Largest second difference: a click shows as a spike.
const jump = (y, a, b) => { let m = 0; for (let i = Math.max(2, Math.floor(a * SR)); i < b * SR; i++) m = Math.max(m, Math.abs(y[i] - 2 * y[i - 1] + y[i - 2])); return m; };
// A knob drag from `from` to `to` over 300 ms, a new value every ~10 ms, ending
// exactly on `to`.
const drag = (param, from, to) => (t, b) => {
  if (t >= 1 && t < 1.3 && b % 4 === 0) return [{ param, value: from + (to - from) * (t - 1) / 0.3 }];
  if (t >= 1.3 && (b - 1) * 128 / SR < 1.3) return [{ param, value: to }];
  return [];
};

let failed = 0;
const check = (label, ok, extra) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label} ${extra}`); if (!ok) failed++; };

// The baseline is the steadier of the sound before and well after the drag:
// a new setting can simply be brighter, which is not a click. StarChild2's
// Grain and Sustain clicked at 26-89x before the crossfade; they must now sit
// at the reverb's own level. Infinity's Size never clicked, and Galactic's
// Bigness keeps a mild ~3x residue when grown (the plugin starts reading older
// buffer audio as its delays lengthen, after any fade): guard against worse.
for (const [name, param, label, from, to, limit] of [
  ["StarChild2", 1, "Grain", 0.7, 0.3, 1.5],
  ["StarChild2", 0, "Sustain", 1.0, 0.4, 1.5],
  ["Infinity", 2, "Size", 0.5, 0.9, 2],
  ["Infinity", 2, "Size", 0.9, 0.2, 2],
  ["Galactic3", 4, "Bigness", 1.0, 0.3, 3.5],
  ["Galactic3", 4, "Bigness", 0.3, 1.0, 3.5],
]) {
  const { out, proc } = play(name, drag(param, from, to));
  const baseline = Math.max(jump(out, 0.5, 1), jump(out, 1.6, 2)), during = jump(out, 1, 1.4);
  const landed = Math.abs(proc.current.x.getParam(param) - to) < 1e-6;
  check(`${name} ${label} drag ${from} -> ${to} stays click-free`, during < baseline * limit && landed,
    `(jumps ${(during / baseline).toFixed(1)}x its own steady level, limit ${limit}x; ends at ${proc.current.x.getParam(param).toFixed(2)})`);
}

// A clone with unchanged settings must continue the sound exactly.
const plain = play("StarChild2", () => []).out;
const cloned = play("StarChild2", (t, b) => (b === Math.round(SR / 128) ? [{ param: 2, value: defaults("StarChild2")[2] }] : [])).out;
let maxDiff = 0;
for (let i = 0; i < plain.length; i++) maxDiff = Math.max(maxDiff, Math.abs(plain[i] - cloned[i]));
check("a clone continues the reverb exactly", maxDiff < 1e-6, `(max diff ${maxDiff.toExponential(1)})`);

process.exit(failed ? 1 : 0);
