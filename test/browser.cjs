// Loads dist/constellation.html in headless Chromium, plays both ribbons and checks
// that audio reaches each analyser. Usage: node test/browser.cjs [screenshotDir]
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require(require.resolve("playwright", { paths: [process.execPath + "/../../lib/node_modules"] }));

const page = fs.readFileSync(path.join(__dirname, "../dist/constellation.html"), "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${page}</body></html>`;
const shots = process.argv[2];

(async () => {
  const server = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); }).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  let failed = 0;
  const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label} ${extra}`); if (!ok) failed++; };
  const rms = (p, key) => p.evaluate((k) => {
    const a = synths[k].analyser; if (!a) return 0;
    const b = new Float32Array(4096); a.getFloatTimeDomainData(b);
    return Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
  }, key);

  for (const [name, viewport, scheme] of [["desktop", { width: 1200, height: 1900 }, "light"], ["phone", { width: 390, height: 3200 }, "dark"]]) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await p.goto(url);

    // ---- Pulsar (ribbon35) ----
    let box = await p.locator("#ribbon35-ribbon").boundingBox();
    let y = box.y + box.height / 2;
    await p.mouse.move(box.x + box.width * 0.3, y);
    await p.mouse.down();
    await p.waitForTimeout(500);
    const playing = await rms(p, "ribbon35");
    const status = await p.textContent("#status");
    await p.mouse.move(box.x + box.width * 0.8, y, { steps: 8 });
    await p.waitForTimeout(150);
    const readout = await p.textContent("#ribbon35-readout");
    await p.mouse.up();
    await p.waitForTimeout(300);
    const released = await rms(p, "ribbon35");

    check(`[${name}] status shows sound on`, /Sound on/.test(status), `(${status})`);
    // The page opens with the Delay on Init: it must not feed back on its own.
    await p.waitForTimeout(3000);
    let idleDelay = 0;
    for (let i = 0; i < 6; i++) { idleDelay = Math.max(idleDelay, await rms(p, "delay")); await p.waitForTimeout(60); }
    check(`[${name}] Singularity stays quiet after the page loads`, idleDelay < 0.002, `(rms ${idleDelay.toFixed(4)})`);
    check(`[${name}] Pulsar: ribbon press makes sound`, playing > 0.02, `(rms ${playing.toFixed(3)})`);
    check(`[${name}] Pulsar: release goes quiet`, released < 0.005, `(rms ${released.toFixed(4)})`);
    check(`[${name}] Pulsar: readout follows ribbon`, /\d+\.\d Hz/.test(readout), `(${readout})`);

    await p.click("#ribbon35-presets button:text-is(\"Whistle\")");
    await p.waitForTimeout(600);
    const whistle = await rms(p, "ribbon35");
    check(`[${name}] Pulsar: full peak whistles untouched`, whistle > 0.02, `(rms ${whistle.toFixed(3)})`);
    await p.click("#ribbon35-presets button:text-is(\"Init\")");

    // ---- Duo ----
    await p.locator("#duo-ribbon").scrollIntoViewIfNeeded();
    box = await p.locator("#duo-ribbon").boundingBox();
    y = box.y + box.height / 2;
    await p.mouse.move(box.x + box.width * 0.5, y);
    await p.mouse.down();
    await p.waitForTimeout(500);
    const duoPlaying = await rms(p, "duo");
    const duoReadout = await p.textContent("#duo-readout");
    await p.mouse.up();
    await p.waitForTimeout(300);
    const duoReleased = await rms(p, "duo");
    check(`[${name}] Binary: ribbon press makes sound`, duoPlaying > 0.02, `(rms ${duoPlaying.toFixed(3)})`);
    check(`[${name}] Binary: release goes quiet`, duoReleased < 0.005, `(rms ${duoReleased.toFixed(4)})`);
    // Chromatic by default: notes snap to whole semitones above the bottom of the
    // ribbon, whose pitch the (continuous) VCO1 Pitch knob sets.
    const duoHz = parseFloat(duoReadout);
    const interval = await p.evaluate((hz) => 12 * Math.log2(hz / pitchHz(synths.duo.params.pitch)), duoHz);
    check(`[${name}] Binary: chromatic snaps to whole semitones`, Math.abs(interval - Math.round(interval)) < 0.01, `(${interval.toFixed(3)} st, ${duoReadout})`);

    const badge = await p.evaluate(() => [synths.ribbon35.keysBadge.classList.contains("off"), synths.duo.keysBadge.classList.contains("off")]);
    check(`[${name}] keys badge moves to the Binary after touching it`, badge[0] === true && badge[1] === false);
    await p.keyboard.down("g");                              // 7 semitones up from the bottom
    await p.waitForTimeout(300);
    const keyNote = await p.evaluate(() => synths.duo.params.ribbon * 24);
    const keySound = await rms(p, "duo");
    await p.keyboard.up("g");
    check(`[${name}] Binary: key G plays 7 semitones up`, Math.abs(keyNote - 7) < 1e-6 && keySound > 0.02, `(${keyNote.toFixed(2)} st, rms ${keySound.toFixed(3)})`);

    await p.click("#duo-scale");
    const scale1 = await p.evaluate(() => [synths.duo.params.scale, document.querySelectorAll("#duo .slot.off-scale").length]);
    await p.click("#duo-scale"); await p.click("#duo-scale"); await p.click("#duo-scale");
    const scale0 = await p.evaluate(() => synths.duo.params.scale);
    check(`[${name}] Binary: scale button cycles Major and dims 10 off-scale slots`, scale1[0] === 1 && scale1[1] === 10, `(${scale1})`);
    check(`[${name}] Binary: scale button wraps back to Chromatic`, scale0 === 0);

    // ---- Delay ----
    await p.locator("#delay-ribbon").scrollIntoViewIfNeeded();
    box = await p.locator("#delay-ribbon").boundingBox();
    y = box.y + box.height / 2;
    await p.mouse.move(box.x + box.width * 0.4, y);
    await p.mouse.down();
    await p.waitForTimeout(400);
    const delayPlaying = await rms(p, "delay");
    await p.mouse.up();
    await p.waitForTimeout(450);                  // first echo at 328 ms (Time 0.25)
    const delayEcho = await rms(p, "delay");
    const timeText = await p.textContent("#delay-knob-time");
    const timeValue = await p.evaluate(() => document.querySelector("#delay-knob-time").getAttribute("aria-valuetext"));
    check(`[${name}] Singularity: ribbon press makes sound`, delayPlaying > 0.02, `(rms ${delayPlaying.toFixed(3)})`);
    check(`[${name}] Singularity: echoes keep sounding after release`, delayEcho > 0.005, `(rms ${delayEcho.toFixed(4)})`);
    check(`[${name}] Singularity: Time knob reads the datasheet fit (328 ms)`, timeValue === "328 ms", `(${timeValue})`);

    // Shape: dims while LFO Int. is 0, reads rise/width by wave, and changes the LFO.
    const shapeIdle = await p.evaluate(() => synths.delay.knobEls.lfo_shape.wrap.classList.contains("idle"));
    await p.evaluate(() => { synths.delay.setKnob("lfo_int", 0.3); synths.delay.setKnob("lfo_rate", 0.2); });
    const shapeAwake = await p.evaluate(() => !synths.delay.knobEls.lfo_shape.wrap.classList.contains("idle"));
    await p.click("#delay-mode-2");
    const duty = () => p.evaluate(() => new Promise((res) => {
      const vals = [], t = setInterval(() => vals.push(synths.delay.lfo), 5);
      setTimeout(() => { clearInterval(t); res(vals.filter((v) => v > 0.5).length / vals.length); }, 3000);
    }));
    await p.locator("#delay-knob-lfo_shape").scrollIntoViewIfNeeded();
    const sb = await p.locator("#delay-knob-lfo_shape").boundingBox();
    const dragShape = async (dy) => {
      await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await p.mouse.down();
      await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + dy, { steps: 10 }); await p.mouse.up();
    };
    await dragShape(200);
    const narrow = await duty();
    const narrowText = await p.evaluate(() => synths.delay.knobEls.lfo_shape.value.textContent);
    await dragShape(-400);
    const wide = await duty();
    await p.click("#delay-mode-1");
    const triText = await p.evaluate(() => synths.delay.knobEls.lfo_shape.value.textContent);
    check(`[${name}] Singularity: Shape dims at Int. 0 and wakes when Int. is raised`, shapeIdle && shapeAwake);
    check(`[${name}] Singularity: dragging Shape changes the square LFO's width`, narrow < 0.15 && wide > 0.85, `(${narrow.toFixed(2)} -> ${wide.toFixed(2)})`);
    check(`[${name}] Singularity: Shape reads width on square, rise on triangle`, narrowText === "width 5%" && triText === "rise 95%", `(${narrowText}, ${triText})`);
    await p.click("#delay-presets button:text-is(\"Init\")");

    // all three instruments at once
    await p.click("#ribbon35-presets button:text-is(\"Whistle\")");
    await p.click("#delay-presets button:text-is(\"Runaway\")");
    // a short note for the runaway echoes to repeat
    await p.locator("#delay-ribbon").scrollIntoViewIfNeeded();
    const db = await p.locator("#delay-ribbon").boundingBox();
    await p.mouse.move(db.x + db.width * 0.5, db.y + db.height / 2);
    await p.mouse.down(); await p.waitForTimeout(120); await p.mouse.up();
    await p.locator("#duo-ribbon").scrollIntoViewIfNeeded();
    const duoBox = await p.locator("#duo-ribbon").boundingBox();
    await p.mouse.move(duoBox.x + duoBox.width * 0.2, duoBox.y + duoBox.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(600);
    // echoes come in bursts, so take the loudest of several analyser readings
    let delayLoudest = 0;
    for (let i = 0; i < 6; i++) { delayLoudest = Math.max(delayLoudest, await rms(p, "delay")); await p.waitForTimeout(60); }
    const all3 = [await rms(p, "ribbon35"), await rms(p, "duo"), delayLoudest];
    await p.mouse.up();
    check(`[${name}] all three instruments sound together`, all3.every((v) => v > 0.005), `(${all3.map((v) => v.toFixed(3))})`);

    // ---- Hold ----
    const press = async (sel, frac, ms) => {
      await p.locator(sel).scrollIntoViewIfNeeded();
      const bx = await p.locator(sel).boundingBox();
      await p.mouse.move(bx.x + bx.width * frac, bx.y + bx.height / 2);
      await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up();
    };
    const loudest = async (fn, n = 6) => { let m = 0; for (let i = 0; i < n; i++) { m = Math.max(m, await fn()); await p.waitForTimeout(60); } return m; };
    const masterRms = () => p.evaluate(() => { const b = new Float32Array(4096); masterAnalyser.getFloatTimeDomainData(b); return Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length); });
    await p.click("#ribbon35-presets button:text-is(\"Init\")");
    await p.click("#duo-presets button:text-is(\"Init\")");
    await p.click("#delay-presets button:text-is(\"Init\")");

    await p.click("#ribbon35-hold");
    await press("#ribbon35-ribbon", 0.3, 150);
    await p.waitForTimeout(400);
    const heldR35 = await rms(p, "ribbon35");
    const pitchA = await p.evaluate(() => synths.ribbon35.params.ribbon);
    await press("#ribbon35-ribbon", 0.8, 150);
    await p.waitForTimeout(300);
    const pitchB = await p.evaluate(() => [synths.ribbon35.params.ribbon, synths.ribbon35.params.gate]);
    await p.click("#ribbon35-hold");
    await p.waitForTimeout(300);
    const releasedR35 = await rms(p, "ribbon35");
    check(`[${name}] Hold: note keeps sounding after release`, heldR35 > 0.02, `(rms ${heldR35.toFixed(3)})`);
    check(`[${name}] Hold: a new touch changes pitch and keeps the gate`, pitchB[0] > pitchA + 0.3 && pitchB[1] === 1, `(${pitchA.toFixed(2)} -> ${pitchB[0].toFixed(2)})`);
    check(`[${name}] Hold: turning it off releases the note`, releasedR35 < 0.005, `(rms ${releasedR35.toFixed(4)})`);

    await p.click("#duo-hold");                          // armed with nothing playing
    await p.waitForTimeout(300);
    const armedQuiet = await rms(p, "duo");
    await press("#duo-ribbon", 0.5, 120);
    await p.waitForTimeout(400);
    const armedHeld = await rms(p, "duo");
    await p.keyboard.press("Space");                     // Duo has the keys after the touch
    await p.waitForTimeout(300);
    const spaceOff = [await p.evaluate(() => synths.duo.hold), await rms(p, "duo")];
    check(`[${name}] Hold armed first: silent until touched, then holds`, armedQuiet < 0.005 && armedHeld > 0.02, `(${armedQuiet.toFixed(4)}, ${armedHeld.toFixed(3)})`);
    check(`[${name}] space bar toggles Hold on the keys instrument`, spaceOff[0] === false && spaceOff[1] < 0.005, `(${spaceOff})`);

    // ---- Routing: Pulsar through Singularity ----
    await p.click("#ribbon35-hold");
    await press("#ribbon35-ribbon", 0.4, 120);
    await p.click("#ribbon35-send-delay");
    await p.waitForTimeout(500);
    const routed = {
      direct: await p.evaluate(() => synths.ribbon35.out.gain.value),
      delay: await loudest(() => rms(p, "delay")),
      master: await loudest(masterRms),
      label: await p.evaluate(() => synths.delay.lineInText.textContent),
      speaker: await p.evaluate(() => synths.ribbon35.params.speaker),
    };
    check(`[${name}] To Singularity: Pulsar's direct output is muted`, routed.direct < 0.01, `(gain ${routed.direct.toFixed(3)})`);
    check(`[${name}] To Singularity: its sound comes out of the Singularity`, routed.delay > 0.02 && routed.master > 0.02, `(delay ${routed.delay.toFixed(3)}, master ${routed.master.toFixed(3)})`);
    check(`[${name}] To Singularity: Singularity shows "Line in ◂ Pulsar"`, routed.label === "Line in ◂ Pulsar", `(${routed.label})`);

    await p.click("#delay-mode-0");
    await p.waitForTimeout(400);
    const standbyMaster = await loudest(masterRms);
    const standbyLabel = await p.evaluate(() => synths.delay.lineInText.textContent);
    check(`[${name}] To Singularity: Singularity in standby silences the routed sound`, standbyMaster < 0.005 && /switch on to hear/.test(standbyLabel), `(${standbyMaster.toFixed(4)}, ${standbyLabel})`);
    await p.click("#delay-mode-1");

    await p.click("#ribbon35-hold");                       // release: echoes of Pulsar ring on in Singularity
    await p.waitForTimeout(150);
    const echoTail = await loudest(masterRms, 8);
    check(`[${name}] To Singularity: Pulsar's echoes ring on after release`, echoTail > 0.005, `(rms ${echoTail.toFixed(4)})`);

    await p.click("#duo-send-delay");
    const both = await p.evaluate(() => synths.delay.lineInText.textContent);
    check(`[${name}] To Singularity: both sources listed`, both === "Line in ◂ Pulsar + Binary", `(${both})`);
    await p.click("#duo-send-delay"); await p.click("#ribbon35-send-delay");
    await press("#ribbon35-ribbon", 0.4, 400);
    const unrouted = [await p.evaluate(() => synths.ribbon35.out.gain.value), await p.evaluate(() => synths.delay.lineIn.hidden)];
    check(`[${name}] unrouting restores the direct output`, unrouted[0] > 0.99 && unrouted[1] === true, `(${unrouted})`);

    // ---- Routing: Pulsar into Binary, and the full chain ----
    await p.click("#ribbon35-hold");                       // hold a Pulsar note
    await press("#ribbon35-ribbon", 0.4, 120);
    await p.click("#ribbon35-send-duo");
    await p.waitForTimeout(500);
    const intoBinary = {
      direct: await p.evaluate(() => synths.ribbon35.out.gain.value),
      binary: await loudest(() => rms(p, "duo")),
      binaryGate: await p.evaluate(() => synths.duo.params.gate),
      label: await p.evaluate(() => [synths.duo.lineIn.hidden, synths.duo.lineInText.textContent]),
    };
    check(`[${name}] To Binary: Pulsar plays through Binary's filter, Binary untouched`, intoBinary.direct < 0.01 && intoBinary.binary > 0.02 && intoBinary.binaryGate === 0, `(direct ${intoBinary.direct.toFixed(3)}, Binary ${intoBinary.binary.toFixed(3)})`);
    check(`[${name}] To Binary: Binary shows "Line in ◂ Pulsar"`, intoBinary.label[0] === false && intoBinary.label[1] === "Line in ◂ Pulsar", `(${intoBinary.label})`);

    await p.click("#ribbon35-send-delay");                 // one jack: moving the cable unpatches Binary
    await p.waitForTimeout(300);
    const moved = await p.evaluate(() => [synths.ribbon35.routedTo, synths.duo.lineIn.hidden, synths.delay.lineInText.textContent,
      document.querySelector("#ribbon35-send-duo").getAttribute("aria-pressed")]);
    check(`[${name}] Pulsar's cable goes to one place at a time`, moved[0] === "delay" && moved[1] === true && moved[2] === "Line in ◂ Pulsar" && moved[3] === "false", `(${moved})`);

    await p.click("#ribbon35-send-duo");                   // chain: Pulsar -> Binary -> Singularity
    await p.click("#duo-send-delay");
    await p.waitForTimeout(600);
    const chain = {
      labels: await p.evaluate(() => [synths.duo.lineInText.textContent, synths.delay.lineInText.textContent]),
      direct: await p.evaluate(() => [synths.ribbon35.out.gain.value, synths.duo.out.gain.value]),
      delay: await loudest(() => rms(p, "delay")),
      master: await loudest(masterRms),
    };
    check(`[${name}] chain Pulsar -> Binary -> Singularity is heard through Singularity`, chain.direct.every((g) => g < 0.01) && chain.delay > 0.02 && chain.master > 0.02, `(Singularity ${chain.delay.toFixed(3)}, master ${chain.master.toFixed(3)})`);
    check(`[${name}] chain indicators`, chain.labels[0] === "Line in ◂ Pulsar" && chain.labels[1] === "Line in ◂ Binary", `(${chain.labels})`);

    await p.click("#duo-mode-0");                          // Binary in standby breaks the chain
    await p.waitForTimeout(3000);                          // let Singularity's echoes of it die away
    const broken = [await loudest(masterRms, 8), await p.evaluate(() => synths.duo.lineInText.textContent)];
    check(`[${name}] Binary in standby silences the chain and says so`, broken[0] < 0.005 && /switch on to hear/.test(broken[1]), `(${broken[0].toFixed(4)}, ${broken[1]})`);
    await p.click("#duo-mode-2");
    await p.click("#duo-send-delay"); await p.click("#ribbon35-send-duo"); await p.click("#ribbon35-hold");

    // ---- MIDI (synthetic messages; headless Chromium has no MIDI devices) ----
    await p.click("#ribbon35-presets button:text-is(\"Init\")");
    await p.click("#ribbon35-ribbon");                     // Pulsar gets the keys
    const midi = (bytes) => p.evaluate((b) => handleMidi(b), bytes);
    const readHz = (k) => p.evaluate((key) => parseFloat(synths[key].readout.textContent), k);
    await midi([0x90, 60, 100]);
    const c4 = [await readHz("ribbon35"), await p.evaluate(() => synths.ribbon35.params.gate)];
    await midi([0x90, 64, 100]); await midi([0x90, 67, 100]); await midi([0x80, 67, 0]);
    const backTo64 = await readHz("ribbon35");
    await midi([0xe0, 0x7f, 0x7f]);                        // full bend up: +2 semitones
    const bent = await readHz("ribbon35");
    await midi([0xe0, 0x00, 0x40]);
    await midi([0x80, 64, 0]); await midi([0x80, 60, 0]);
    const offGate = await p.evaluate(() => synths.ribbon35.params.gate);
    await midi([0x90, 36, 100]);                           // C2 is below Pulsar's ribbon: folds up by octaves
    const folded = await readHz("ribbon35");
    await midi([0xb0, 64, 127]); await midi([0x80, 36, 0]);
    await p.waitForTimeout(200);
    const pedalHeld = [await p.evaluate(() => [synths.ribbon35.hold, synths.ribbon35.params.gate]), await rms(p, "ribbon35")];
    await midi([0xb0, 64, 0]);
    await midi([0xb0, 1, 127]);
    const modWheel = await p.evaluate(() => synths.ribbon35.params.lfo_int);
    await midi([0xb0, 1, 0]);
    check(`[${name}] MIDI: C4 plays 261.6 Hz on Pulsar`, Math.abs(c4[0] - 261.6) < 0.2 && c4[1] === 1, `(${c4})`);
    check(`[${name}] MIDI: last-note priority returns to E4`, Math.abs(backTo64 - 329.6) < 0.2, `(${backTo64})`);
    check(`[${name}] MIDI: pitch bend +2 semitones`, Math.abs(bent - 370.0) < 0.3, `(${bent})`);
    check(`[${name}] MIDI: all notes off closes the gate`, offGate === 0);
    check(`[${name}] MIDI: out-of-range C2 folds to C4`, Math.abs(folded - 261.6) < 0.2, `(${folded})`);
    check(`[${name}] MIDI: sustain pedal holds the note`, pedalHeld[0][0] === true && pedalHeld[0][1] === 1 && pedalHeld[1] > 0.02, `(${pedalHeld})`);
    check(`[${name}] MIDI: mod wheel sets LFO Int.`, Math.abs(modWheel - 1) < 1e-6);
    await p.click("#delay-ribbon");                        // Singularity gets the keys
    await midi([0x90, 33, 100]);
    const a1 = await readHz("delay");
    await midi([0x80, 33, 0]);
    check(`[${name}] MIDI: A1 plays the bottom of Singularity's ribbon (55 Hz)`, Math.abs(a1 - 55) < 0.05, `(${a1})`);
    await p.click("#ribbon35-presets button:text-is(\"Init\")");

    // ---- Recording ----
    await p.locator("#rec-btn").scrollIntoViewIfNeeded();
    await p.click("#rec-btn");
    await p.click("#ribbon35-ribbon");                     // keys back to Pulsar
    await midi([0x90, 57, 100]); await p.waitForTimeout(1000); await midi([0x80, 57, 0]);
    await p.waitForTimeout(300);
    await p.locator("#rec-btn").scrollIntoViewIfNeeded();
    await p.click("#rec-btn");
    await p.waitForFunction(() => !document.querySelector("#rec-save").disabled, null, { timeout: 5000 });
    const take = await p.evaluate(() => { const t = recorder.take(); return { frames: t.frames, sr: t.sampleRate }; });
    const [download] = await Promise.all([p.waitForEvent("download"), p.click("#rec-save")]);
    const wavPath = await download.path();
    const wav = fs.readFileSync(wavPath);
    const wavOk = wav.toString("ascii", 0, 4) === "RIFF" && wav.toString("ascii", 8, 12) === "WAVE" && wav.readUInt16LE(22) === 2
      && wav.readUInt32LE(24) === take.sr && wav.readUInt32LE(40) === take.frames * 4 && wav.length === 44 + take.frames * 4;
    let peak = 0; for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    const seconds = take.frames / take.sr;
    check(`[${name}] Recording: take length matches what was played (~1.4 s)`, seconds > 1.0 && seconds < 3.0, `(${seconds.toFixed(2)} s)`);
    check(`[${name}] Recording: saves a valid 16-bit stereo WAV with audio`, wavOk && /^constellation-.*\.wav$/.test(download.suggestedFilename()) && peak > 1000, `(${download.suggestedFilename()}, ${wav.length} bytes, peak ${peak})`);

    // The viewer saves a .zip holding the WAV: check that zip with Python's zipfile.
    const zipB64 = await p.evaluate(async () => {
      const t = recorder.take(), w = recorder.encodeWav(t.chunks, t.frames, t.sampleRate);
      const buf = new Uint8Array(await recorder.zipStore("take.wav", w).arrayBuffer());
      let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const zipPath = path.join(require("os").tmpdir(), `ribbon35-test-${name}.zip`);
    fs.writeFileSync(zipPath, Buffer.from(zipB64, "base64"));
    const zipCheck = require("child_process").execFileSync("python3", ["-I", "-c",
      "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() is None, z.namelist(), z.read('take.wav')==open(sys.argv[2],'rb').read())",
      zipPath, wavPath]).toString().trim();
    check(`[${name}] Recording: viewer zip is valid and holds the identical WAV`, zipCheck === "True ['take.wav'] True", `(${zipCheck})`);

    // ---- Nebula (Airwindows reverbs) ----
    const knobs = (k) => p.evaluate((key) => [...document.querySelectorAll(`#${key} .knob-label`)].map((e) => e.textContent), k);
    const knobText = (k, label) => p.evaluate(([key, l]) => [...document.querySelectorAll(`#${key} .knob`)].find((e) => e.querySelector(".knob-label").textContent === l).querySelector(".knob-value").textContent, [k, label]);
    const pick = async (k, module) => {
      const i = await p.evaluate(([key, m]) => synths[key].spec.algorithms.findIndex((a) => a.module === m), [k, module]);
      await p.selectOption(`#${k}-algo`, String(i));
    };
    const nebulaIdle = await loudest(() => rms(p, "nebula"));
    const galactic = await knobs("nebula");
    await p.evaluate(() => synths.nebula.setKnob("p0", 0.2));
    await pick("nebula", "Infinity");
    const infinity = [await knobs("nebula"), await p.evaluate(() => document.querySelector("#nebula [data-role=title]").textContent)];
    await pick("nebula", "StarChild2");
    const starchild = await knobs("nebula");
    await pick("nebula", "PocketVerbs");
    const pocket = [await knobs("nebula"), await knobText("nebula", "Type")];
    await pick("nebula", "Galactic3");
    const remembered = await p.evaluate(() => synths.nebula.params.p0);
    await p.click("#nebula [data-step='1']");
    const stepped = await p.evaluate(() => synths.nebula.spec.algorithms[synths.nebula.params.mode].module);
    await p.click("#nebula [data-step='-1']");
    const count = await p.evaluate(() => document.querySelectorAll("#nebula-algo option").length);
    check(`[${name}] Nebula is silent at load`, nebulaIdle < 0.001, `(rms ${nebulaIdle.toExponential(1)})`);
    check(`[${name}] Nebula offers all ${count} Airwindows reverbs`, count === 43);
    check(`[${name}] Nebula's selector loads each plugin's own controls`,
      galactic.join() === "Replace,Bright,Detune,Derez,Bigness,Dry/Wet" && infinity[0].join() === "Filter,Damping,Size,Dry/Wet"
      && infinity[1] === "Airwindows · Infinity" && starchild.join() === "Sustain,Grain,Dry/Wet", `(${galactic} | ${infinity[0]} | ${starchild})`);
    check(`[${name}] Nebula shows a plugin's own readouts`, pocket[0].join() === "Type,Size,Gating,Dry/Wet" && pocket[1] === "Chamber", `(${pocket[0]}: Type ${pocket[1]})`);
    check(`[${name}] Nebula's step buttons move through the list`, stepped === "Galactic2", `(${stepped})`);
    check(`[${name}] Nebula keeps each reverb's settings`, Math.abs(remembered - 0.2) < 1e-6, `(${remembered})`);

    await p.click("#ribbon35-presets button:text-is(\"Init\")");
    await p.click("#ribbon35-hold");
    await press("#ribbon35-ribbon", 0.4, 150);
    await p.click("#ribbon35-send-nebula");
    await p.waitForTimeout(700);
    const verb = {
      direct: await p.evaluate(() => synths.ribbon35.out.gain.value),
      nebula: await loudest(() => rms(p, "nebula")),
      master: await loudest(masterRms),
      label: await p.evaluate(() => synths.nebula.lineInText.textContent),
    };
    check(`[${name}] To Nebula: Pulsar plays through the reverb`, verb.direct < 0.01 && verb.nebula > 0.02 && verb.master > 0.02, `(Nebula ${verb.nebula.toFixed(3)}, master ${verb.master.toFixed(3)})`);
    check(`[${name}] To Nebula: Nebula shows "Line in ◂ Pulsar"`, verb.label === "Line in ◂ Pulsar", `(${verb.label})`);
    // every plugin, while sounding
    const nebulaQuiet = [];
    const nebulaModules = await p.evaluate(() => synths.nebula.spec.algorithms.map((a) => a.module));
    for (const m of nebulaModules) {
      await pick("nebula", m);
      await p.waitForTimeout(name === "desktop" ? 120 : 60);
      if (await loudest(() => rms(p, "nebula")) < 0.005) nebulaQuiet.push(m);
    }
    await pick("nebula", "Galactic3");
    await p.waitForTimeout(300);
    const afterSwitching = await loudest(() => rms(p, "nebula"));
    check(`[${name}] Nebula keeps sounding through all its reverbs`, afterSwitching > 0.02 && nebulaQuiet.length <= 2, `(rms ${afterSwitching.toFixed(3)}; quiet: ${nebulaQuiet.join(", ") || "none"})`);
    await p.click("#ribbon35-hold");                       // release: the reverb tail rings on
    await p.waitForTimeout(300);
    const verbTail = await loudest(() => rms(p, "nebula"));
    check(`[${name}] Nebula's tail rings on after release`, verbTail > 0.005, `(rms ${verbTail.toFixed(4)})`);
    await p.click("#ribbon35-send-nebula");

    // ---- Aurora (Faust, Texture) ----
    const auroraIdle = await loudest(() => rms(p, "aurora"));
    const plate = [await knobs("aurora"), await knobText("aurora", "Predelay"), await knobText("aurora", "Mix")];
    await pick("aurora", "zita");
    const zita = [await knobs("aurora"), await knobText("aurora", "Low X"), await p.evaluate(() => document.querySelector("#aurora [data-role=credit]").textContent)];
    await pick("aurora", "plate");
    check(`[${name}] Aurora is silent at load`, auroraIdle < 0.001, `(rms ${auroraIdle.toExponential(1)})`);
    check(`[${name}] Aurora: Plate's controls read in their units`, plate[0].join() === "Mix,Predelay,Decay,Damping,Diffusion,Tone" && plate[1] === "0.0 ms" && plate[2] === "35%", `(${plate.join(" | ")})`);
    check(`[${name}] Aurora: Zita's controls and credit`, zita[0].join() === "Mix,Predelay,Low decay,Mid decay,Low X,Damping" && zita[1] === "200 Hz" && /Adriaensen/.test(zita[2]), `(${zita.join(" | ")})`);

    await p.click("#ribbon35-hold");
    await press("#ribbon35-ribbon", 0.4, 150);
    await p.click("#ribbon35-send-aurora");
    await p.waitForTimeout(700);
    const aurora = { level: await loudest(() => rms(p, "aurora")), label: await p.evaluate(() => synths.aurora.lineInText.textContent) };
    check(`[${name}] To Aurora: Pulsar plays through it`, aurora.level > 0.02 && aurora.label === "Line in ◂ Pulsar", `(rms ${aurora.level.toFixed(3)}, ${aurora.label})`);
    const auroraQuiet = [];
    const auroraModules = await p.evaluate(() => synths.aurora.spec.algorithms.map((a) => a.module));
    for (const m of auroraModules) {
      await pick("aurora", m);
      await p.waitForTimeout(200);
      if (await loudest(() => rms(p, "aurora")) < 0.005) auroraQuiet.push(m);
    }
    check(`[${name}] Aurora sounds on every reverb`, auroraQuiet.length === 0, `(quiet: ${auroraQuiet.join(", ") || "none"})`);
    await p.click("#aurora-presets button:text-is(\"Black hole\")");
    await p.waitForTimeout(300);
    const preset = await p.evaluate(() => [synths.aurora.spec.algorithms[synths.aurora.params.mode].module, synths.aurora.params.p3]);
    check(`[${name}] Aurora preset picks its reverb and settings`, preset[0] === "greyhole" && Math.abs(preset[1] - 0.9) < 1e-6, `(${preset})`);
    await p.click("#ribbon35-hold");
    await p.waitForTimeout(400);
    const auroraTail = await loudest(() => rms(p, "aurora"));
    check(`[${name}] Aurora's tail rings on after release`, auroraTail > 0.005, `(rms ${auroraTail.toFixed(4)})`);
    await p.click("#ribbon35-send-aurora");

    await p.click("#ribbon35-send-delay");                 // chain: Pulsar -> Singularity -> Nebula -> Aurora
    await p.click("#delay-send-nebula");
    await p.click("#nebula-send-aurora");
    await p.click("#ribbon35-hold");
    await press("#ribbon35-ribbon", 0.5, 150);
    await p.waitForTimeout(700);
    const verbChain = [await p.evaluate(() => [synths.delay.lineInText.textContent, synths.nebula.lineInText.textContent, synths.aurora.lineInText.textContent]), await loudest(() => rms(p, "aurora")), await p.evaluate(() => synths.nebula.out.gain.value)];
    check(`[${name}] chain Pulsar -> Singularity -> Nebula -> Aurora`, verbChain[0].join() === "Line in ◂ Pulsar,Line in ◂ Singularity,Line in ◂ Nebula" && verbChain[1] > 0.02 && verbChain[2] < 0.01, `(${verbChain[0]}, ${verbChain[1].toFixed(3)})`);
    await p.click("#ribbon35-hold"); await p.click("#nebula-send-aurora"); await p.click("#delay-send-nebula"); await p.click("#ribbon35-send-delay");

    if (shots) await p.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`[${name}] no horizontal page scroll`, !overflow);
    await ctx.close();
  }
  check("no console or page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})();
