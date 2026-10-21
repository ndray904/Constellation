// Minimal host for a mono Faust DSP compiled to WebAssembly (faust -lang wasm).
// Works inside an AudioWorkletGlobalScope and in Node (for offline tests).
// Memory layout: [ dsp struct | input ptr table | output ptr table | buffers ].

const BLOCK = 128;

// The math a module imports. It comes from musl's libm compiled to wasm
// (libm/, built by build.mjs) once setMathLibrary() has loaded it: a call from
// wasm into a JS function like Math.tanh boxes its result, and the synths make
// such calls several times a sample, so the garbage piles up and V8 stops the
// audio thread to collect it (pauses of up to 3 ms, audible as crackle).
// wasm-to-wasm calls make no garbage. Math.* is the fallback.
let LIBM = null;
function setMathLibrary(bytes) {
  if (!LIBM) LIBM = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
  return LIBM;
}

// A Faust module's imports by name: "_sinf" is sinf and so on.
const FAUST_MATH = {
  _fmodf: (a, b) => a % b, _remainderf: (a, b) => a - Math.round(a / b) * b,
  _rintf: (x) => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 ? r - 1 : r; },
  _log10f: Math.log10, _atan2f: Math.atan2,
};
function faustEnv(module) {
  const env = {};
  for (const { name } of WebAssembly.Module.imports(module)) {
    const fn = (LIBM && LIBM[name.replace(/^_/, "")]) || FAUST_MATH[name] || Math[name.replace(/^_/, "").replace(/f$/, "")];
    if (!fn) throw new Error(`Faust module needs ${name}`);
    env[name] = fn;
  }
  return env;
}

class FaustMono {
  // fresh: don't clear the whole DSP state on init (for a reverb's long delay
  // lines that takes tens of milliseconds). Fresh wasm memory is zero except
  // the module's data segments (meta.dataEnd bytes from 0: Faust's JSON, where
  // the state goes), so only those are cleared, and the few non-zero starting
  // values the full clear would write come from meta.initPatch (build.mjs).
  // build.mjs and test/aurora.cjs check the state comes out exactly as init()
  // leaves it.
  constructor(wasmBytes, meta, sampleRate, blockSize = BLOCK, { fresh = false } = {}) {
    const module = wasmBytes instanceof WebAssembly.Module ? wasmBytes : new WebAssembly.Module(wasmBytes);
    this.instance = new WebAssembly.Instance(module, { env: faustEnv(module) });
    this.exports = this.instance.exports;
    this.memory = this.exports.memory;
    this.numIn = meta.inputs;
    this.numOut = meta.outputs;
    this.block = blockSize;

    // Collect controls by their short name ("lfo_rate" for "/monotron-proto/lfo_rate").
    this.params = {};
    const walk = (items) => items.forEach((it) => {
      if (it.items) walk(it.items);
      else if (it.address) this.params[it.address.split("/").pop()] = it.index;
    });
    walk(meta.ui);

    const align = (n) => (n + 15) & ~15;
    const inTable = align(meta.size);
    const outTable = inTable + 4 * Math.max(1, this.numIn);
    let cursor = align(outTable + 4 * Math.max(1, this.numOut));
    const bytesNeeded = cursor + 4 * blockSize * (this.numIn + this.numOut);
    const missing = bytesNeeded - this.memory.buffer.byteLength;
    if (missing > 0) this.memory.grow(Math.ceil(missing / 65536));

    const heap32 = new Uint32Array(this.memory.buffer);
    this.inputs = [];
    this.outputs = [];
    for (let i = 0; i < this.numIn; i++, cursor += 4 * blockSize) {
      heap32[(inTable >> 2) + i] = cursor;
      this.inputs.push(new Float32Array(this.memory.buffer, cursor, blockSize));
    }
    for (let i = 0; i < this.numOut; i++, cursor += 4 * blockSize) {
      heap32[(outTable >> 2) + i] = cursor;
      this.outputs.push(new Float32Array(this.memory.buffer, cursor, blockSize));
    }
    this.inTable = inTable;
    this.outTable = outTable;
    if (fresh) {
      new Uint8Array(this.memory.buffer, 0, meta.dataEnd).fill(0);
      this.exports.instanceConstants(0, sampleRate);
      this.exports.instanceResetUserInterface(0);
      const heap = new Uint8Array(this.memory.buffer);
      for (const [offset, bytes] of meta.initPatch || []) heap.set(bytes, offset);
    } else {
      this.exports.init(0, sampleRate);
    }
  }

  set(name, value) {
    const index = this.params[name];
    if (index !== undefined) this.exports.setParamValue(0, index, value);
  }

  get(name) {
    const index = this.params[name];
    return index === undefined ? 0 : this.exports.getParamValue(0, index);
  }

  // Runs one block. Fill this.inputs[] before calling; read this.outputs[] after.
  compute(frames = this.block) {
    this.exports.compute(0, frames, this.inTable, this.outTable);
  }
}

if (typeof module !== "undefined") module.exports = { FaustMono, setMathLibrary };
