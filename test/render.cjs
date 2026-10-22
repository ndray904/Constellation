// Offline checks: renders a few gestures and prints level / pitch statistics.
// Usage: node test/render.cjs [outDir]   (writes WAV files when outDir is given)
const fs = require("fs");
const path = require("path");
const { FaustMono, setMathLibrary } = require("../web/faust-runtime.js");
setMathLibrary(require("fs").readFileSync(require("path").join(__dirname, "../build/libm.wasm")));   // as in the browser

const root = path.join(__dirname, "..");
const wasm = fs.readFileSync(path.join(root, "build/ribbon35/dsp-module.wasm"));
const meta = JSON.parse(fs.readFileSync(path.join(root, "build/ribbon35/dsp-meta.json"), "utf8"));
const SR = 48000;
const outDir = process.argv[2];

function render(name, seconds, setup, automate) {
  const dsp = new FaustMono(wasm, meta, SR);
  setup(dsp);
  const total = Math.floor(seconds * SR);
  const out = new Float32Array(total);
  for (let pos = 0; pos < total; pos += dsp.block) {
    if (automate) automate(dsp, pos / SR);
    dsp.inputs[0].fill(0);
    dsp.compute();
    out.set(dsp.outputs[0].subarray(0, Math.min(dsp.block, total - pos)), pos);
  }
  const tail = out.subarray(Math.floor(total / 2));
  let peak = 0, sum = 0, crossings = 0, nan = false;
  for (let i = 0; i < tail.length; i++) {
    const v = tail[i];
    if (!Number.isFinite(v)) nan = true;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
    if (i && tail[i - 1] < 0 && v >= 0) crossings++;
  }
  const hz = crossings / (tail.length / SR);
  console.log(`${name.padEnd(28)} peak ${peak.toFixed(3)}  rms ${Math.sqrt(sum / tail.length).toFixed(3)}  ~${hz.toFixed(1)} Hz${nan ? "  NaN!" : ""}`);
  if (outDir) writeWav(path.join(outDir, `${name}.wav`), out);
  return { peak, hz, nan };
}

function writeWav(file, data) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + data.length * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  fs.writeFileSync(file, buf);
}

const note = (ribbon) => (d) => { d.set("ribbon", ribbon); d.set("gate", 1); d.set("cutoff", 1); d.set("peak", 0); };
const results = [];
results.push(render("open-filter-bottom", 1, note(0)));
results.push(render("open-filter-top", 1, note(1)));
results.push(render("gate-off-silence", 1, (d) => { d.set("gate", 0); d.set("peak", 0); }));
results.push(render("standby-silence", 1, (d) => { d.set("gate", 1); d.set("mode", 0); }));
results.push(render("peak-max-self-osc", 1, (d) => { d.set("gate", 0); d.set("cutoff", 0.5); d.set("peak", 1); }));
results.push(render("peak-max-stdlib", 1, (d) => { d.set("gate", 1); d.set("cutoff", 0.5); d.set("peak", 1); d.set("filter_model", 1); }));
results.push(render("moog-open", 1, (d) => { note(0.5)(d); d.set("filter_model", 2); }));
results.push(render("moog-mid-peak", 1, (d) => { note(0.3)(d); d.set("cutoff", 0.5); d.set("peak", 0.6); d.set("filter_model", 2); }));
results.push(render("lfo-pitch-sweep", 2, (d) => { d.set("gate", 1); d.set("lfo_int", 1); d.set("lfo_rate", 0.2); d.set("cutoff", 0.8); }));
results.push(render("lfo-cutoff-wobble", 2, (d) => { d.set("gate", 1); d.set("mode", 2); d.set("lfo_int", 0.8); d.set("lfo_rate", 0.35); d.set("cutoff", 0.4); d.set("peak", 0.7); }));
results.push(render("speaker-path", 1, (d) => { note(0.5)(d); d.set("speaker", 1); }));
results.push(render("ribbon-glide", 2, (d) => d.set("gate", 1), (d, t) => d.set("ribbon", (t / 2) % 1)));

