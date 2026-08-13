// The Tesla probe — a repeatably slow browser (Build 65).
//
// Field question: "can you simulate the Tesla browser, so we can always
// test whether it runs smoothly there?" Yes, for the half that matters
// most: the Tesla MCU is a weak x86 running plain Chromium, and Chromium
// exposes CPU throttling over the DevTools protocol. Throttling a laptop
// 12-16x lands in head-unit territory. What this CANNOT simulate, said
// plainly: the Tesla's tab-killing policies, its audio-output path, and
// its thermal behavior — the field traces stay the ground truth for "why
// did it die"; this probe answers "does the ENGINE keep up on a weak CPU".
//
//   node tools/tesla-probe.mjs [--rates 1,8,16] [--secs 30]
//
// It serves the WORKING TREE (uncommitted changes included), launches the
// installed Chrome headless with autoplay allowed and audio muted, applies
// each throttle rate, drives a simulated town+highway run, and reads the
// engine's own health: errors, late steps, worst lateness, notes flowing,
// lean (strain shed) engagement, heap. Verdict per rate; exit 1 if the
// highest rate errors out or the music stops flowing.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), ".."));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const RATES = opt("rates", "1,8,16").split(",").map(Number);
const SECS = Number(opt("secs", "30"));
const CHROME = opt("chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

const MIME = { ".html": "text/html", ".js": "text/javascript",
  ".json": "application/json", ".mp3": "audio/mpeg", ".css": "text/css" };
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url.split("?")[0]));
  const file = join(ROOT, path === "/" ? "bench.html" : path);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required",
    "--no-first-run", "--disable-extensions"],
});

let fail = false;
const results = [];
try {
  for (const rate of RATES) {
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await page.goto(`http://127.0.0.1:${port}/bench.html`, { waitUntil: "load" });
    const r = await page.evaluate(async (secs) => {
      const F = window.Frunky;
      await F.start();
      let phase = 0, speed = 30;
      const iv = setInterval(() => {
        phase += 0.04;
        speed = phase % 3 < 1.4 ? 60 : 135; // town <-> highway
        for (let i = 0; i < 8; i++) F.update(0.05, { speed, lateralG: 0 });
      }, 30);
      let leanTicks = 0, ticks = 0;
      const leanIv = setInterval(() => {
        ticks++;
        if (F.__set().lean) leanTicks++;
      }, 500);
      const notesMid = new Promise((res) =>
        setTimeout(() => res(F.health().notes), secs * 1000 * 0.7));
      await new Promise((res) => setTimeout(res, secs * 1000));
      clearInterval(iv); clearInterval(leanIv);
      const h = F.health();
      const midNotes = await notesMid;
      F.stop();
      return { errors: h.errors, lateSteps: h.lateSteps, worstLate: h.worstLate,
        notes: h.notes, notesLastThird: h.notes - midNotes,
        heap: h.heap, leanPct: Math.round(100 * leanTicks / Math.max(ticks, 1)) };
    }, SECS);
    await page.close();
    r.rate = rate;
    // the verdict: the music must keep flowing and never error. Late steps
    // are the early warning, not the failure — lean exists to absorb them
    r.ok = r.errors === 0 && r.notesLastThird > 20;
    results.push(r);
    console.log(`rate ${String(rate).padStart(2)}x  ` +
      `errors ${r.errors}  late ${r.lateSteps} (worst ${Math.round(r.worstLate)}ms)  ` +
      `notes ${r.notes} (last third ${r.notesLastThird})  ` +
      `lean ${r.leanPct}%  heap ${r.heap}MB  ${r.ok ? "OK" : "FAIL"}`);
    if (!r.ok) fail = true;
  }
} finally {
  await browser.close();
  server.close();
}
console.log(fail ? "TESLA_PROBE_FAIL" : "TESLA_PROBE_OK");
process.exit(fail ? 1 : 0);
