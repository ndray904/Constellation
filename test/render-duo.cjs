// Offline checks for the Duo model. Usage: node test/render-duo.cjs [outDir]
const fs = require("fs");
const path = require("path");
const { FaustMono } = require("../web/faust-runtime.js");

const root = path.join(__dirname, "..");
const wasm = fs.readFileSync(path.join(root, "build/duo/dsp-module.wasm"));
const meta = JSON.parse(fs.readFileSync(path.join(root, "build/duo/dsp-meta.json"), "utf8"));
const SR = 48000;
const outDir = process.argv[2];

function render(settings, seconds = 1) {
  const dsp = new FaustMono(wasm, meta, SR);
  dsp.set("cutoff", 1); dsp.set("peak", 0); dsp.set("mode", 1); dsp.set("gate", 1);
  for (const [k, v] of Object.entries(settings)) dsp.set(k, v);
  const total = Math.floor(seconds * SR);
  const out = new Float32Array(total);
  for (let pos = 0; pos < total; pos += dsp.block) {
    dsp.inputs[0].fill(0);
    dsp.compute();
    out.set(dsp.outputs[0].subarray(0, Math.min(dsp.block, total - pos)), pos);
  }
  return out.subarray(Math.floor(total / 2));     // skip knob smoothing
}

function stats(x) {
  let peak = 0, crossings = 0, nan = false;
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i])) nan = true;
    peak = Math.max(peak, Math.abs(x[i]));
    if (i && x[i - 1] < 0 && x[i] >= 0) crossings++;
  }
  return { peak, hz: crossings / (x.length / SR), nan };
}

// Magnitude (dB) of x at frequency hz, Hann-windowed single-bin DFT.
function levelAt(x, hz) {
  let re = 0, im = 0;
  for (let i = 0; i < x.length; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / x.length);
    re += x[i] * w * Math.cos(2 * Math.PI * hz * i / SR);
    im -= x[i] * w * Math.sin(2 * Math.PI * hz * i / SR);
  }
  return 20 * Math.log10(Math.hypot(re, im) / x.length + 1e-12);
}

const base = 16.3516 * Math.pow(2, 0.333 * 10);      // VCO1 PITCH default, bottom of ribbon
const at = (semis) => base * Math.pow(2, semis / 12);
const near = (got, want, tol = 0.02) => Math.abs(got / want - 1) < tol;
const checks = [];
const show = (label, got, want) => console.log(`${label.padEnd(34)} ${got.toFixed(1)} Hz (want ${want.toFixed(1)})`);

// Ribbon and scales. SCALE: 0 chromatic, 1 major, 2 minor, 3 off.
const cases = [
  ["chromatic, bottom of ribbon",      { scale: 0, ribbon: 0 },        at(0)],
  ["chromatic, 12.48 st -> 12",        { scale: 0, ribbon: 12.48 / 24 }, at(12)],
  ["chromatic, top of ribbon (+24)",   { scale: 0, ribbon: 1 },        at(24)],
  ["major, 6.1 st -> 7 (fifth)",       { scale: 1, ribbon: 6.1 / 24 }, at(7)],
  ["major, 3.4 st -> 4 (third)",       { scale: 1, ribbon: 3.4 / 24 }, at(4)],
  ["minor, 3.4 st -> 3 (minor third)", { scale: 2, ribbon: 3.4 / 24 }, at(3)],
  ["minor, 15.4 st -> 15",             { scale: 2, ribbon: 15.4 / 24 }, at(15)],
  ["off, 6.1 st stays continuous",     { scale: 3, ribbon: 6.1 / 24 }, at(6.1)],
];
for (const [label, s, want] of cases) {
  const { hz } = stats(render(s));
  show(label, hz, want);
  checks.push([label, near(hz, want)]);
}

// VCO2 PITCH: +7.3 octaves at full travel, so 0.5 puts VCO2 3.65 octaves up.
const f2 = base * Math.pow(2, 0.5 * 7.3);
const vco2Off = levelAt(render({ mode: 1, vco2_pitch: 0.5 }), f2);
const vco2On = levelAt(render({ mode: 2, vco2_pitch: 0.5 }), f2);
console.log(`VCO2 at ${f2.toFixed(0)} Hz: ${vco2Off.toFixed(1)} dB in VCO1, ${vco2On.toFixed(1)} dB in VCO1+2`);
checks.push(["VCO1+2 adds VCO2 3.65 octaves up (+20 dB)", vco2On - vco2Off > 20]);

// X-MOD: VCO1 spends half of each VCO2 cycle 3.1 octaves up, so its average
// cycle rate is base * (1 + 2^3.1) / 2.
const xmodWant = base * (1 + Math.pow(2, 3.1)) / 2;
const xmod = stats(render({ mode: 1, xmod_int: 1, vco2_pitch: 0 }));
show("X-MOD full, average VCO1 rate", xmod.hz, xmodWant);
checks.push(["X-MOD throws VCO1 up 3.1 octaves", near(xmod.hz, xmodWant, 0.06)]);

// LINE IN (CN2 -> R53/R52 10k, R68 100k, C26 -> IC5D): passes through the VCF
// without touching the ribbon, silent in standby.
function lineIn(settings) {
  const dsp = new FaustMono(wasm, meta, SR);
  dsp.set("mode", 2); dsp.set("line_in", 1);
  for (const [k, v] of Object.entries(settings)) dsp.set(k, v);
  let ph = 0, s = 0, n = 0;
  for (let b = 0; b < SR / 128; b++) {
    for (let i = 0; i < 128; i++) { dsp.inputs[0][i] = 0.3 * Math.sin(ph); ph += 2 * Math.PI * 220 / SR; }
    dsp.compute();
    if (b * 128 > SR / 2) for (const v of dsp.outputs[0]) { s += v * v; n++; }
  }
  return Math.sqrt(s / n);
}
checks.push(["line in passes without touching the ribbon", lineIn({}) > 0.05]);
checks.push(["line in silent in standby", lineIn({ mode: 0 }) < 1e-3]);

const all = [
  render({ mode: 2, xmod_int: 1, vco2_pitch: 0.3, peak: 1, cutoff: 0.5 }),
  render({ mode: 2, ribbon: 1, scale: 3, vco2_pitch: 1 }),
];
const selfOsc = stats(render({ mode: 1, gate: 0, peak: 1, cutoff: 0.5 }));
const noGate = stats(render({ mode: 2, gate: 0 }));
const standby = stats(render({ mode: 0 }));
checks.push(["no NaN/Inf, nothing over full scale", all.map(stats).every((r) => !r.nan && r.peak <= 1.0001)]);
checks.push(["silent without gate", noGate.peak < 1e-3]);
checks.push(["silent in standby", standby.peak < 1e-3]);
checks.push(["filter self-oscillates at full Peak", selfOsc.peak > 0.05]);

if (outDir) for (const [name, s] of [["duo-x-mod", { mode: 2, xmod_int: 0.6, vco2_pitch: 0.25, cutoff: 0.7, peak: 0.4 }]]) {
  const x = render(s, 2);
  const buf = Buffer.alloc(44 + x.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + x.length * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36);
  buf.writeUInt32LE(x.length * 2, 40);
  x.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  fs.writeFileSync(path.join(outDir, `${name}.wav`), buf);
}

let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failed++; }
process.exit(failed ? 1 : 0);