function lfoHz(rate, seconds) {
  const d = new FaustMono(wasm, meta, SR, 1);
  d.set("lfo_rate", rate);
  let prev = 0, rising = false, wraps = 0, first = -1, last = -1;
  for (let i = 0; i < seconds * SR; i++) {
    d.compute(1);
    const v = d.get("lfo_led");
    // The ramp only ever falls except at a reset (which the PolyBLEP spreads over
    // two samples), so count the start of each rise. Skip 0.5 s of knob smoothing.
    const up = v > prev;
    if (up && !rising && i > SR / 2) { wraps++; if (first < 0) first = i; last = i; }
    rising = up;
    prev = v;
  }
  return (wraps - 1) / ((last - first) / SR);
}
// Aliasing of the LFO ramp at full speed: share of spectrum energy that is not
// on a harmonic of the LFO frequency (aliases fold onto inharmonic bins).
function lfoAliasDb(rate) {
  const N = 1 << 16, d = new FaustMono(wasm, meta, SR, 1);
  d.set("lfo_rate", rate);
  for (let i = 0; i < SR / 2; i++) d.compute(1);        // let the knob settle
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { d.compute(1); re[i] = d.get("lfo_led") * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); }
  for (let i = 1, j = 0; i < N; i++) {                    // in-place radix-2 FFT
    let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      const xr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, xi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
      re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi;
    }
  }
  // Use the measured fundamental (peak bin, parabolic interpolation): float
  // phase rounding puts it a fraction of a hertz off the nominal value.
  const binHz = SR / N, mag = (b) => Math.log(re[b] * re[b] + im[b] * im[b] + 1e-30);
  const nominal = (1 / 14) * Math.pow(900 * 14, rate);
  let pk = Math.round(nominal / binHz);
  for (let b = pk - 20; b <= pk + 20; b++) if (mag(b) > mag(pk)) pk = b;
  const off = 0.5 * (mag(pk - 1) - mag(pk + 1)) / (mag(pk - 1) - 2 * mag(pk) + mag(pk + 1));
  const f0 = (pk + off) * binHz;
  let onH = 0, offH = 0;
  for (let b = 3; b < N / 2; b++) {
    const e = re[b] * re[b] + im[b] * im[b], hz = b * binHz;
    const nearest = Math.round(hz / f0) * f0;
    if (Math.abs(hz - nearest) <= 4 * binHz) onH += e; else offH += e;
  }
  return 10 * Math.log10(offH / onH);
}
const aliasDb = lfoAliasDb(1);
console.log(`lfo aliasing at 900 Hz: ${aliasDb.toFixed(1)} dB below the harmonics`);

const lfoSlow = lfoHz(0, 45);
const lfoFast = lfoHz(1, 2);
console.log(`lfo at min: ${(1 / lfoSlow).toFixed(2)} s/cycle   lfo at max: ${lfoFast.toFixed(1)} Hz`);

