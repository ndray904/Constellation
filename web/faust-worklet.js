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

// Hosts the reverbs of Nebula (Airwindows) and Aurora. A module is either
//   { kind: "c", wasm, params }                 C interface: airwindows/shim/wrapper.cpp, aurora/shim/wrapper.h
//   { kind: "faust", wasm, meta, params, controls }   a Faust DSP; controls[i] = { index, min, max, log }
// plus declick: "clone" (default) or "glide", and keep: true for a module that
// is slow to create (CloudSeed clears 64 MB in its constructor): it is created
// once, with the node, and kept; while another reverb plays, it rings out on
// silence in the background until it is quiet. params are the 0-1 knob values,
// in the module's parameter order.
// Messages in: { algo: index } switches reverb (the new one starts empty and
// crossfades in over ~20 ms); { param: index, value } sets a parameter.
//
// Many reverbs apply parameters instantly; some (StarChild's Sustain and Grain,
// Infinity's Size, Galactic's Bigness) move their delay taps, so a change is a
// jump in the output: a click. So for "clone" modules a change goes to a clone
// of the running reverb (same memory, so the same tank contents) and the output
// crossfades to it over ~20 ms. Changes that arrive during a fade are applied
// together at its end, so a knob drag becomes a run of short crossfades.
// "glide" modules are too big to copy every few milliseconds (CloudSeed, the
// Supermassive models); they smooth their own controls, so changes go straight in.
const AW_ENV = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, log: Math.log, log10: Math.log10, pow: Math.pow,
  fmod: (a, b) => a % b,
};

// A knob's 0-1 position as a Faust slider value.
const controlValue = (c, v) => (c.log ? c.min * (c.max / c.min) ** v : c.min + (c.max - c.min) * v);

class ReverbProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { modules } = options.processorOptions;
    // all compiled up front (about 20 ms for all of Nebula's and Aurora's), so
    // switching never waits on the compiler
    this.specs = modules.map((m) => ({ ...m, kind: m.kind || "c", declick: m.declick || "clone", module: new WebAssembly.Module(m.wasm) }));
    this.params = modules.map((m) => m.params.slice());
    this.zeros = new Float32Array(BLOCK);
    this.fadeStep = 1 / (0.02 * sampleRate);
    this.kept = {};
    this.specs.forEach((m, i) => { if (m.keep) this.kept[i] = this.create(i); });
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
        if (this.specs[this.current.index].declick === "glide") this.current.setParam(d.param, d.value);
        else this.dirty = true;
      }
    };
  }

  // A running instance of module `index`: fresh, or an exact copy of `from`
  // (its plugin object, delay lines and counters).
  instance(index, from) {
    const spec = this.specs[index];
    if (spec.kind === "faust") {
      const dsp = new FaustMono(spec.module, spec.meta, sampleRate, BLOCK, { fresh: spec.meta.fresh });
      if (from) new Uint8Array(dsp.memory.buffer).set(new Uint8Array(from.dsp.memory.buffer, 0, spec.meta.size));
      return {
        index, dsp,
        io: [dsp.inputs[0], dsp.inputs[1], dsp.outputs[0], dsp.outputs[1]],
        setParam: (i, v) => dsp.exports.setParamValue(0, spec.controls[i].index, controlValue(spec.controls[i], v)),
        process: () => dsp.compute(),
      };
    }
    const x = new WebAssembly.Instance(spec.module, { env: AW_ENV }).exports;
    if (from) {
      const src = new Uint8Array(from.x.memory.buffer);
      const missing = src.length - x.memory.buffer.byteLength;
      if (missing > 0) x.memory.grow(missing / 65536);
      new Uint8Array(x.memory.buffer).set(src);
    } else {
      x.init(sampleRate);
    }
    const ptrs = [x.inL(), x.inR(), x.outL(), x.outR()];
    let mem = null, views = null;
    return {
      index, x,
      // views of the I/O buffers, renewed if the module grew its memory
      get io() {
        if (mem !== x.memory.buffer) { mem = x.memory.buffer; views = ptrs.map((ptr) => new Float32Array(mem, ptr, BLOCK)); }
        return views;
      },
      setParam: (i, v) => x.setParam(i, v),
      process: () => x.process(BLOCK),
    };
  }

  create(index) {
    const fx = this.kept[index] || this.instance(index);
    this.params[index].forEach((v, i) => fx.setParam(i, v));
    fx.quietFor = 0;
    return fx;
  }

  // Kept reverbs that aren't playing ring out on silence until quiet (1 s
  // below -140 dB), so selecting one again doesn't bring back a frozen tail.
  ringOut() {
    for (const fx of Object.values(this.kept)) {
      if (fx === this.current || fx === this.previous || fx.quietFor >= sampleRate) continue;
      const [l, r] = this.run(fx, this.zeros, this.zeros);
      let peak = 0;
      for (let i = 0; i < BLOCK; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
      fx.quietFor = peak < 1e-7 ? fx.quietFor + BLOCK : 0;
    }
  }

  clone(fx) {
    return this.instance(fx.index, fx);
  }

  run(fx, inL, inR) {
    const [iL, iR] = fx.io;
    iL.set(inL);
    iR.set(inR);
    fx.process();
    const io = fx.io;
    return [io[2], io[3]];
  }

  process(inputs, outputs) {
    if (this.dirty && !this.previous) {
      const next = this.clone(this.current);
      this.params[next.index].forEach((v, i) => next.setParam(i, v));
      this.previous = this.current;
      this.previous.gain = 1;
      this.current = next;
      this.dirty = false;
    }
    this.ringOut();
    const input = inputs[0] || [];
    const inL = input[0] || this.zeros, inR = input[1] || inL;
    const [L, R] = outputs[0];
    const [cL, cR] = this.run(this.current, inL, inR);
    if (!this.previous) {
      L.set(cL); if (R) R.set(cR);
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

registerProcessor("reverb", ReverbProcessor);
