// Phone touch: a vertical swipe on a panel scrolls the page, except where it
// starts on something played by touch. Knobs turn only from a touch near the
// centre; the rest of the knob, its label and the gaps are a buffer that
// scrolls. Touches are sent as raw touch events (as a finger makes them).
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require(require.resolve("playwright", { paths: [process.execPath + "/../../lib/node_modules"] }));

const page = fs.readFileSync(path.join(__dirname, "../dist/constellation.html"), "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${page}</body></html>`;

(async () => {
  const server = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); }).listen(0);
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${server.address().port}/`);
  const cdp = await ctx.newCDPSession(p);
  await p.evaluate(() => { document.documentElement.style.scrollSnapType = "none"; });   // measure the scroll itself
  const swipe = async (x, y) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 15 }] }); await p.waitForTimeout(16); }
    await p.waitForTimeout(60);
    const gate = await p.evaluate(() => synths.duo.params.gate);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return gate;
  };
  const box = (sel) => p.locator(sel).boundingBox();
  const spots = [
    ["the gap beside a panel", true, async () => { const a = await p.locator("#duo-knob-cutoff").locator("xpath=ancestor::*[contains(@class,'group')][1]").boundingBox(); return [a.x + a.width + 3, a.y + 40]; }],
    ["a knob's label", true, async () => { const a = await box("#duo-knob-cutoff + .knob-label"); return [a.x + a.width / 2, a.y + a.height / 2]; }],
    ["a knob's edge (the buffer)", true, async () => { const a = await box("#duo-knob-cutoff"); return [a.x + 4, a.y + a.height / 2]; }],
    ["the scope", true, async () => { const a = await p.locator("#duo-ribbon").locator("xpath=ancestor::*[contains(@class,'device')][1]").locator("canvas[data-role=scope]").boundingBox(); return [a.x + a.width / 2, a.y + a.height / 2]; }],
    ["a knob's centre", false, async () => { const a = await box("#duo-knob-cutoff"); return [a.x + a.width / 2, a.y + a.height / 2]; }],
    ["an envelope fader", false, async () => { const a = await box("#duo-knob-release"); return [a.x + a.width / 2, a.y + a.height * 0.9]; }],
    ["the ribbon", false, async () => { const a = await box("#duo-ribbon"); return [a.x + a.width / 2, a.y + a.height * 0.8]; }],
  ];
  let failed = 0;
  for (const [name, scrolls, at] of spots) {
    await p.evaluate(() => scrollTo(0, synths.duo.el.getBoundingClientRect().top + scrollY - 60)); await p.waitForTimeout(300);
    const [x, y] = await at();
    const before = await p.evaluate(() => [scrollY, synths.duo.params.cutoff, synths.duo.params.release]);
    const gate = await swipe(Math.round(x), Math.round(y));
    await p.waitForTimeout(300);
    const after = await p.evaluate(() => [scrollY, synths.duo.params.cutoff, synths.duo.params.release]);
    const moved = after[0] - before[0], touched = after[1] !== before[1] || after[2] !== before[2] || gate === 1;
    const ok = scrolls ? moved > 50 && !touched : moved === 0 && touched;
    console.log(`${ok ? "PASS" : "FAIL"}  swipe on ${name} ${scrolls ? "scrolls the page" : "plays it, not the page"} (scrolled ${Math.round(moved)}px, control ${touched ? "moved" : "untouched"})`);
    if (!ok) failed++;
    await p.evaluate(() => { synths.duo.setKnob("cutoff", 0.6); synths.duo.setKnob("release", 0); });
  }
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})();
