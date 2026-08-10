// The collector, which is the only machine we operate that ever sees a trace.
//
// Everything it promises is a promise about what it does NOT do, and those are
// the hard ones to believe from reading code — so each is asserted against the
// bytes that really end up on disk rather than against the handler's intent:
//
//   * no IP address is stored, logged, or derivable from what is stored
//   * nothing outside the schema is stored, however it was sent
//   * a record disappears when its retention runs out, without anyone acting
//   * a record disappears immediately when its own id asks for it
//
// The store is a directory of newline-delimited JSON, one file per day, because
// retention then is a file deletion rather than a query nobody remembers to run.
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../collector/store.mjs";
import { createApp } from "../collector/app.mjs";
import { SCHEMA } from "../collector/schema.mjs";

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };
const eq = (label, a, b) => ok(label + " (got " + JSON.stringify(a) + ")", a === b);

const HOUR = 3600e3, DAY = 24 * HOUR;
let dirs = [];
const freshDir = () => { const d = mkdtempSync(join(tmpdir(), "frunky-trace-")); dirs.push(d); return d; };
const allBytes = (dir) => readdirSync(dir)
  .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");

// ---- the schema really is the client's schema, not a copy ------------------
// A second definition would drift, and a drifted server-side filter is a filter
// that passes what the client stopped sending — the exact opposite of a check.
{
  ok("the collector shares the browser's schema object",
    typeof SCHEMA.redactTrace === "function" && SCHEMA.VERSION === 1);
  const src = readFileSync(new URL("../collector/schema.mjs", import.meta.url), "utf8");
  ok("and gets it from the one file, rather than restating it",
    src.includes("trace-schema.js"));
  ok("the collector does not define its own field list",
    !/SPEED_LABELS\s*=\s*\[/.test(src) && !/EVENT_KINDS\s*=\s*\[/.test(src));
}

const validTrace = (over) => Object.assign({
  v: 1,
  id: SCHEMA.newTraceId(),
  build: "18",
  platform: "tesla",
  lite: false,
  opts: { curveOutward: true, inertiaDepth: true },
  samples: [
    { t: 0, speed: 0, scene: "standstill", load: 3, notes: 0, strain: 0, late: 0,
      stalls: 0, errors: 0, resumes: 0, fixAge: 900, gps: "coords", lt: 120 },
    { t: 5000, speed: 5, scene: "city", load: 9, notes: 24, strain: 0, late: 0,
      stalls: 0, errors: 0, resumes: 0, fixAge: 500, gps: "coords", lt: 60 },
  ],
  events: [{ t: 3000, kind: "launch", n: 0, code: "" }],
  msgs: [],
  end: { t: 60000, reason: "user", freezes: 0, worstFreeze: 0, maxSpeed: 5,
    minNotes: 0, maxNotes: 31 },
}, over);

// a tiny in-process client: the app is a plain (method, path, headers, body)
// function so the tests never need a socket
const call = (app, method, path, body, headers) => app.handle({
  method, path,
  headers: Object.assign({ "content-type": "application/json" }, headers || {}),
  body: body === undefined ? "" : (typeof body === "string" ? body : JSON.stringify(body)),
});

// ---- ingest ---------------------------------------------------------------
{
  const dir = freshDir();
  let clock = Date.UTC(2026, 7, 11, 13, 41, 7, 512);
  const store = createStore({ dir, now: () => clock, retentionDays: 30 });
  const app = createApp({ store, now: () => clock, origins: ["https://clemenshelm.github.io"] });

  const t = validTrace();
  const res = await call(app, "POST", "/api/v1/trace", t,
    { origin: "https://clemenshelm.github.io" });
  eq("a valid trace is accepted", res.status, 204);
  eq("the allowed origin is echoed", res.headers["access-control-allow-origin"],
    "https://clemenshelm.github.io");

  const stored = store.list();
  eq("one record", stored.length, 1);
  eq("under its own id", stored[0].id, t.id);

  // arrival time is stamped to the hour: enough to find a report again, not
  // enough to time a journey
  eq("arrival is truncated to the hour", stored[0].at, Date.UTC(2026, 7, 11, 13, 0, 0, 0));
  ok("the minute and second are gone", !allBytes(dir).includes("41") ||
    !JSON.stringify(stored[0]).includes(String(Date.UTC(2026, 7, 11, 13, 41, 7, 512))));

  // an unknown origin is refused outright rather than answered helpfully
  const bad = await call(app, "POST", "/api/v1/trace", validTrace(),
    { origin: "https://evil.test" });
  eq("an unknown origin is refused", bad.status, 403);
  eq("still one record", store.list().length, 1);

  // preflight
  const pre = await call(app, "OPTIONS", "/api/v1/trace", "",
    { origin: "https://clemenshelm.github.io" });
  eq("preflight is answered", pre.status, 204);
  ok("naming the methods", (pre.headers["access-control-allow-methods"] || "").includes("POST"));
  ok("credentials are never allowed", !("access-control-allow-credentials" in pre.headers));
}

// ---- the promises about what is NOT kept -----------------------------------
{
  const dir = freshDir();
  let clock = Date.UTC(2026, 7, 11, 13, 0, 0, 0);
  const store = createStore({ dir, now: () => clock, retentionDays: 30 });
  const app = createApp({ store, now: () => clock, origins: ["https://clemenshelm.github.io"] });

  const poisoned = validTrace();
  poisoned.lat = 48.20849;
  poisoned.lon = 16.37208;
  poisoned.route = "A1 Wien Salzburg";
  poisoned.samples[0].heading = 271.5;
  poisoned.samples[0].kmh = 63.4;
  poisoned.events[0].stack = "at drive (/Users/clemens/frunky/engine.js:412:9)";
  poisoned.msgs = ["token sk-live-abcdefg leaked"];

  const res = await call(app, "POST", "/api/v1/trace", poisoned, {
    origin: "https://clemenshelm.github.io",
    "x-forwarded-for": "203.0.113.77, 198.51.100.4",
    "x-real-ip": "203.0.113.77",
    "user-agent": "Mozilla/5.0 (X11; GNU/Linux) Tesla/2024.44.25.2",
    "accept-language": "de-AT,de;q=0.9",
    cookie: "session=abc123",
  });
  eq("it is still accepted, minus the parts it may not have", res.status, 204);

  const bytes = allBytes(dir);
  for (const forbidden of [
    "203.0.113", "198.51.100",       // the addresses, in any header
    "48.208", "16.372", "A1 Wien",   // where the car was
    "271.5", "63.4",                 // heading and a raw speed
    "Users", "clemens", "engine.js", // a stack trace
    "Mozilla", "2024.44",            // the agent string
    "de-AT", "session=abc",          // language and cookies
    "sk-live",                       // and a secret-shaped token in a message
  ]) {
    ok("never written to disk: " + forbidden, !bytes.includes(forbidden));
  }
  ok("but the trace itself was written", bytes.includes(poisoned.id));
  ok("with its samples", bytes.includes("standstill"));

  // and the same for the file NAMES, which are just as much stored data
  ok("no file name carries an address",
    readdirSync(dir).every((f) => !/\d+\.\d+\.\d+\.\d+/.test(f)));
}

// ---- refusals --------------------------------------------------------------
{
  const dir = freshDir();
  const clock = Date.UTC(2026, 7, 11, 13, 0, 0, 0);
  const store = createStore({ dir, now: () => clock, retentionDays: 30 });
  const app = createApp({ store, now: () => clock, origins: ["https://clemenshelm.github.io"],
    maxBodyBytes: 4096, rateLimit: { perMinute: 5 } });
  const org = { origin: "https://clemenshelm.github.io" };

  eq("not JSON is a 400", (await call(app, "POST", "/api/v1/trace", "{oops", org)).status, 400);
  eq("wrong schema version is a 400",
    (await call(app, "POST", "/api/v1/trace", validTrace({ v: 9 }), org)).status, 400);
  eq("a malformed id is a 400",
    (await call(app, "POST", "/api/v1/trace", validTrace({ id: "../../etc/passwd" }), org)).status, 400);
  eq("an oversized body is a 413",
    (await call(app, "POST", "/api/v1/trace",
      JSON.stringify(validTrace({ msgs: ["x".repeat(9000)] })), org)).status, 413);
  eq("an unknown path is a 404", (await call(app, "GET", "/wp-admin", "", org)).status, 404);
  eq("nothing was stored by any of that", store.list().length, 0);

  // rate limiting, and the identity it limits on is not retained
  let last = 0;
  for (let i = 0; i < 12; i++) {
    last = (await call(app, "POST", "/api/v1/trace", validTrace(), org)).status;
  }
  eq("a flood is eventually refused", last, 429);
  ok("the limiter never persists what it counted",
    !allBytes(dir).includes("203.0.113") && !JSON.stringify(app.__rateKeys()).includes("."));
}

// ---- retention is a deletion, not a filter --------------------------------
{
  const dir = freshDir();
  let clock = Date.UTC(2026, 6, 1, 12, 0, 0, 0);
  const store = createStore({ dir, now: () => clock, retentionDays: 30 });
  const app = createApp({ store, now: () => clock, origins: ["*"] });

  const oldId = SCHEMA.newTraceId();
  await call(app, "POST", "/api/v1/trace", validTrace({ id: oldId }));
  eq("stored", store.list().length, 1);

  clock += 29 * DAY;
  eq("inside the window it survives a sweep", store.sweep(), 0);
  eq("and is still there", store.list().length, 1);

  const freshId = SCHEMA.newTraceId();
  await call(app, "POST", "/api/v1/trace", validTrace({ id: freshId }));

  clock += 2 * DAY;                       // the first record is now 31 days old
  const removed = store.sweep();
  ok("the expired record is swept (" + removed + ")", removed >= 1);
  const left = store.list();
  eq("only the fresh one remains", left.length, 1);
  eq("and it is the fresh one", left[0].id, freshId);
  ok("the expired record is gone from the bytes, not merely hidden",
    !allBytes(dir).includes(oldId));
}

// ---- erasure on request ---------------------------------------------------
{
  const dir = freshDir();
  const clock = Date.UTC(2026, 7, 11, 13, 0, 0, 0);
  const store = createStore({ dir, now: () => clock, retentionDays: 30 });
  const app = createApp({ store, now: () => clock, origins: ["*"] });

  const keep = SCHEMA.newTraceId(), drop = SCHEMA.newTraceId();
  await call(app, "POST", "/api/v1/trace", validTrace({ id: keep }));
  await call(app, "POST", "/api/v1/trace", validTrace({ id: drop }));
  eq("two records", store.list().length, 2);

  const res = await call(app, "DELETE", "/api/v1/trace/" + drop);
  eq("the erasure is acknowledged", res.status, 204);
  const left = store.list();
  eq("one record left", left.length, 1);
  eq("the right one", left[0].id, keep);
  ok("the erased id is gone from the bytes", !allBytes(dir).includes(drop));

  // an id that never existed is not a way to find out what does exist
  eq("erasing an unknown id answers the same way",
    (await call(app, "DELETE", "/api/v1/trace/" + SCHEMA.newTraceId())).status, 204);
  eq("a malformed id is refused",
    (await call(app, "DELETE", "/api/v1/trace/..%2F..%2Fetc%2Fpasswd")).status, 400);
  eq("and a path traversal cannot reach a file",
    (await call(app, "DELETE", "/api/v1/trace/../../etc/passwd")).status, 400);
}

// ---- the viewer is not public ---------------------------------------------
{
  const dir = freshDir();
  const clock = Date.UTC(2026, 7, 11, 13, 0, 0, 0);
  const store = createStore({ dir, now: () => clock, retentionDays: 30 });
  const app = createApp({ store, now: () => clock, origins: ["*"],
    viewer: { user: "frunky", pass: "s3cret-pass" } });
  await call(app, "POST", "/api/v1/trace", validTrace());

  const anon = await call(app, "GET", "/");
  eq("the viewer demands a password", anon.status, 401);
  ok("and says how", (anon.headers["www-authenticate"] || "").includes("Basic"));
  ok("the unauthenticated answer carries no trace data", !anon.body.includes("standstill"));

  const wrong = await call(app, "GET", "/", "",
    { authorization: "Basic " + Buffer.from("frunky:nope").toString("base64") });
  eq("a wrong password is refused", wrong.status, 401);

  const auth = { authorization: "Basic " + Buffer.from("frunky:s3cret-pass").toString("base64") };
  const good = await call(app, "GET", "/", "", auth);
  eq("the right one gets in", good.status, 200);
  ok("and sees the drives", good.body.includes("tesla"));
  ok("the viewer page is never framed or indexed",
    good.headers["x-frame-options"] === "DENY" &&
    (good.headers["x-robots-tag"] || "").includes("noindex"));

  const json = await call(app, "GET", "/api/v1/traces", "", auth);
  eq("the listing is JSON", json.status, 200);
  ok("with the record", JSON.parse(json.body).traces.length === 1);
  eq("and the listing needs the password too",
    (await call(app, "GET", "/api/v1/traces")).status, 401);

  // health is public on purpose — it says nothing about anybody
  const health = await call(app, "GET", "/api/health");
  eq("health is public", health.status, 200);
  ok("and boring", !health.body.includes("tesla"));
}

// ---- the store survives a corrupted line ----------------------------------
// A half-written line after a power cut must not take the whole day's file with
// it: the drives around it are still evidence.
{
  const dir = freshDir();
  const clock = Date.UTC(2026, 7, 11, 13, 0, 0, 0);
  const store = createStore({ dir, now: () => clock, retentionDays: 30 });
  const app = createApp({ store, now: () => clock, origins: ["*"] });
  await call(app, "POST", "/api/v1/trace", validTrace());
  await call(app, "POST", "/api/v1/trace", validTrace());

  const file = join(dir, readdirSync(dir)[0]);
  writeFileSync(file, readFileSync(file, "utf8") + '{"id":"broken",\n');
  eq("the readable records still read", store.list().length, 2);
  eq("and a sweep does not choke on it", typeof store.sweep(), "number");
}

// ---- and it really is a server ---------------------------------------------
// Everything above tests a function. This one binds a port and drives the whole
// thing the way the car will: the browser's own tracer, its own fetch, over a
// real socket, ending in bytes on a real disk. It is the only assertion here
// that "a working tracing system" is more than a set of green units.
{
  const { startServer } = await import("../collector/server.mjs");
  const dir = freshDir();
  const running = await startServer({
    dir, port: 0, host: "127.0.0.1", retentionDays: 30,
    origins: ["*"], viewer: { user: "", pass: "" },
  });
  const port = running.server.address().port;
  const base = "http://127.0.0.1:" + port;

  const health = await fetch(base + "/api/health");
  eq("the live server is healthy", health.status, 200);

  // the browser's tracer, unmodified, pointed at the live collector
  globalThis.window = globalThis;
  (0, eval)(readFileSync(new URL("../trace-schema.js", import.meta.url), "utf8"));
  (0, eval)(readFileSync(new URL("../trace.js", import.meta.url), "utf8"));
  const tracer = globalThis.FrunkyTrace.create({
    endpoint: base + "/api/v1/trace",
    build: "18",
    userAgent: "Mozilla/5.0 (X11; GNU/Linux) Tesla/2024.44.25.2 Chrome/126",
    fetch: (...a) => fetch(...a),
    storage: null,
  });
  tracer.setConsent(true);
  const driveId = tracer.begin({ lite: true, opts: { curveOutward: true, inertiaDepth: false } });
  for (let i = 0; i < 40; i++) {
    tracer.sample({ speed: i * 3, scene: "city", load: 0.06, notes: 21, strain: 0,
      late: 0, stalls: 0, errors: 0, resumes: 0, fixAge: 700, gps: "coords", lt: 30 });
  }
  tracer.event("freeze", "browser-stopped", 14083);
  tracer.message("Cannot read properties of undefined");
  tracer.end("user");
  eq("the real round trip delivered", await tracer.flush(), true);

  const onDisk = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("");
  ok("the drive is on disk", onDisk.includes(driveId));
  ok("with its buckets", onDisk.includes('"speed"'));
  ok("and no address of the client that sent it",
    !onDisk.includes("127.0.0.1") && !onDisk.includes("::1"));
  ok("and no agent string", !onDisk.includes("Mozilla"));

  // the viewer renders it
  const page = await (await fetch(base + "/")).text();
  ok("the viewer shows the drive", page.includes(driveId.slice(0, 8)));
  ok("and names the device class", page.includes("tesla"));

  // withdrawal, over the wire, erases it
  eq("withdrawal is acknowledged", await tracer.setConsent(false), true);
  const after = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("");
  ok("the drive is gone from disk", !after.includes(driveId));

  await running.close();
}

for (const d of dirs) rmSync(d, { recursive: true, force: true });

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("COLLECTOR_OK");
