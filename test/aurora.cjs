// Runs every Aurora reverb through the page's AudioWorklet host
// (web/faust-worklet.js) in Node: each must ring on after its input stops and
// stay finite and bounded, and dragging any of its knobs must not click.
// "clone" modules crossfade to a copy of themselves per change; "glide" ones
// (CloudSeed, the Supermassive models) slew their own controls.
// Usage: node test/aurora.cjs   (after node build.mjs)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const SR = 48000;

const processors = {};
const scope = {
  sampleRate: SR,
  AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
  registerProcessor: (name, cls) => { processors[name] = cls; },
  WebAssembly, Math, Float32Array, Uint8Array, Uint32Array, Object, Array, Error,
};
vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(root, "web/faust-runtime.js"), "utf8") + "\n" + fs.readFileSync(path.join(root, "web/faust-worklet.js"), "utf8"), scope);
const Reverb = processors.reverb;
const modules = JSON.parse(fs.readFileSync(path.join(root, "build/aurora/modules.json"), "utf8"));

// 2 s of a 220 Hz tone (or `toneEnd` s of it, then silence) through one module;
// `changes(t, b)` gives the messages to send before block b. Returns the left output.
function play(m, changes = () => [], toneEnd = 2) {
  const proc = new Reverb({ processorOptions: { modules: [{ ...m, wasm: Buffer.from(m.wasm, "base64"), params: m.params.map((p) => p.value) }] } });
  const out = [];
  for (let b = 0; b < SR * 2 / 128; b++) {
    const t = b * 128 / SR;
    for (const msg of changes(t, b)) proc.port.onmessage({ data: msg });
    const L = new Float32Array(128), R = new Float32Array(128);
    for (let k = 0; k < 128; k++) { const tt = (b * 128 + k) / SR; L[k] = R[k] = tt < toneEnd ? 0.25 * Math.sin(2 * Math.PI * 220 * tt) : 0; }
    const oL = new Float32Array(128), oR = new Float32Array(128);
    proc.process([[L, R]], [[oL, oR]]);
    out.push(...oL);
  }
  return { out, proc };
}
const jump = (y, a, b) => { let m = 0; for (let i = Math.max(2, Math.floor(a * SR)); i < b * SR; i++) m = Math.max(m, Math.abs(y[i] - 2 * y[i - 1] + y[i - 2])); return m; };
const rms = (y, a, b) => { let e = 0, n = 0; for (let i = Math.floor(a * SR); i < b * SR; i++) { e += y[i] * y[i]; n++; } return Math.sqrt(e / n); };
const drag = (param, from, to) => (t, b) => {
  if (t >= 1 && t < 1.3 && b % 4 === 0) return [{ param, value: from + (to - from) * (t - 1) / 0.3 }];
  if (t >= 1.3 && (b - 1) * 128 / SR < 1.3) return [{ param, value: to }];
  return [];
};

let failed = 0;
const check = (label, ok, extra) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label} ${extra}`); if (!ok) failed++; };

// A knob may jump to LIMIT x the steadier of the sound before and after its
// drag (a new setting can simply be brighter, which is not a click). Nebula's
// test allows 1.5-3.5x; a click without a declick measures 10-60x.
const LIMIT = 3;
for (const m of modules) {
  // ringing: the tone stops at 0.5 s; 0.1-0.3 s later the reverb must still sound
  const { out } = play(m, () => [], 0.5);
  const peak = out.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  const tail = rms(out, 0.6, 0.8) / (0.25 / Math.SQRT2);
  check(`${m.name}: rings on and stays bounded`, out.every(Number.isFinite) && peak < 2 && tail > 1e-3,
    `(peak ${peak.toFixed(2)}, tail ${(20 * Math.log10(tail)).toFixed(0)} dB re input, ${m.declick})`);

  for (let i = 0; i < m.params.length; i++) {
    const from = m.params[i].value, to = from < 0.5 ? Math.min(1, from + 0.6) : from - 0.6;
    const { out: y } = play(m, drag(i, from, to));
    const baseline = Math.max(jump(y, 0.5, 1), jump(y, 1.6, 2)), during = jump(y, 1, 1.4);
    const ratio = during / Math.max(baseline, 1e-9);
    check(`${m.name} ${m.params[i].name} drag ${from.toFixed(2)} -> ${to.toFixed(2)} stays click-free`, ratio < LIMIT && y.every(Number.isFinite),
      `(jumps ${ratio.toFixed(1)}x its own steady level)`);
  }
}

// For the Faust DSPs marked fresh, the host skips the full state clear on new
// instances (it's slow): that must leave exactly the state init() leaves.
const { FaustMono } = require(path.join(root, "web/faust-runtime.js"));
for (const m of modules.filter((m) => m.kind === "faust" && m.meta.fresh)) {
  const mod = new WebAssembly.Module(Buffer.from(m.wasm, "base64"));
  const a = new FaustMono(mod, m.meta, SR), b = new FaustMono(mod, m.meta, SR, 128, { fresh: true });
  const x = new Uint8Array(a.memory.buffer, 0, m.meta.size), y = new Uint8Array(b.memory.buffer, 0, m.meta.size);
  let same = true;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { same = false; break; }
  check(`${m.name}: a fresh instance starts in the state init() gives`, same, "");
}

// Switching to a module creates a fresh instance inside the audio thread
// (kept modules are made once, with the node): report what that costs.
const proc = new Reverb({ processorOptions: { modules: modules.map((m) => ({ ...m, wasm: Buffer.from(m.wasm, "base64"), params: m.params.map((p) => p.value) })) } });
const costs = modules.map((m, i) => { const t = process.hrtime.bigint(); proc.create(i); return `${m.name} ${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(1)}${m.keep ? " (kept)" : ""}`; });
console.log("INFO  switching cost (ms): " + costs.join(", "));

process.exit(failed ? 1 : 0);
