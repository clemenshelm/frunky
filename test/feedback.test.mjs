// The feedback loop (build 69). Motown ran a quality-control meeting every
// Friday; ours ran on one channel — field verdicts arriving as prose, days
// later, with no timestamp attached. Two mechanisms close that gap:
//
//   1. The DRIVE gets two thumbs in the drive display. Nobody types at the
//      wheel, so a thumb is one tap and lands as a trace EVENT — kind
//      "thumb", code up/down, n = the piece number — with the drive's own
//      millisecond clock on it. What exactly was meant stays a guess, but a
//      guess ANCHORED to a moment, a piece and the surrounding samples; over
//      many drives the pattern is the answer.
//   2. The BENCH gets thumbs plus a text box: it runs on a computer, where
//      typing is fine, and posts to the collector's own /api/v1/feedback —
//      the bench has no tracer, so without this its verdicts never reach us.
//
// The text field is the feedback spec's ONE free-text field and it is a
// different animal from a trace msg: it is typed BY the operator INTO a box
// labelled feedback, first-person authorship rather than telemetry echo. So
// digits survive ("the drop at 2:31 cracks") where a trace msg would shed
// them — but it is still bounded, control-stripped, and declared openly.
import { readFileSync } from "node:fs";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../collector/store.mjs";
import { createApp } from "../collector/app.mjs";
import { SCHEMA } from "../collector/schema.mjs";

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };
const eq = (label, a, b) => ok(label + " (got " + JSON.stringify(a) + ")", a === b);

const S = SCHEMA;
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

// ---- 1. the feedback spec exists and walks like the trace spec --------------
ok("redactFeedback is exported", typeof S.redactFeedback === "function");
ok("the feedback spec is exported for the sweep to walk",
  S.FEEDBACK_SPEC && typeof S.FEEDBACK_SPEC === "object");
ok("the feedback free-text list names exactly the text box",
  Array.isArray(S.FEEDBACK_FREE_TEXT_FIELDS) &&
  S.FEEDBACK_FREE_TEXT_FIELDS.length === 1 &&
  S.FEEDBACK_FREE_TEXT_FIELDS[0] === "text");
ok("and the TRACE free-text list did not grow for it",
  S.FREE_TEXT_FIELDS.length === 2);

const validFeedback = (over) => Object.assign({
  v: 1,
  id: S.newTraceId(),
  build: "69",
  verdict: "up",
  text: "Der Drop bei 2:31 kracht endlich richtig!",
  ctx: { num: 3, part: "B", recipe: "soul", mood: "anthem",
    scene: "cruise", kmh: 128 },
}, over);

// ---- 2. a well-formed verdict passes whole ---------------------------------
{
  const r = S.redactFeedback(validFeedback());
  ok("a well-formed feedback is accepted", r.ok);
  const f = r.feedback;
  eq("the verdict survives", f && f.verdict, "up");
  ok("digits survive in the text — 2:31 is the whole point",
    !!f && f.text.includes("2:31"));
  eq("the piece number survives", f && f.ctx && f.ctx.num, 3);
  eq("the recipe word survives", f && f.ctx && f.ctx.recipe, "soul");
  eq("the simulated speed survives", f && f.ctx && f.ctx.kmh, 128);
}

// ---- 3. the verdict is load-bearing ----------------------------------------
{
  ok("a text-only note is a valid verdict",
    S.redactFeedback(validFeedback({ verdict: "note" })).ok);
  ok("down is a valid verdict",
    S.redactFeedback(validFeedback({ verdict: "down" })).ok);
  ok("an unknown verdict refuses the record, not just the field",
    !S.redactFeedback(validFeedback({ verdict: "hack" })).ok);
  ok("a missing id refuses the record",
    !S.redactFeedback(validFeedback({ id: undefined })).ok);
  ok("a wrong schema version refuses the record",
    !S.redactFeedback(validFeedback({ v: 2 })).ok);
}

// ---- 4. the text is bounded and control-stripped, never letter-starved ------
{
  const long = S.redactFeedback(validFeedback({ text: "x".repeat(5000) }));
  ok("the text is capped", long.ok && long.feedback.text.length <= S.FEEDBACK_TEXT_MAX);
  const ctrl = S.redactFeedback(validFeedback({ text: "a\u0000b\u0007c\nd" }));
  ok("control characters are stripped, words survive",
    ctrl.ok && !/[\u0000-\u001f\u007f]/.test(ctrl.feedback.text) &&
    ctrl.feedback.text.includes("a") && ctrl.feedback.text.includes("d"));
  const none = S.redactFeedback(validFeedback({ text: 42 }));
  ok("a non-string text becomes empty, not a crash", none.ok && none.feedback.text === "");
}

