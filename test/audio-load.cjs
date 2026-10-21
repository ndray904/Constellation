// Diagnostic, not a pass/fail test: how hard the audio thread works in the real
// page (headless Chromium), and where it stalls. Every AudioWorklet processor's
// process() and constructor is timed with Date.now() (the only clock a worklet
// has, so 1 ms steps): "load" is the share of real time spent processing, and a
// STALL is one call of 3 ms or more (a 128-frame block lasts 2.7 ms at 48 kHz).
// In a shared container, scattered 3-6 ms stalls that hit every processor
// alike are the machine, not the page.
// Usage: node test/audio-load.cjs start|aurora|nebula|drag|hold:<aurora|nebula>:<module>
//   TRACE_GC=1 DEBUG=pw:browser node test/audio-load.cjs ...   also prints V8's garbage collections
const fs = require("fs"), http = require("http");
const { chromium } = require(require.resolve("playwright", { paths: [process.execPath + "/../../lib/node_modules"] }));
const page = fs.readFileSync(require("path").join(__dirname, "../dist/constellation.html"), "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${page}</body></html>`;
const INSTR = `
const __reg = registerProcessor, __stats = { busy: 0, spikes: [] };
registerProcessor = (name, cls) => __reg(name, class extends cls {
  constructor(o) { const t = Date.now(); super(o); const d = Date.now() - t; if (d >= 3) __stats.spikes.push([name + " constructor", d, +currentTime.toFixed(2)]); }
  process(i, o) { const t = Date.now(); const r = super.process(i, o); const d = Date.now() - t; __stats.busy += d; if (d >= 3) __stats.spikes.push([name, d, +currentTime.toFixed(2)]); return r; }
});
__reg("__stats", class extends AudioWorkletProcessor {
  constructor() { super(); this.port.onmessage = () => { this.port.postMessage({ busy: __stats.busy, spikes: __stats.spikes.splice(0), t: currentTime }); }; }
  process() { return true; }
});
`;
const mode = process.argv[2] || "start";
(async () => {
  const server = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); }).listen(0);
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", ...(process.env.TRACE_GC ? ["--js-flags=--trace-gc"] : [])] });
  const p = await (await browser.newContext({ viewport: { width: 1200, height: 1400 } })).newPage();
  await p.addInitScript((instr) => {
    const orig = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, opts) {
      const code = await (await fetch(url)).text();
      return orig.call(this, URL.createObjectURL(new Blob([instr + code], { type: "text/javascript" })), opts);
    };
  }, INSTR);
  await p.goto(`http://127.0.0.1:${server.address().port}/`);
  const t0 = Date.now();
  await p.evaluate(() => synths.ribbon35.setHold(true));
  const box = await p.locator("#ribbon35-ribbon").boundingBox();
  await p.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);     // starts audio, latches a note
  await p.waitForFunction(() => synths.aurora.node);
  await p.evaluate(() => { const c = synths.ribbon35.node.context; window.__s = new AudioWorkletNode(c, "__stats"); window.__poll = () => new Promise((r) => { window.__s.port.onmessage = (e) => r(e.data); window.__s.port.postMessage(0); }); });
  const poll = () => p.evaluate(() => window.__poll());
  let last = await poll();
  console.log(`start-up  ${last.spikes.length ? "STALLS " + last.spikes.map((x) => `${x[0]} ${x[1]}ms@${x[2]}s`).join(", ") : "no stalls"}`);
  const report = async (label) => {
    const s = await poll();
    const load = (s.busy - last.busy) / ((s.t - last.t) * 1000) * 100;
    console.log(`${label.padEnd(22)} load ${load.toFixed(1).padStart(5)}%  ${s.spikes.length ? "STALLS " + s.spikes.map((x) => `${x[0]} ${x[1]}ms@${x[2]}s`).join(", ") : ""}`);
    last = s;
  };
  if (mode.startsWith("hold:")) {
    const [, k, m] = mode.split(":");
    await p.evaluate(([k, m]) => { setRoute(synths.ribbon35, k); synths[k].setMode(synths[k].spec.algorithms.findIndex((a) => a.module === m)); }, [k, m]);
    await p.waitForTimeout(1000); await report("switched");
    for (let i = 0; i < 10; i++) { await p.waitForTimeout(2000); await report(`${m} ${2 * i + 2} s`); }
  } else if (mode === "drag") {
    // drag every knob of a few Nebula plugins (each change crossfades to a copy)
    await p.evaluate(() => setRoute(synths.ribbon35, "nebula"));
    for (const m of ["Galactic3", "kPlateD", "PocketVerbs", "MatrixVerb", "kCathedral3"]) {
      await p.evaluate((m) => synths.nebula.setMode(synths.nebula.spec.algorithms.findIndex((a) => a.module === m)), m);
      await p.waitForTimeout(300); await report(m + " selected");
      for (const id of await p.evaluate(() => Object.keys(synths.nebula.spec.knobs))) {
        for (let i = 0; i <= 20; i++) { await p.evaluate(([id, v]) => synths.nebula.setKnob(id, v), [id, i % 2 ? 0.3 + i / 40 : 0.7 - i / 40]); await p.waitForTimeout(15); }
      }
      await report(m + " knobs dragged");
    }
  } else if (mode === "start") {
    console.log(`(page to first poll ${Date.now() - t0} ms; stalls before the probe node existed are included)`);
    await p.waitForTimeout(2000); await report("first 2 s");
    await p.waitForTimeout(2000); await report("next 2 s");
  } else {
    await p.waitForTimeout(1500); await report("settled");
    await p.evaluate((k) => setRoute(synths.ribbon35, k), mode);
    await p.waitForTimeout(1000); await report("patched in");
    const mods = await p.evaluate((k) => synths[k].spec.algorithms.map((a) => a.module), mode);
    for (let i = 0; i < mods.length; i++) {
      await p.evaluate(([k, i]) => synths[k].setMode(i), [mode, i]);
      await p.waitForTimeout(mode === "aurora" ? 1500 : 700);
      await report(mods[i]);
    }
  }
  await browser.close(); server.close();
})();
