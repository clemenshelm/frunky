// The browser half of the tracing system.
//
// Three things have to be true of it and none of them are obvious from reading
// the code, so they are asserted here:
//
//   1. Nothing at all leaves the browser before someone has said yes, and
//      saying no afterwards both stops the sending and asks for what was
//      already sent to be deleted. Consent that cannot be withdrawn is not
//      consent.
//   2. Minimisation happens HERE, in the browser, not on the server. The server
//      redacting again is a second line of defence, not the first one — data
//      that was never transmitted cannot leak from a machine we operate.
//   3. It cannot break the music. A tracer that throws inside the frame loop
//      would be a far worse bug than the one it was built to find, so every
//      entry point survives a storage that throws, a fetch that throws, and a
//      network that is simply not there.
import { readFileSync } from "node:fs";

globalThis.window = globalThis;
(0, eval)(readFileSync(new URL("../trace-schema.js", import.meta.url), "utf8"));
(0, eval)(readFileSync(new URL("../trace.js", import.meta.url), "utf8"));
const S = globalThis.FrunkyTraceSchema;
const T = globalThis.FrunkyTrace;

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };
const eq = (label, a, b) => ok(label + " (got " + JSON.stringify(a) + ")", a === b);

const ENDPOINT = "https://trace.example/api/v1/trace";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function fakeFetch() {
  const calls = [];
  let mode = "ok";
  const f = (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    if (mode === "throw") throw new Error("synchronous boom");
    if (mode === "reject") return Promise.reject(new Error("offline"));
    if (mode === "500") return Promise.resolve({ ok: false, status: 500 });
    return Promise.resolve({ ok: true, status: 204 });
  };
  f.calls = calls;
  f.setMode = (m) => { mode = m; };
  return f;
}

let clock = 0;
const makeTracer = (over) => T.create(Object.assign({
  endpoint: ENDPOINT,
  build: "17",
  userAgent: "Mozilla/5.0 (X11; GNU/Linux) Tesla/2024.44.25.2 Chrome/126",
  now: () => clock,
  fetch: fakeFetch(),
  storage: fakeStorage(),
}, over));

const drive = (tr, seconds, speedKmh) => {
  for (let i = 0; i < seconds; i++) {
    clock += 1000;
    tr.sample({ speed: speedKmh, scene: "city", load: 0.05, notes: 20, strain: 0,
      late: 0, stalls: 0, errors: 0, resumes: 0, fixAge: 800, gps: "coords", lt: 12 });
  }
};

// ---- 1. silence until consent ---------------------------------------------
{
  const fetchSpy = fakeFetch();
  const store = fakeStorage();
  const tr = makeTracer({ fetch: fetchSpy, storage: store });

  eq("consent starts unanswered, not assumed", tr.consent(), null);
  eq("and that is not a yes", tr.enabled(), false);

  tr.begin();
  drive(tr, 30, 50);
  tr.event("freeze", "browser-stopped", 14083);
  tr.message("Cannot read properties of undefined");
  await tr.flush();
  tr.end("user");
  await tr.flush();

  eq("nothing was sent without consent", fetchSpy.calls.length, 0);
  eq("and nothing was written to storage either", store._map.size, 0);
  eq("there is not even a trace id yet", tr.id(), null);
}

