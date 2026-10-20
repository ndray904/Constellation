// Offline checks for the Delay model. Usage: node test/render-delay.cjs [outDir]
const fs = require("fs");
const path = require("path");
const { FaustMono } = require("../web/faust-runtime.js");

const root = path.join(__dirname, "..");
const wasm = fs.readFileSync(path.join(root, "build/delay/dsp-module.wasm"));
const meta = JSON.parse(fs.readFileSync(path.join(root, "build/delay/dsp-meta.json"), "utf8"));
const SR = 48000;
const outDir = process.argv[2];

// Renders `seconds` of audio. `events` maps a time in seconds to settings to apply then.
function render(settings, seconds, events = {}) {
  const dsp = new FaustMono(wasm, meta, SR);
  dsp.set("cutoff", 0.6); dsp.set("feedback", 0); dsp.set("mode", 1);
  for (const [k, v] of Object.entries(settings)) dsp.set(k, v);
  const times = Object.keys(events).map(Number).sort((a, b) => a - b);
  const total = Math.floor(seconds * SR), out = new Float32Array(total);
  for (let pos = 0; pos < total; pos += dsp.block) {
    while (times.length && times[0] * SR <= pos) for (const [k, v] of Object.entries(events[times.shift()])) dsp.set(k, v);
    dsp.inputs[0].fill(0);
    dsp.compute();
    out.set(dsp.outputs[0].subarray(0, Math.min(dsp.block, total - pos)), pos);
  }
  return out;
}

const slice = (x, a, b) => x.subarray(Math.floor(a * SR), Math.floor(b * SR));
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const finite = (x) => x.every(Number.isFinite);
// Pitch by autocorrelation: the first lag whose correlation reaches 90% of
// the best one (so a subharmonic lag never wins). Robust to the fixed
// resonance ringing near the cutoff.
function pitchHz(raw) {
  // four one-pole low-passes at 1.2 kHz tame the ringing before correlating
  const x = Float32Array.from(raw), k = 1 - Math.exp(-2 * Math.PI * 1200 / SR);
  for (let pass = 0; pass < 4; pass++) for (let i = 1, y = x[0]; i < x.length; i++) { y += k * (x[i] - y); x[i] = y; }
  const n = 4096, corr = (lag) => { let c = 0; for (let i = 0; i < n; i++) c += x[i] * x[i + lag]; return c; };
  const cs = []; let best = 0;
  for (let lag = 8; lag < 2400; lag++) { cs[lag] = corr(lag); best = Math.max(best, cs[lag]); }
  for (let lag = 9; lag < 2399; lag++) if (cs[lag] >= 0.9 * best && cs[lag] >= cs[lag - 1] && cs[lag] >= cs[lag + 1]) return SR / lag;
  return NaN;
}
function zcHz(x) { let c = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; return c / (x.length / SR); }

// Time of the first 5 ms window after `from` seconds whose RMS exceeds `thresh`.
function onsetAfter(x, from, thresh) {
  const win = Math.floor(0.005 * SR);
  for (let i = Math.floor(from * SR); i + win < x.length; i += win) if (rms(x.subarray(i, i + win)) > thresh) return i / SR;
  return NaN;
}

const delayMs = (t) => 11.46 * (1 + 100 * t) + 29.7;   // datasheet fit
const checks = [];

// Ribbon: four octaves above 55 Hz. Feedback 0 so there are no echoes.
const low = pitchHz(slice(render({ gate: 1, ribbon: 0, cutoff: 1 }, 1), 0.5, 1));
const high = pitchHz(slice(render({ gate: 1, ribbon: 1, cutoff: 1 }, 1), 0.5, 1));
console.log(`ribbon bottom ${low.toFixed(1)} Hz, top ${high.toFixed(1)} Hz (${(Math.log2(high / low)).toFixed(2)} octaves)`);
checks.push(["ribbon bottom 55 Hz", Math.abs(low / 55 - 1) < 0.03]);
checks.push(["ribbon spans 4 octaves", Math.abs(Math.log2(high / low) - 4) < 0.05]);

// Echo timing: a 30 ms blip, then look for the first echo.
for (const t of [0, 0.25, 1]) {
  const want = delayMs(t) / 1000;
  const x = render({ time: t, feedback: 0.5, ribbon: 0.5 }, want + 0.5, { 0: { gate: 1 }, 0.03: { gate: 0 } });
  const blip = rms(slice(x, 0.005, 0.03));
  const echo = onsetAfter(x, 0.03 + 0.01, blip * 0.05);
  console.log(`time ${t}: echo at ${(echo * 1000).toFixed(0)} ms (datasheet fit ${(want * 1000).toFixed(0)} ms)`);
  checks.push([`time knob ${t}: echo at ${(want * 1000).toFixed(0)} ms`, Math.abs(echo - want) < 0.012]);
}