// Pitch knob: 1 V/oct over 0..10 V from C0 = 16.35 Hz. Default 0.333 -> 3.33 V -> 164.4 Hz; ribbon 1 adds 18 semitones.
const pitchHz = (k) => 16.3516 * Math.pow(2, k * 10);
const expectLow = pitchHz(0.333);
// The extra filter models (2 Moog, 3 Moog half ladder, 4 Oberheim, 5 TB-303).
const ladders = [[2, "Moog ladder"], [3, "Moog half ladder"], [5, "TB-303"]];
const fm = (m, peak, gate) => (d) => { d.set("gate", gate); d.set("cutoff", 0.5); d.set("peak", peak); d.set("filter_model", m); };
const ladderOsc = ladders.map(([m, n]) => render(`${n}-peak-max`, 1, fm(m, 1, 0)));
const ladderBelow = ladders.map(([m, n]) => render(`${n}-peak-0.85`, 1, fm(m, 0.85, 0)));
const wobble = (m, n) => render(`${n}-lfo-cutoff-max-peak`, 2, (d) => { fm(m, 1, 1)(d); d.set("mode", 2); d.set("lfo_int", 1); d.set("lfo_rate", 0.6); });
const sweeps = [...ladders, [4, "Oberheim"]].map(([m, n]) => wobble(m, n));
const oberheimOsc = render("Oberheim-peak-max", 1, fm(4, 1, 0));
// ADSR: level in 50 ms windows over 1 s of gate then 1 s without.
const envWindows = (set) => {
  const d = new FaustMono(wasm, meta, SR); d.set("ribbon", 0.4); d.set("cutoff", 1); d.set("peak", 0); set(d);
  const win = []; let acc = 0, n = 0;
  for (let b = 0; b < 2 * SR / 128; b++) {
    d.set("gate", b < SR / 128 ? 1 : 0); d.compute();
    for (const v of d.outputs[0]) { acc += v * v; n++; }
    if (n >= SR / 20) { win.push(Math.sqrt(acc / n)); acc = 0; n = 0; }
  }
  return win;
};
const envPlain = envWindows(() => {}), envAttack = envWindows((d) => d.set("attack", 0.5));
const envDecay = envWindows((d) => { d.set("decay", 0.5); d.set("sustain", 0.3); }), envRelease = envWindows((d) => d.set("release", 0.5));
const knobCentre = render("pitch-knob-centre-5V", 1, (d) => { note(0)(d); d.set("pitch", 0.5); });
const knob8V = render("pitch-knob-8V", 1, (d) => { note(0)(d); d.set("pitch", 0.8); });
const checks = [
  ["no NaN/Inf anywhere", results.every((r) => !r.nan)],
  ["nothing exceeds full scale", results.every((r) => r.peak <= 1.0001)],
  ["bottom of ribbon ~" + expectLow.toFixed(1) + " Hz", Math.abs(results[0].hz / expectLow - 1) < 0.03],
  ["ribbon spans 18 semitones", Math.abs(12 * Math.log2(results[1].hz / results[0].hz) - 18) < 0.5],
  ["pitch knob centre (5 V) = C5 523.3 Hz", Math.abs(knobCentre.hz / pitchHz(0.5) - 1) < 0.02],
  ["pitch knob 8 V = C8 4186 Hz (1 V/oct)", Math.abs(knob8V.hz / pitchHz(0.8) - 1) < 0.02],
  ["LFO minimum = 14 s per cycle", Math.abs(1 / lfoSlow - 14) < 0.2],
  ["LFO maximum = 900 Hz", Math.abs(lfoFast / 900 - 1) < 0.01],
  ["LFO at 900 Hz is band-limited (aliasing < -30 dB)", aliasDb < -30],
  ["silent without gate", results[2].peak < 1e-3],
  ["silent in standby", results[3].peak < 1e-3],
  ["diode loop self-oscillates at max peak (no gate)", results[4].peak > 0.05],
  ["self-oscillation near cutoff (632 Hz)", results[4].hz > 400 && results[4].hz < 700],
  ...ladders.map(([, n], i) => [`${n} self-oscillates at max peak, near cutoff`, ladderOsc[i].peak > 0.05 && ladderOsc[i].hz > 580 && ladderOsc[i].hz < 680]),
  ...ladders.map(([, n], i) => [`${n} stays quiet below the oscillation edge`, ladderBelow[i].peak < 1e-3]),
  ["Oberheim SEM never self-oscillates", oberheimOsc.peak < 1e-3],
  ["extra filter models stay bounded under audio-rate cutoff sweeps", sweeps.every((r) => !r.nan && r.peak <= 1.0001)],
  ["ADSR at its defaults is the plain gate (silent 50 ms after release)", envPlain[21] < 0.002 && envPlain[10] > 0.15],
  ["ADSR attack 375 ms rises slowly, then reaches full level", envAttack[1] < 0.6 * envPlain[1] && Math.abs(envAttack[15] / envPlain[15] - 1) < 0.02],
  // the output's soft saturation lifts a 30% sustain to about 34%
  ["ADSR decay falls to the sustain level (0.3)", envDecay[15] / envPlain[15] > 0.27 && envDecay[15] / envPlain[15] < 0.4],
  ["ADSR release rings on after the gate, then fades out", envRelease[20] > 0.3 * envPlain[15] && envRelease[30] < 0.002],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failed++; }
process.exit(failed ? 1 : 0);