// ---- 2. after consent, one POST carries an already-redacted trace ----------
{
  const fetchSpy = fakeFetch();
  const tr = makeTracer({ fetch: fetchSpy });
  tr.setConsent(true);
  eq("consent is remembered as yes", tr.consent(), true);
  eq("and that is a yes", tr.enabled(), true);

  tr.begin();
  ok("a drive has an id", /^[0-9a-f]{16}$/.test(tr.id()));
  drive(tr, 20, 63.4);
  tr.event("launch", "", 0);
  tr.end("user");
  await tr.flush();

  eq("exactly one request", fetchSpy.calls.length, 1);
  const call = fetchSpy.calls[0];
  eq("to the endpoint", call.url, ENDPOINT);
  eq("as a POST", call.init.method, "POST");
  ok("with a JSON content type", /json/.test(call.init.headers["Content-Type"]));
  ok("and keepalive, so an unloading page still delivers", call.init.keepalive === true);

  const body = call.body;
  eq("the schema version travels", body.v, S.VERSION);
  eq("the build travels", body.build, "17");
  eq("the platform is a class, not an agent string", body.platform, "tesla");
  ok("the raw agent string is nowhere in the body",
    !JSON.stringify(body).includes("Mozilla") && !JSON.stringify(body).includes("2024.44"));
  // ...but the vendor is, because "which car browser" is the whole purpose and
  // five classes cannot tell a Polestar from a Rivian
  ok("the vendor token travels", body.ua.includes("Tesla"));
  ok("without the firmware build", !/\d/.test(body.ua));
  eq("and the engine major version travels", body.engineMajor, 126);

  // the decisive one: what the client sends is already what the schema allows
  const re = S.redactTrace(body);
  ok("the body is accepted by the schema", re.ok === true);
  eq("the body contains nothing the schema would drop", re.dropped.length, 0);
  eq("redacting it changes nothing", JSON.stringify(re.trace), JSON.stringify(body));

  // speed left as a bucket, never as a reading
  ok("no raw speed anywhere", !JSON.stringify(body).includes("63.4"));
  ok("speed arrived as its bucket", body.samples.every((s) => s.speed === S.speedBucket(63.4)));
  ok("and that bucket is the right one", S.speedBucket(63.4) === 7);
}

// ---- 3. every drive is a new identity -------------------------------------
{
  const tr = makeTracer({});
  tr.setConsent(true);
  tr.begin();
  const first = tr.id();
  tr.end("user");
  tr.begin();
  const second = tr.id();
  ok("a second drive is not the same subject", first !== second);
  ok("both are well-formed", /^[0-9a-f]{16}$/.test(first) && /^[0-9a-f]{16}$/.test(second));

  // and nothing device-shaped is kept between drives
  const stored = JSON.stringify([...makeTracer({}).__storageKeys()]);
  ok("no key looks like a device identifier",
    !/device|client|user|uid|fingerprint/i.test(stored));
}

// ---- 4. a long drive thins rather than truncating -------------------------
// A trace that stops after an hour would answer "did it survive the drive?"
// with silence exactly when the answer is interesting.
{
  const fetchSpy = fakeFetch();
  const tr = makeTracer({ fetch: fetchSpy });
  tr.setConsent(true);
  tr.begin();
  const startClock = clock;
  drive(tr, S.MAX_SAMPLES * 3, 100);
  const span = clock - startClock;
  tr.end("user");
  await tr.flush();

  const body = fetchSpy.calls[fetchSpy.calls.length - 1].body;
  ok("the sample count stays inside the cap", body.samples.length <= S.MAX_SAMPLES);
  ok("but the drive is still covered end to end",
    body.samples[body.samples.length - 1].t >= span * 0.9);
  ok("and the early part was not thrown away", body.samples[0].t <= span * 0.1);
}

