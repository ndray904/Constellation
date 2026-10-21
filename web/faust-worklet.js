// AudioWorklet processor. Concatenated after faust-runtime.js at build time.
// processorOptions: { variants: [{ wasm, meta }], model, libm: ArrayBuffer }
// Messages in:  { name, value }   Messages out: { lfo }  (~60 per second, when the DSP has an "lfo led")
//
// variants holds one build of the synth per filter model (build.mjs), so only
// the chosen filter runs. All are instantiated, and run once, up front: Chrome
// compiles wasm lazily, on first call. { name: "filter_model" } switches: the
// new build is cleared, given every setting, run silently for PREROLL blocks
// so its smoothed controls and envelope settle, then crossfaded in over FADE
// blocks. Its state starts fresh, so echoes and the LFO phase restart.
const PREROLL = 24, FADE = 8;

class FaustMonoProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { variants, model, libm } = options.processorOptions;
    if (libm) setMathLibrary(libm);
    this.dsps = variants.map(({ wasm, meta }) => {
      const dsp = new FaustMono(wasm, meta, sampleRate);
      dsp.inputs[0].fill(0);
      dsp.compute();
      return dsp;
    });
    this.cur = Math.min(model | 0, this.dsps.length - 1);
    this.dsps[this.cur].exports.instanceClear(0);
    this.dsp = this.dsps[this.cur];
    this.next = -1;                          // build being switched to, or -1
    this.step = 0;                           // blocks into the switch
    this.settings = {};                      // every value received, for the next build
    // Messages are applied at the start of each block. A gate change ends the
    // batch, so a tap shorter than one block still sounds for one block.
    this.queue = [];
    this.port.onmessage = (e) => this.queue.push(e.data);
    this.hasLed = "lfo_led" in this.dsp.params;
    this.ledEvery = Math.max(1, Math.round(sampleRate / 60 / BLOCK));
    this.blockCount = 0;
  }

  switchTo(model) {
    model = Math.min(Math.max(0, model | 0), this.dsps.length - 1);
    if (model === this.cur) { this.next = -1; return; }
    if (model === this.next) return;
    const dsp = this.dsps[model];
    dsp.exports.instanceClear(0);
    for (const [name, value] of Object.entries(this.settings)) dsp.set(name, value);
    this.next = model;
    this.step = 0;
  }

  process(inputs, outputs) {
    let gateSeen = false;
    while (this.queue.length) {
      const { name, value } = this.queue[0];
      if (name === "gate") { if (gateSeen) break; gateSeen = true; }
      this.settings[name] = value;
      if (name === "filter_model") this.switchTo(value);
      else {
        this.dsp.set(name, value);
        if (this.next >= 0) this.dsps[this.next].set(name, value);
      }
      this.queue.shift();
    }
    const input = inputs[0] && inputs[0][0];
    if (input) this.dsp.inputs[0].set(input);
    else this.dsp.inputs[0].fill(0);
    this.dsp.compute();
    const outs = this.dsp.outputs;            // one, or two with a stereo effect (chorus)
    if (this.next >= 0) {
      const incoming = this.dsps[this.next];
      incoming.inputs[0].set(this.dsp.inputs[0]);
      incoming.compute();
      const fade = this.step - PREROLL;
      if (fade >= 0) {                       // crossfade, sample by sample
        for (let c = 0; c < outs.length; c++) {
          const a = incoming.outputs[c], b = outs[c], n = a.length;
          for (let i = 0; i < n; i++) {
            const g = Math.min(1, (fade * n + i + 1) / (FADE * n));
            b[i] += (a[i] - b[i]) * g;
          }
        }
      }
      if (++this.step >= PREROLL + FADE) {
        this.cur = this.next; this.dsp = incoming; this.next = -1;
      }
    }
    const channels = outputs[0];
    for (let c = 0; c < channels.length; c++) channels[c].set(outs[Math.min(c, outs.length - 1)]);
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

// Hosts Nebula's reverbs: Airwindows plugins compiled to wasm, each behind the
// C interface of airwindows/shim/wrapper.cpp.
// processorOptions: { modules: [{ wasm, params }], libm }; params are the 0-1
// knob values, in the plugin's parameter order.
// Messages in: { algo: index } switches reverb (the new one crossfades in over
// ~20 ms); { param: index, value } sets a parameter. Message out: { ready: true }
// once constructed (the page starts sound only after that).
//
// The plugins apply parameters instantly; some (StarChild's Sustain and Grain,
// Infinity's Size, Galactic's Bigness) move their delay taps, so a change is a
// jump in the output: a click. So a change goes to a copy of the running
// reverb (same memory, so the same tank contents) and the output crossfades to
// it over ~20 ms. Changes that arrive during a fade are applied together at its
// end, so a knob drag becomes a run of short crossfades.
//
// Every instance (two per plugin: the running one and a spare for the next
// copy) is made in the constructor, while the page holds the sound off, and
// reused, never thrown away. Allocating or dropping wasm memory while playing
// makes V8 stop this thread for garbage collection, and a reverb's first block
// would stall while Chrome compiles its code (it compiles wasm lazily, on first
// call): pauses that break up the sound. So each instance also runs one silent
// block up front. A reverb switched away from rings out on silence for up to
// 10 s (the two most recent at a time), so selecting it again doesn't bring
// back an old tail.
//
// With nothing coming in and its tail gone (1 s below -140 dB, nothing else
// ringing out), the unit sleeps: it outputs silence without running anything,
// until input arrives. An effect nobody has patched in costs nothing.

// The plugins' math imports (see airwindows/shim/math.h): musl's libm in wasm
// when loaded (see faust-runtime.js), Math.* otherwise.
const AW_MATH_NAMES = ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "exp", "log", "log10", "pow", "fmod"];
const awEnv = () => Object.fromEntries(AW_MATH_NAMES.map((f) => [f, LIBM ? LIBM[f] : f === "fmod" ? (a, b) => a % b : Math[f]]));
const RING_OUT_MAX = 2;

class ReverbProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { modules, libm } = options.processorOptions;
    if (libm) setMathLibrary(libm);
    this.env = awEnv();
    // all compiled up front, so switching never waits on the compiler
    this.modules = modules.map((m) => new WebAssembly.Module(m.wasm));
    this.params = modules.map((m) => m.params.slice());
    this.zeros = new Float32Array(BLOCK);
    this.fadeStep = 1 / (0.02 * sampleRate);
    this.pool = this.modules.map((m, i) => Array.from({ length: 2 }, () => {
      const fx = this.instance(i);
      this.run(fx, this.zeros, this.zeros);   // compiles its code now
      return fx;
    }));
    this.ringing = [];                       // pooled instances still ringing out, newest last
    this.quietFor = 0;                       // frames the output has been silent
    this.current = this.create(0);
    this.previous = null;
    this.dirty = false;            // parameters changed since the current instance got them
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.algo !== undefined && d.algo !== this.current.index) {
        if (this.previous) this.release(this.previous);
        this.previous = this.current;
        this.previous.gain = 1;
        this.current = this.create(d.algo);   // starts with the latest parameters
        this.dirty = false;
      } else if (d.param !== undefined) {
        this.params[this.current.index][d.param] = d.value;
        this.dirty = true;
      }
    };
    this.port.postMessage({ ready: true });
  }

  // A new running instance of module `index`.
  instance(index) {
    const x = new WebAssembly.Instance(this.modules[index], { env: this.env }).exports;
    x.init(sampleRate);
    const ptrs = [x.inL(), x.inR(), x.outL(), x.outR()];
    let mem = null, views = null;
    return {
      index, x, memory: x.memory,
      // views of the I/O buffers, renewed if the module grew its memory
      get io() {
        if (mem !== x.memory.buffer) { mem = x.memory.buffer; views = ptrs.map((ptr) => new Float32Array(mem, ptr, BLOCK)); }
        return views;
      },
      setParam: (i, v) => x.setParam(i, v),
      process: () => x.process(BLOCK),
    };
  }

  // An instance of module `index` from the pool (made if there is none, which
  // the constructor makes sure doesn't happen).
  take(index) {
    const fx = this.pool[index].pop() || this.instance(index);
    const r = this.ringing.indexOf(fx);
    if (r >= 0) this.ringing.splice(r, 1);
    return fx;
  }

  // Back to the pool; ringOut: let its tail die away in the background.
  release(fx, ringOut = true) {
    this.pool[fx.index].push(fx);
    if (ringOut) {
      fx.ringFor = 10 * sampleRate;
      fx.quietFor = 0;
      this.ringing.push(fx);
    }
  }

  create(index) {
    const fx = this.take(index);
    this.params[index].forEach((v, i) => fx.setParam(i, v));
    return fx;
  }

  // A copy of fx with the same state: its plugin object, delay lines and
  // counters, in the spare instance of the same plugin.
  clone(fx) {
    const copy = this.take(fx.index);
    const length = fx.memory.buffer.byteLength;
    const missing = length - copy.memory.buffer.byteLength;
    if (missing > 0) copy.memory.grow(Math.ceil(missing / 65536));
    new Uint8Array(copy.memory.buffer).set(new Uint8Array(fx.memory.buffer, 0, length));
    return copy;
  }

  // The newest instances switched away from ring out on silence until quiet
  // (1 s below -140 dB) or for 10 s; older ones just wait in the pool.
  ringOut() {
    while (this.ringing.length > RING_OUT_MAX) this.ringing.shift();
    for (let n = this.ringing.length - 1; n >= 0; n--) {
      const fx = this.ringing[n];
      const [l, r] = this.run(fx, this.zeros, this.zeros);
      let peak = 0;
      for (let i = 0; i < BLOCK; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
      fx.quietFor = peak < 1e-7 ? fx.quietFor + BLOCK : 0;
      fx.ringFor -= BLOCK;
      if (fx.quietFor >= sampleRate || fx.ringFor <= 0) this.ringing.splice(n, 1);
    }
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
    const input = inputs[0] || [];
    const inL = input[0] || this.zeros, inR = input[1] || inL;
    const [L, R] = outputs[0];
    let live = false;
    for (let i = 0; i < BLOCK && !live; i++) live = inL[i] !== 0 || inR[i] !== 0;
    if (live) this.quietFor = 0;
    else if (this.quietFor >= sampleRate && !this.previous && !this.ringing.length) {
      L.fill(0); if (R) R.fill(0);           // asleep
      return true;
    }
    this.ringOut();
    const [cL, cR] = this.run(this.current, inL, inR);
    let peak = 0;
    for (let i = 0; i < BLOCK; i++) peak = Math.max(peak, Math.abs(cL[i]), Math.abs(cR[i]));
    this.quietFor = peak < 1e-7 ? this.quietFor + BLOCK : 0;
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
    if (g === 0) {
      // a copy that faded out holds nothing the current one doesn't: no tail to ring out
      this.release(this.previous, this.previous.index !== this.current.index);
      this.previous = null;
    }
    return true;
  }
}

registerProcessor("reverb", ReverbProcessor);
