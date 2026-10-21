// Checks that each Airwindows reverb compiled to wasm (build/airwindows, from
// build.mjs) produces the same audio as the same C++ built natively with the
// real C math library. Both get bit-identical input; differences come only from
// last-bit libm rounding (musl's sin, which the browser build uses, vs glibc's), so a faithful port
// matches to well over 100 dB; in practice it comes out bit-identical.
// Usage: node test/airwindows-parity.cjs   (needs a native clang++)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const SR = 48000, FRAMES = SR * 3;
// the modules' math imports: musl's libm in wasm (build/libm.wasm), as in the browser
const libm = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(root, "build/libm.wasm")))).exports;
const env = Object.fromEntries(["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "exp", "log", "log10", "pow", "fmod"]
  .map((f) => [f, libm[f]]));

// Test input: a noise burst and two tones (1 s), then silence for the tail.
const input = [];
let noise = 12345;
for (let pos = 0; pos < FRAMES; pos += 128) {
  const L = new Float32Array(128), R = new Float32Array(128);
  for (let k = 0; k < 128; k++) {
    const t = (pos + k) / SR;
    noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
    const burst = t < 0.25 ? ((noise >>> 9) / 8388608 - 1) * 0.5 : 0;
    L[k] = burst + (t < 1 ? 0.3 * Math.sin(2 * Math.PI * 220 * t) : 0);
    R[k] = burst + (t < 1 ? 0.3 * Math.sin(2 * Math.PI * 330 * t) : 0);
  }
  input.push(L, R);
}
const inputFile = path.join(os.tmpdir(), `aw-parity-${process.pid}.f32`);
fs.writeFileSync(inputFile, Buffer.concat(input.map((a) => Buffer.from(a.buffer))));

function runWasm(name, params) {
  const x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(root, `build/airwindows/${name}.wasm`))), { env }).exports;
  x.init(SR);
  for (const [i, v] of params) x.setParam(i, v);
  const out = new Float32Array(FRAMES * 2);
  for (let b = 0; b < input.length / 2; b++) {
    new Float32Array(x.memory.buffer, x.inL(), 128).set(input[2 * b]);
    new Float32Array(x.memory.buffer, x.inR(), 128).set(input[2 * b + 1]);
    x.process(128);
    out.set(new Float32Array(x.memory.buffer, x.outL(), 128), b * 256);
    out.set(new Float32Array(x.memory.buffer, x.outR(), 128), b * 256 + 128);
  }
  return out;
}

const nativeDir = path.join(root, "build/airwindows-native");
fs.mkdirSync(nativeDir, { recursive: true });
function runNative(name, params) {
  const bin = path.join(nativeDir, name);
  if (!fs.existsSync(bin)) {
    execFileSync("clang++", ["-O2", "-w", "-std=c++17", "-I", "test/airwindows-native", "-I", `airwindows/src/${name}`,
      `-DAW_HEADER="${name}.h"`, `-DAW_CLASS=${name}`, `airwindows/src/${name}/${name}.cpp`, `airwindows/src/${name}/${name}Proc.cpp`,
      "test/airwindows-native/native.cpp", "-o", bin], { cwd: root, stdio: "inherit" });
  }
  const args = [String(SR), String(FRAMES), ...params.flatMap(([i, v]) => [String(i), String(v)])];
  const raw = execFileSync(bin, args, { env: { ...process.env, AW_INPUT: inputFile }, maxBuffer: 1 << 26 });
  return new Float32Array(new Uint8Array(raw).buffer);
}

// Every plugin at its defaults, and again with every control moved to a
// different (fixed) spot.
const CASES = fs.readdirSync(path.join(root, "airwindows/src")).sort().flatMap((name) => {
  const x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(root, `build/airwindows/${name}.wasm`))), { env }).exports;
  x.init(SR);
  const moved = Array.from({ length: x.numParams() }, (_, i) => [i, Math.round((0.25 + 0.5 * ((i * 0.618034 + 0.3) % 1)) * 100) / 100]);
  return [[name, []], [name, moved]];
});
let failed = 0;
for (const [name, params] of CASES) {
  const w = runWasm(name, params), n = runNative(name, params);
  let sig = 0, err = 0, peak = 0, maxDiff = 0;
  for (let i = 0; i < w.length; i++) {
    const d = w[i] - n[i];
    sig += n[i] * n[i]; err += d * d; peak = Math.max(peak, Math.abs(n[i])); maxDiff = Math.max(maxDiff, Math.abs(d));
  }
  const db = 10 * Math.log10(sig / Math.max(err, 1e-300));
  const ok = w.length === n.length && w.every(Number.isFinite) && peak > 0.01 && db > 100;
  const match = err === 0 ? "bit-identical" : `to ${db.toFixed(0)} dB (max diff ${maxDiff.toExponential(1)})`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${params.length ? JSON.stringify(params) : "defaults"}: wasm = native ${match}, peak ${peak.toFixed(2)}`);
  if (!ok) failed++;
}
fs.unlinkSync(inputFile);
process.exit(failed ? 1 : 0);
