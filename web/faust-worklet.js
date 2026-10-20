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