// ---- 5. offline is the normal case, not an error --------------------------
// A car drives through tunnels and out of coverage. A send that fails must be
// kept and retried, not lost — otherwise exactly the drives that went wrong are
// the ones that never arrive.
{
  const fetchSpy = fakeFetch();
  const store = fakeStorage();
  const tr = makeTracer({ fetch: fetchSpy, storage: store });
  tr.setConsent(true);
  tr.begin();
  drive(tr, 10, 40);
  tr.end("user");

  fetchSpy.setMode("reject");
  const failed = await tr.flush();
  eq("a failed send reports failure", failed, false);
  ok("it was attempted", fetchSpy.calls.length === 1);
  ok("and it is still pending", tr.pending() === true);
  ok("the pending trace survives in storage for the next page load",
    JSON.stringify([...store._map.values()]).includes("samples"));

  fetchSpy.setMode("ok");
  const sent = await tr.flush();
  eq("the retry succeeds", sent, true);
  ok("nothing is pending afterwards", tr.pending() === false);
  ok("and storage no longer holds a copy",
    !JSON.stringify([...store._map.values()]).includes("samples"));

  // a server error is a failure too, not a success with a sad face
  tr.begin();
  drive(tr, 3, 20);
  fetchSpy.setMode("500");
  eq("an HTTP 500 is not a delivery", await tr.flush(), false);
  ok("and it stays pending", tr.pending() === true);
}

// ---- 6. a crashed drive is delivered by the next page load ----------------
{
  const store = fakeStorage();
  const first = fakeFetch();
  const tr = makeTracer({ fetch: first, storage: store });
  tr.setConsent(true);
  tr.begin();
  drive(tr, 8, 55);
  first.setMode("reject");
  await tr.flush();          // the drive that died: nothing got through
  ok("it is held", JSON.stringify([...store._map.values()]).includes("samples"));

  // ...and the page is reloaded: a brand new tracer, the same storage
  const second = fakeFetch();
  const revived = makeTracer({ fetch: second, storage: store });
  const recovered = await revived.recover();
  eq("the previous drive was recovered and sent", recovered, true);
  eq("one request went out", second.calls.length, 1);
  ok("carrying the earlier drive's samples", second.calls[0].body.samples.length >= 5);
  ok("storage is clear again", !JSON.stringify([...store._map.values()]).includes("samples"));
}

// ---- 7. withdrawal actually withdraws --------------------------------------
{
  const fetchSpy = fakeFetch();
  const store = fakeStorage();
  const tr = makeTracer({ fetch: fetchSpy, storage: store });
  tr.setConsent(true);
  tr.begin();
  const id = tr.id();
  drive(tr, 6, 30);
  tr.end("user");
  await tr.flush();
  eq("one drive delivered", fetchSpy.calls.length, 1);

  const erased = await tr.setConsent(false);
  eq("consent is remembered as no", tr.consent(), false);
  eq("withdrawal reports that the erasure was asked for", erased, true);

  const del = fetchSpy.calls[fetchSpy.calls.length - 1];
  eq("a delete was sent", del.init.method, "DELETE");
  ok("naming the drive to erase", del.url.endsWith("/" + id));
  ok("no pending copy is left behind",
    !JSON.stringify([...store._map.values()]).includes("samples"));

  // and it really is off now
  const before = fetchSpy.calls.length;
  tr.begin();
  drive(tr, 5, 44);
  tr.end("user");
  await tr.flush();
  eq("nothing further is sent", fetchSpy.calls.length, before);
  eq("and no new identity was minted", tr.id(), null);
}

// ---- 8. the tracer cannot break the music ---------------------------------
// This is the one that matters most in the car: a bug in the diagnostics must
// never be worse than the bug it is diagnosing.
{
  const hostileStorage = {
    getItem: () => { throw new Error("storage denied"); },
    setItem: () => { throw new Error("storage denied"); },
    removeItem: () => { throw new Error("storage denied"); },
  };
  const hostileFetch = () => { throw new Error("fetch exploded"); };

  let threw = null;
  try {
    const tr = T.create({ endpoint: ENDPOINT, build: "17", userAgent: "x",
      now: () => clock, fetch: hostileFetch, storage: hostileStorage });
    tr.setConsent(true);
    tr.begin();
    drive(tr, 5, 50);
    tr.event("freeze", "our-js", 900);
    tr.message("boom");
    tr.end("error");
    await tr.flush();
    await tr.recover();
    tr.setConsent(false);
  } catch (err) {
    threw = err;
  }
  ok("a hostile environment never reaches the caller (" + (threw && threw.message) + ")",
    threw === null);

  // garbage into the sample path is not a crash either
  let threw2 = null;
  try {
    const tr = makeTracer({});
    tr.setConsent(true);
    tr.begin();
    tr.sample(null);
    tr.sample({ speed: "fast", scene: 7, load: NaN });
    tr.sample(undefined);
    tr.event(null, undefined, "x");
    tr.message(null);
    await tr.flush();
  } catch (err) { threw2 = err; }
  ok("garbage samples never reach the caller (" + (threw2 && threw2.message) + ")",
    threw2 === null);
}

