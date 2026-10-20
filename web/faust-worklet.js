// AudioWorklet processor. Concatenated after faust-runtime.js at build time.
// processorOptions: { wasm: ArrayBuffer, meta: object }
// Messages in:  { name, value }   Messages out: { lfo }  (~60 per second, when the DSP has an "lfo led")

class FaustMonoProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { wasm, meta } = options.processorOptions;
    this.dsp = new FaustMono(wasm, meta, sampleRate);
    // Messages are applied at the start of each block. A gate change ends the
    // batch, so a tap shorter than one block still sounds for one block.
    this.queue = [];
    this.port.onmessage = (e) => this.queue.push(e.data);
    this.hasLed = "lfo_led" in this.dsp.params;
    this.ledEvery = Math.max(1, Math.round(sampleRate / 60 / BLOCK));
    this.blockCount = 0;
  }

  process(inputs, outputs) {
    let gateSeen = false;
    while (this.queue.length) {
      const { name, value } = this.queue[0];
      if (name === "gate") { if (gateSeen) break; gateSeen = true; }
      this.dsp.set(name, value);
      this.queue.shift();
    }
    const input = inputs[0] && inputs[0][0];
    if (input) this.dsp.inputs[0].set(input);
    else this.dsp.inputs[0].fill(0);
    this.dsp.compute();
    for (const channel of outputs[0]) channel.set(this.dsp.outputs[0]);
    if (this.hasLed && ++this.blockCount >= this.ledEvery) {
      this.blockCount = 0;
      this.port.postMessage({ lfo: this.dsp.get("lfo_led") });
    }
    return true;
  }
}

registerProcessor("faust-mono", FaustMonoProcessor);

// Records its (stereo) input while armed and posts it to the page in batches
// of ~4096 frames as [left, right] Float32Arrays. Messages in: { record: bool }.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.left = [];
    this.right = [];
    this.frames = 0;
    this.port.onmessage = (e) => {
      const wasOn = this.on;
      this.on = e.data.record;
      if (wasOn && !this.on) this.flush(true);   // last batch, marked done
    };
  }

  flush(done = false) {
    if (!this.frames) { if (done) this.port.postMessage({ done: true }); return; }
    const join = (parts) => { const out = new Float32Array(this.frames); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
    const l = join(this.left), r = join(this.right);
    this.port.postMessage({ left: l, right: r, done }, [l.buffer, r.buffer]);
    this.left = []; this.right = []; this.frames = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (this.on && input && input.length) {
      this.left.push(input[0].slice(0));
      this.right.push((input[1] || input[0]).slice(0));
      this.frames += input[0].length;
      if (this.frames >= 4096) this.flush();
    }
    return true;
  }
}

registerProcessor("recorder", RecorderProcessor);

// Hosts the Airwindows reverbs (C++ compiled to wasm, see airwindows/).
// processorOptions: { modules: [{ wasm: ArrayBuffer, params: [values] }] }
// Messages in: { algo: index } switches reverb (the new one starts empty and
// crossfades in over ~20 ms); { param: index, value } sets a parameter.
//
// The plugins apply parameters instantly; some (StarChild's Sustain and Grain,
// Infinity's Size, Galactic's Bigness) move their delay taps, so a change is a
// jump in the output: a click. So a change goes to a clone of the running
// reverb (same wasm memory, so the same tank contents) and the output
// crossfades to it over ~20 ms. Changes that arrive during a fade are applied
// together at its end, so a knob drag becomes a run of short crossfades.
const AW_ENV = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, log: Math.log, log10: Math.log10, pow: Math.pow,
  fmod: (a, b) => a % b,
};

class AirwindowsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { modules } = options.processorOptions;
    this.modules = modules.map((m) => new WebAssembly.Module(m.wasm));
    this.params = modules.map((m) => m.params.slice());
    this.zeros = new Float32Array(BLOCK);
    this.fadeStep = 1 / (0.02 * sampleRate);
    this.current = this.create(0);
    this.previous = null;
    this.dirty = false;            // parameters changed since the current instance got them
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.algo !== undefined && d.algo !== this.current.index) {
        this.previous = this.current;
        this.previous.gain = 1;
        this.current = this.create(d.algo);   // starts with the latest parameters
        this.dirty = false;
      } else if (d.param !== undefined) {
        this.params[this.current.index][d.param] = d.value;
        this.dirty = true;
      }
    };
  }

  create(index) {
    const x = new WebAssembly.Instance(this.modules[index], { env: AW_ENV }).exports;
    x.init(sampleRate);
    this.params[index].forEach((v, i) => x.setParam(i, v));
    return { index, x };
  }

  // A second instance of the same plugin with an exact copy of fx's memory: the
  // plugin object, its delay lines and its counters.
  clone(fx) {
    const x = new WebAssembly.Instance(this.modules[fx.index], { env: AW_ENV }).exports;
    const src = new Uint8Array(fx.x.memory.buffer);
    const missing = src.length - x.memory.buffer.byteLength;
    if (missing > 0) x.memory.grow(missing / 65536);
    new Uint8Array(x.memory.buffer).set(src);
    return { index: fx.index, x };
  }

  run(fx, inL, inR) {
    const { x } = fx, mem = x.memory.buffer;
    new Float32Array(mem, x.inL(), BLOCK).set(inL);
    new Float32Array(mem, x.inR(), BLOCK).set(inR);
    x.process(BLOCK);
    return [new Float32Array(x.memory.buffer, x.outL(), BLOCK), new Float32Array(x.memory.buffer, x.outR(), BLOCK)];
  }

  process(inputs, outputs) {
    if (this.dirty && !this.previous) {
      const next = this.clone(this.current);
      this.params[next.index].forEach((v, i) => next.x.setParam(i, v));
      this.previous = this.current;
      this.previous.gain = 1;
      this.current = next;
      this.dirty = false;
    }
    const input = inputs[0] || [];
    const inL = input[0] || this.zeros, inR = input[1] || inL;
    const [L, R] = outputs[0];
    const [cL, cR] = this.run(this.current, inL, inR);
    if (!this.previous) {
      L.set(cL); R.set(cR || cL);
      return true;
    }
    const [pL, pR] = this.run(this.previous, inL, inR);
    let g = this.previous.gain;
    for (let i = 0; i < BLOCK; i++) {
      g = Math.max(0, g - this.fadeStep);
      L[i] = cL[i] * (1 - g) + pL[i] * g;
      if (R) R[i] = cR[i] * (1 - g) + pR[i] * g;
    }
    this.previous.gain = g;
    if (g === 0) this.previous = null;
    return true;
  }
}

registerProcessor("airwindows", AirwindowsProcessor);
