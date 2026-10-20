// Minimal host for a mono Faust DSP compiled to WebAssembly (faust -lang wasm).
// Works inside an AudioWorkletGlobalScope and in Node (for offline tests).
// Memory layout: [ dsp struct | input ptr table | output ptr table | buffers ].

const BLOCK = 128;

class FaustMono {
  constructor(wasmBytes, meta, sampleRate, blockSize = BLOCK) {
    const module = new WebAssembly.Module(wasmBytes);
    this.instance = new WebAssembly.Instance(module, {
      env: { _expf: Math.exp, _powf: Math.pow, _tanf: Math.tan, _tanhf: Math.tanh },
    });
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
    this.exports.init(0, sampleRate);
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

if (typeof module !== "undefined") module.exports = { FaustMono };