// No feedback: silent once released (no VCF gate, but no echo either). The
// first ~0.3 s after release is the headphone coupling cap (2.3 Hz) settling
// from where the oscillator stopped, as on the hardware.
const noFb = render({ feedback: 0 }, 1.3, { 0: { gate: 1 }, 0.2: { gate: 0 } });
console.log(`feedback 0, after release: ${peak(slice(noFb, 0.8, 1.3)).toExponential(1)} peak (hiss floor)`);
checks.push(["feedback 0: silent after release", peak(slice(noFb, 0.8, 1.3)) < 1e-3]);

// Moderate feedback decays; full feedback runs away but stays bounded.
const moderate = render({ feedback: 0.4, time: 0.1 }, 4, { 0: { gate: 1 }, 0.1: { gate: 0 } });
const runaway = render({ feedback: 1, time: 0.1 }, 4, { 0: { gate: 1 }, 0.1: { gate: 0 } });
const m1 = rms(slice(moderate, 0.2, 0.7)), m2 = rms(slice(moderate, 3.4, 3.9));
const r2 = rms(slice(runaway, 3.4, 3.9));
console.log(`feedback 0.4: ${m1.toFixed(4)} -> ${m2.toFixed(5)} rms; feedback 1: ${r2.toFixed(3)} rms after 3.4 s, peak ${peak(runaway).toFixed(3)}`);
checks.push(["feedback 0.4: repeats die away", m2 < m1 * 0.05]);
checks.push(["feedback 1: runs away and keeps sounding", r2 > 0.05]);
checks.push(["feedback 1: bounded, no NaN", finite(runaway) && peak(runaway) <= 1.0001]);

// Turning TIME while echoes ring bends their pitch (tape-style), not a jump.
const held = render({ feedback: 0.75, time: 0.3, cutoff: 0.7, ribbon: 0.5 }, 3, { 0: { gate: 1 }, 0.4: { gate: 0 }, 1.6: { time: 0.1 } });
const before = zcHz(slice(held, 1.3, 1.6)), during = zcHz(slice(held, 1.62, 1.75));
console.log(`echo pitch ${before.toFixed(0)} Hz, while shortening the time ${during.toFixed(0)} Hz`);
checks.push(["shortening TIME bends echoes up in pitch", during > before * 1.15]);

// Presets (copied from web/index.html) must not run away from silence: the page
// opens on Init, and only "Runaway" is meant to feed back on its own. Each must
// still echo audibly when played.
const PRESETS = {
  Init:         { mode: 1, lfo_rate: 0.4,  lfo_int: 0,    lfo_shape: 0.5, cutoff: 0.45, time: 0.25, feedback: 0.35 },
  "Space echo": { mode: 1, lfo_rate: 0.3,  lfo_int: 0.06, lfo_shape: 0.5, cutoff: 0.4,  time: 0.3,  feedback: 0.35 },
  Slapback:     { mode: 1, lfo_rate: 0.4,  lfo_int: 0,    lfo_shape: 0.5, cutoff: 0.5,  time: 0.05, feedback: 0.2 },
  Laser:        { mode: 2, lfo_rate: 0.55, lfo_int: 0.6,  lfo_shape: 0.2, cutoff: 0.55, time: 0.12, feedback: 0.5 },
};
for (const [name, p] of Object.entries(PRESETS)) {
  const quiet = rms(slice(render(p, 30), 29, 30));
  const played = render({ ...p, ribbon: 0.4 }, 1.2, { 0: { gate: 1 }, 0.1: { gate: 0 } });
  const echo = rms(slice(played, 0.15, 1.2));
  console.log(`${name.padEnd(11)} idle after 30 s ${quiet.toExponential(1)} rms; echoes after a note ${echo.toFixed(3)} rms`);
  checks.push([`preset ${name}: quiet from silence for 30 s`, quiet < 1e-3]);
  checks.push([`preset ${name}: echoes after a note`, echo > 0.01]);
}

const standby = render({ mode: 0, gate: 1 }, 0.5);
checks.push(["silent in standby", peak(standby) < 1e-3]);

if (outDir) {
  const x = render({ feedback: 0.6, time: 0.3, lfo_int: 0.15, lfo_rate: 0.45, cutoff: 0.5 }, 4, { 0: { gate: 1, ribbon: 0.4 }, 0.4: { ribbon: 0.6 }, 0.8: { gate: 0 }, 2.5: { time: 0.12 } });
  const buf = Buffer.alloc(44 + x.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + x.length * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36);
  buf.writeUInt32LE(x.length * 2, 40);
  x.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  fs.writeFileSync(path.join(outDir, "delay-echoes.wav"), buf);
}

let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failed++; }
process.exit(failed ? 1 : 0);