// ---- 9. no endpoint configured means no tracing, silently -----------------
// The page ships with tracing possible but not necessarily pointed anywhere.
{
  const fetchSpy = fakeFetch();
  const tr = makeTracer({ fetch: fetchSpy, endpoint: "" });
  tr.setConsent(true);
  eq("without an endpoint there is nothing to consent to", tr.enabled(), false);
  tr.begin();
  drive(tr, 4, 30);
  await tr.flush();
  eq("and nothing is sent", fetchSpy.calls.length, 0);
}

// ---- 10. erasure has to work from a different page, days later ------------
// The right to have it deleted is worth what it is easy to exercise. The ids of
// the drives sent from this browser are kept ON THE DEVICE — they are the only
// handle anyone has on those records, and without them "delete my data" is a
// sentence rather than a button. They are never transmitted as a set, and they
// go when the data goes.
{
  const store = fakeStorage();
  const sendFetch = fakeFetch();
  const tr = makeTracer({ fetch: sendFetch, storage: store });
  tr.setConsent(true);
  const ids = [];
  for (let i = 0; i < 3; i++) {
    tr.begin();
    ids.push(tr.id());
    drive(tr, 4, 40);
    tr.end("user");
    await tr.flush();
  }
  eq("three drives delivered", sendFetch.calls.length, 3);
  ok("the device remembers what it sent", tr.sent().length === 3);
  ok("and remembers exactly those", ids.every((i) => tr.sent().includes(i)));

  // a fresh page — the privacy page, say — sees the same list
  const other = makeTracer({ fetch: fakeFetch(), storage: store });
  ok("another page on the same device can see them", other.sent().length === 3);
  ok("without any of them having been sent as a list",
    !sendFetch.calls.some((c) => JSON.stringify(c.body || {}).includes(ids[1]) &&
      JSON.stringify(c.body || {}).includes(ids[2])));

  const eraseFetch = fakeFetch();
  const eraser = makeTracer({ fetch: eraseFetch, storage: store });
  const count = await eraser.eraseAll();
  eq("all three were asked to be erased", count, 3);
  ok("each by its own id", ids.every((id) =>
    eraseFetch.calls.some((c) => c.init.method === "DELETE" && c.url.endsWith("/" + id))));
  eq("and the device forgets them too", eraser.sent().length, 0);
  eq("as does a page loaded afterwards", makeTracer({ storage: store }).sent().length, 0);

  // the list cannot grow without bound on a device that drives every day
  const many = makeTracer({ fetch: fakeFetch(), storage: fakeStorage() });
  many.setConsent(true);
  for (let i = 0; i < 60; i++) { many.begin(); many.end("user"); await many.flush(); }
  ok("the remembered list is capped (" + many.sent().length + ")", many.sent().length <= 20);

  // and a failed erasure does not pretend to have happened
  const brokenFetch = fakeFetch();
  const stubborn = makeTracer({ fetch: brokenFetch, storage: fakeStorage() });
  stubborn.setConsent(true);
  stubborn.begin(); stubborn.end("user"); await stubborn.flush();
  brokenFetch.setMode("reject");
  eq("a network that refuses erases nothing", await stubborn.eraseAll(), 0);
  eq("so the id is still known, to try again", stubborn.sent().length, 1);
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("TRACE_OK");