// ---- 5. ctx fields are shapes, not free text --------------------------------
{
  const r = S.redactFeedback(validFeedback({
    ctx: { num: 99999, part: "B!", recipe: "Soul<script>", mood: "deep",
      scene: "cruise", kmh: 9999, secret: "sk-live-9" },
  }));
  ok("ctx words must be plain letters — a shaped token or nothing",
    r.ok && r.feedback.ctx.recipe === "" && r.feedback.ctx.part === "");
  ok("ctx ints are clamped", r.ok && r.feedback.ctx.kmh <= 300);
  ok("an undeclared ctx field is dropped, and recorded as dropped",
    r.ok && !("secret" in r.feedback.ctx) &&
    r.dropped.some((d) => d.includes("secret")));
}

// ---- 6. the poison sweep, same doctrine as the trace ------------------------
{
  const poisons = [];
  let pn = 0;
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const poison = () => {
    const p = "FBZ" + letters[pn % 26] + letters[Math.floor(pn / 26) % 26] + "SECRET";
    pn++; poisons.push(p); return p;
  };
  const poisonField = (field) => {
    if (!field || typeof field !== "object") return poison();
    if (field.t === "obj") {
      const out = {};
      for (const k of Object.keys(field.fields)) out[k] = poisonField(field.fields[k]);
      return out;
    }
    // a word field is a DECLARED bounded token channel — a plain word passes
    // it by design. The sweep's job there is the shape rule: a value that is
    // not a plain word must vanish entirely, digits, spaces and all
    if (field.t === "word") return poison() + "9 leak";
    return poison();
  };
  const poisoned = {};
  for (const k of Object.keys(S.FEEDBACK_SPEC)) poisoned[k] = poisonField(S.FEEDBACK_SPEC[k]);
  poisoned.v = 1;
  poisoned.id = "a1b2c3d4e5f60718";
  poisoned.verdict = "up";
  for (const f of S.FEEDBACK_FREE_TEXT_FIELDS) poisoned[f] = "";
  const swept = JSON.stringify(S.redactFeedback(poisoned).feedback);
  const leaked = poisons.filter((p) => swept.includes(p));
  ok("no poisoned feedback leaf survives (" + leaked.length + " leaked)",
    poisons.length >= 5 && leaked.length === 0);
}

// ---- 7. the store keeps feedback in its own file family --------------------
{
  const dir = mkdtempSync(join(tmpdir(), "frunky-fb-"));
  let clock = Date.UTC(2026, 7, 14, 9, 0, 0);
  const traces = createStore({ dir, now: () => clock });
  const feedback = createStore({ dir, now: () => clock, prefix: "feedback" });
  traces.append({ id: "aaaaaaaaaaaaaaaa", build: "69" });
  feedback.append({ id: "bbbbbbbbbbbbbbbb", build: "69", verdict: "up", text: "hi" });
  const files = readdirSync(dir).sort();
  ok("two file families, one per store, got " + files.join(","),
    files.some((f) => /^frunky-\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)) &&
    files.some((f) => /^feedback-\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)));
  ok("the trace store never reads the feedback family",
    traces.list().length === 1 && traces.list()[0].id === "aaaaaaaaaaaaaaaa");
  ok("the feedback store never reads the trace family",
    feedback.list().length === 1 && feedback.list()[0].id === "bbbbbbbbbbbbbbbb");
}

// ---- 8. the collector ingests, erases and shows feedback --------------------
{
  const dir = mkdtempSync(join(tmpdir(), "frunky-fb-"));
  let clock = Date.UTC(2026, 7, 14, 9, 0, 0);
  const store = createStore({ dir, now: () => clock });
  const feedback = createStore({ dir, now: () => clock, prefix: "feedback" });
  const app = createApp({ store, feedback, now: () => clock,
    origins: ["https://frunky.clemenshelm.com"],
    viewer: { user: "u", pass: "p" } });
  const call = (method, path, body, headers) => app.handle({
    method, path,
    headers: Object.assign({ "content-type": "application/json",
      origin: "https://frunky.clemenshelm.com" }, headers || {}),
    body: body === undefined ? "" : (typeof body === "string" ? body : JSON.stringify(body)),
  });

  const fb = validFeedback();
  const res = await call("POST", "/api/v1/feedback", fb);
  eq("a valid feedback is accepted", res.status, 204);
  const bytes = readdirSync(dir).filter((f) => f.startsWith("feedback-"))
    .map((f) => readFileSync(join(dir, f), "utf8")).join("");
  ok("the text reaches the disk", bytes.includes("2:31"));
  ok("the arrival is stamped to the hour",
    feedback.list().every((r) => r.at % 3600e3 === 0));

  const bad = await call("POST", "/api/v1/feedback", validFeedback({ verdict: "hack" }));
  eq("an invalid verdict is refused", bad.status, 400);
  const extra = validFeedback({ id: "cccccccccccccccc" });
  extra.smuggled = "sk-live-泄漏";
  await call("POST", "/api/v1/feedback", extra);
  const bytes2 = readdirSync(dir).filter((f) => f.startsWith("feedback-"))
    .map((f) => readFileSync(join(dir, f), "utf8")).join("");
  ok("an undeclared field never reaches the disk", !bytes2.includes("sk-live"));

  const del = await call("DELETE", "/api/v1/feedback/" + fb.id);
  eq("erasure answers 204", del.status, 204);
  ok("and the record is gone", !feedback.list().some((r) => r.id === fb.id));

  const auth = "Basic " + Buffer.from("u:p").toString("base64");
  const view = await call("GET", "/", undefined, { authorization: auth });
  ok("the viewer shows the surviving feedback",
    view.status === 200 && String(view.body).includes("2:31"));
  const noAuth = await call("GET", "/");
  eq("the feedback stays behind the same password", noAuth.status, 401);
  // the viewer is the one place feedback text meets HTML — it must arrive
  // escaped, or the collector executes whatever the bench was told to send
  const xss = validFeedback({ id: "dddddddddddddddd",
    text: 'boese <img src=x onerror=alert(1)> zeile' });
  await call("POST", "/api/v1/feedback", xss);
  const view2 = await call("GET", "/", undefined, { authorization: auth });
  ok("feedback text is escaped in the viewer",
    !String(view2.body).includes("<img src=x") &&
    String(view2.body).includes("&lt;img"));
}

// ---- 9. the thumb is a trace event, with the piece number on it -------------
{
  ok("the event vocabulary knows the thumb", S.EVENT_KINDS.includes("thumb"));
  ok("and both directions", S.EVENT_CODES.includes("up") && S.EVENT_CODES.includes("down"));
  const t = {
    v: 1, id: S.newTraceId(), build: "69", platform: "desktop", lite: false,
    samples: [{ t: 0, speed: 3, scene: "cruise", load: 5, notes: 40, strain: 0,
      late: 0, stalls: 0, errors: 0, resumes: 0, fixAge: 400, gps: "coords",
      lt: 0, rcp: 4 }],
    events: [{ t: 61000, kind: "thumb", code: "up", n: 7 }],
    msgs: [],
  };
  const r = S.redactTrace(t);
  ok("a thumb event passes redaction whole", r.ok &&
    r.trace.events.length === 1 && r.trace.events[0].kind === "thumb" &&
    r.trace.events[0].code === "up" && r.trace.events[0].n === 7);
  eq("the sample carries the recipe index", r.trace.samples[0].rcp, 4);
  const old = S.redactTrace(Object.assign({}, t, {
    samples: [{ t: 0, speed: 3, scene: "cruise", load: 5, notes: 40, strain: 0,
      late: 0, stalls: 0, errors: 0, resumes: 0, fixAge: 400, gps: "coords", lt: 0 }] }));
  eq("a pre-69 sample reads as 'no probe', never as recipe zero",
    old.trace.samples[0].rcp, -1);
}

// ---- 9b. the tracer forwards the recipe index -------------------------------
{
  globalThis.window = globalThis;
  (0, eval)(read("../trace-schema.js"));
  (0, eval)(read("../trace.js"));
  const T = globalThis.FrunkyTrace;
  const tr = T.create({ endpoint: "https://x.example/t", build: "69",
    userAgent: "TestUA", fetch: async () => ({ ok: true }) });
  tr.setConsent(true);
  tr.begin({});
  tr.sample({ speed: 10, rcp: 4 });
  tr.sample({ speed: 10 });               // a caller that never heard of it
  const snap = tr.snapshot();
  eq("the tracer forwards rcp", snap.samples[0].rcp, 4);
  eq("and no-probe stays -1, never recipe zero", snap.samples[1].rcp, -1);
  tr.end("user", {});
}

// ---- 10. the pages carry the surfaces ---------------------------------------
{
  const page = read("../index.html");
  ok("the drive display holds both thumbs",
    /id="thumbUp"/.test(page) && /id="thumbDown"/.test(page));
  ok("a thumb lands as a trace event with the piece number",
    /tracer\.event\("thumb", "up"/.test(page) &&
    /tracer\.event\("thumb", "down"/.test(page));
  ok("the samples carry the recipe index", /rcp:/.test(page));

  const bench = read("../bench.html");
  ok("the bench holds thumbs, a text box and a send button",
    /id="fbUp"/.test(bench) && /id="fbDown"/.test(bench) &&
    /id="fbText"/.test(bench) && /id="fbSend"/.test(bench));
  ok("the bench posts to the collector's feedback endpoint",
    bench.includes("https://frunky.clemenshelm.com/api/v1/feedback"));
  ok("the bench loads the schema for id minting",
    /trace-schema\.js\?v=/.test(bench));

  const server = read("../collector/server.mjs");
  ok("the server wires a feedback store into the app",
    /prefix:\s*"feedback"/.test(server) && /feedback/.test(server));

  const appSrc = read("../collector/app.mjs");
  ok("the viewer marks thumb events apart from the yellow diagnostics",
    /thumb/.test(appSrc));
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("FEEDBACK_OK");
