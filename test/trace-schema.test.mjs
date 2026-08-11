// The privacy boundary of the whole tracing system is one pure function.
//
// `redactTrace` is the only door out of the browser and the only door into the
// store. Everything else — batching, transport, retention, the viewer — is
// plumbing around it. So it is where the tests belong, and the most important
// one is not a list of fields but a POISON test: build an input in which every
// leaf is a string nobody may ever see, redact it, and assert that none of
// those strings survives into the output. A field added later that forwards its
// input verbatim fails that test without anyone having to remember to extend a
// list.
import { readFileSync } from "node:fs";

(0, eval)(readFileSync(new URL("../trace-schema.js", import.meta.url), "utf8"));
const S = globalThis.FrunkyTraceSchema;

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };
const eq = (label, a, b) => ok(label + " (got " + JSON.stringify(a) + ")", a === b);

// ---- speed is a bucket, never a value -------------------------------------
// A metre-accurate speed timeline is a movement profile. Ten-km/h buckets still
// answer the only question the music engine poses ("was the car moving when the
// sound stopped") and stop being a trajectory.
eq("standstill is its own bucket", S.speedBucket(0), 0);
eq("crawling is standstill", S.speedBucket(1.4), 0);
eq("walking pace leaves standstill", S.speedBucket(5), 1);
eq("nine is still the first moving bucket", S.speedBucket(9.9), 1);
eq("ten opens the next", S.speedBucket(10), 2);
eq("fifty", S.speedBucket(54), 6);
eq("the top bucket is open-ended", S.speedBucket(131), 13);
eq("and absorbs the absurd", S.speedBucket(900), 13);
eq("nonsense is standstill, not NaN", S.speedBucket("fast"), 0);
eq("negative is standstill", S.speedBucket(-20), 0);
ok("every bucket has a label", S.SPEED_LABELS.length === 14 &&
  S.SPEED_LABELS.every((l) => typeof l === "string" && l.length));

// ---- the user agent is reduced to a class, never forwarded -----------------
const UA_TESLA = "Mozilla/5.0 (X11; GNU/Linux) AppleWebKit/537.36 (KHTML, like Gecko) Tesla/2024.44.25.2 Chrome/126 Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const UA_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

// ---- the vendor survives, the firmware build does not ----------------------
// Five classes cannot tell a Polestar from a Rivian, and an Android Automotive
// car probably reports plain "Android" — so it would be filed as a PHONE, which
// is not a blind spot but a wrong answer. The agent string is where the vendor
// is, and it is also the classic fingerprinting surface. Those two facts live
// in different halves of it: `Tesla` is a name and low entropy, `2024.44.25.2`
// is a firmware build and very nearly a personal identifier at this fleet size.
// So the words survive and every number goes.
const UA_POLESTAR = "Mozilla/5.0 (Linux; Android 12; Polestar 2 Build/SP2A.220505.008) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.5414.86 Safari/537.36";
const UA_MADEUP = "Mozilla/5.0 (Linux; Zorbo OS 4.2) AppleWebKit/537.36 Zorbomobile/9.9.9 Chrome/131.0.1 Safari/537.36";

for (const ua of [UA_TESLA, UA_IPHONE, UA_ANDROID, UA_MAC, UA_POLESTAR, UA_MADEUP]) {
  const tokens = S.uaTokens(ua);
  ok("no digit survives in: " + tokens, !/\d/.test(tokens));
  ok("nor a version separator", !tokens.includes("/") && !tokens.includes("."));
  ok("the result is capped", tokens.length <= S.UA_MAX);
}
ok("the vendor survives", S.uaTokens(UA_TESLA).includes("Tesla"));
ok("the browser engine survives", S.uaTokens(UA_TESLA).includes("Chrome"));
ok("the firmware build does not", !S.uaTokens(UA_TESLA).includes("2024"));
ok("boilerplate is not worth a slot", !S.uaTokens(UA_TESLA).includes("Mozilla") &&
  !S.uaTokens(UA_TESLA).includes("AppleWebKit") && !S.uaTokens(UA_TESLA).includes("KHTML"));

// The decisive property: this is NOT an allow-list of brands we know. A car
// nobody has heard of has to arrive carrying its own name, or the field only
// ever confirms what we already believed.
ok("a car we know nothing about names itself", S.uaTokens(UA_POLESTAR).includes("Polestar"));
ok("and so does one that does not exist yet", S.uaTokens(UA_MADEUP).includes("Zorbomobile"));
ok("even its OS token", S.uaTokens(UA_MADEUP).includes("Zorbo"));
eq("nothing in, nothing out", S.uaTokens(null), "");
eq("and no guessing", S.uaTokens(12345), "");

// the engine's MAJOR version only: an old Chromium in a car is one of the best
// hypotheses we have, and about twenty of them are in circulation — which
// singles nobody out, where a full build number very nearly does
eq("the engine major version is kept", S.engineMajor(UA_TESLA), 126);
eq("even on an old car browser", S.engineMajor(UA_POLESTAR), 109);
eq("Safari reports through Version/", S.engineMajor(UA_IPHONE), 17);
eq("an unreadable agent is zero, not a guess", S.engineMajor("Weird/1.0"), 0);
eq("and so is a non-string", S.engineMajor(null), 0);

eq("the Tesla browser is recognised", S.platformClass(UA_TESLA), "tesla");
eq("iOS", S.platformClass(UA_IPHONE), "ios");
eq("Android", S.platformClass(UA_ANDROID), "android");
eq("a desktop", S.platformClass(UA_MAC), "desktop");
eq("an unknown agent is not a guess", S.platformClass("Weird/1.0"), "other");
eq("no agent at all", S.platformClass(null), "other");
for (const ua of [UA_TESLA, UA_IPHONE, UA_ANDROID, UA_MAC]) {
  const cls = S.platformClass(ua);
  ok("the class never carries the agent string", !ua.includes(cls) || cls.length < 9);
  ok("the class is one of the known ones", S.PLATFORMS.includes(cls));
}

// ---- error text is sanitised, not trusted ---------------------------------
// A JavaScript error message is genuinely the most useful thing a remote crash
// report can carry, and it is also the one field that could echo something out
// of the page. Frunky has no text input anywhere, so the risk is small — but
// "small" is not an argument, a rule is: letters and a little punctuation, no
// digits, no URLs, no paths, and a hard length cap.
eq("an ordinary message survives readably",
  S.sanitizeMessage("Cannot read properties of undefined"),
  "Cannot read properties of undefined");
ok("digits are removed", !/\d/.test(S.sanitizeMessage("error at line 42 col 7")));
ok("a URL cannot pass", !S.sanitizeMessage("failed https://evil.test/a?token=abc").includes("evil"));
ok("a file path cannot pass", !S.sanitizeMessage("/Users/someone/secret.js broke").includes("someone"));
ok("an email cannot pass", !S.sanitizeMessage("mail me at a.b@c.de now").includes("@"));
// the one that motivated inverting the rule: a token shaped like a secret is
// none of "url", "path" or "has a digit", so a deny-list waved it through
ok("a secret-shaped token cannot pass",
  !S.sanitizeMessage("token sk-live-abcdefg leaked").includes("sk-live"));
eq("...while the sentence around it survives",
  S.sanitizeMessage("token sk-live-abcdefg leaked"), "token leaked");
ok("a hostname cannot pass", !S.sanitizeMessage("connect to db.internal failed").includes("db.internal"));
ok("the length is capped", S.sanitizeMessage("x".repeat(500)).length <= 80);
eq("nothing readable left is empty, not garbage", S.sanitizeMessage("1234 @@@ ///"), "");
eq("a non-string is empty", S.sanitizeMessage({ toString: () => "boom" }), "");

// ---- the redactor: a whitelist, with everything else dropped ---------------
const wellFormed = () => ({
  v: 1,
  id: "a1b2c3d4e5f60718",
  build: "17",
  platform: "tesla",
  ua: "GNU Linux Tesla Chrome Safari",
  engineMajor: 126,
  lite: true,
  opts: { curveOutward: true, inertiaDepth: false },
  hw: 4,
  mem: 4,
  samples: [
    { t: 0, speed: 0, scene: "standstill", load: 3, notes: 0, strain: 0,
      late: 0, stalls: 0, errors: 0, resumes: 0, fixAge: 900, gps: "coords", lt: 120,
      audio: "running" },
    { t: 5000, speed: 4, scene: "city", load: 8, notes: 22, strain: 0,
      late: 0, stalls: 0, errors: 0, resumes: 0, fixAge: 400, gps: "coords", lt: 60,
      audio: "running" },
  ],
  events: [
    { t: 1200, kind: "launch", n: 0, code: "" },
    { t: 9000, kind: "freeze", n: 14083, code: "browser-stopped" },
  ],
  msgs: ["Cannot read properties of undefined"],
  end: { t: 132000, reason: "user", freezes: 1, worstFreeze: 14083,
    maxSpeed: 7, minNotes: 0, maxNotes: 31 },
});

const good = S.redactTrace(wellFormed());
ok("a well-formed trace is accepted", good.ok === true);
eq("its id survives", good.trace.id, "a1b2c3d4e5f60718");
eq("both samples survive", good.trace.samples.length, 2);
eq("both events survive", good.trace.events.length, 2);
eq("the end block survives", good.trace.end.freezes, 1);
eq("redaction is idempotent",
  JSON.stringify(S.redactTrace(good.trace).trace), JSON.stringify(good.trace));

// unknown keys are dropped at every level, and their loss is reported
const withExtras = wellFormed();
withExtras.lat = 48.2082;
withExtras.lon = 16.3738;
withExtras.ua = UA_TESLA;
withExtras.samples[0].heading = 271.5;
withExtras.samples[0].accuracy = 12;
withExtras.events[0].stack = "at foo (/Users/x/y.js:1:1)";
withExtras.end.route = "A1 Wien-Salzburg";
const trimmed = S.redactTrace(withExtras);
const trimmedText = JSON.stringify(trimmed.trace);
for (const forbidden of ["48.2", "16.3", "Tesla/2024", "271.5", "Users", "A1 Wien"]) {
  ok("dropped: " + forbidden, !trimmedText.includes(forbidden));
}
ok("the drop is reported, not silent", Array.isArray(trimmed.dropped) && trimmed.dropped.length >= 4);
ok("a dropped key is named", trimmed.dropped.includes("lat"));

// enums are enums
const badEnum = wellFormed();
badEnum.platform = "tesla-model-3-vin-XP7YGCEK";
badEnum.samples[0].scene = "Wiener Neustadt";
badEnum.samples[0].gps = "lat:48.2";
badEnum.events[0].kind = "user-said-hello";
badEnum.events[1].code = "hit a tree near Wiener Neustadt";
badEnum.end.reason = "crashed into a tree";
const enumed = S.redactTrace(badEnum);
const enumText = JSON.stringify(enumed.trace);
for (const forbidden of ["VIN", "vin", "XP7", "Wiener", "48.2", "hello", "tree"]) {
  ok("enum poison dropped: " + forbidden, !enumText.includes(forbidden));
}
ok("an unknown platform becomes the honest fallback", enumed.trace.platform === "other");
ok("an unknown event kind is dropped entirely",
  enumed.trace.events.every((e) => S.EVENT_KINDS.includes(e.kind)));

// numbers are numbers, clamped and rounded — never strings, never NaN
const badNums = wellFormed();
badNums.samples[0].t = "5000";
badNums.samples[0].load = 9e9;
badNums.samples[0].notes = NaN;
badNums.samples[0].lt = -5;
badNums.samples[1].speed = 99;
const nums = S.redactTrace(badNums);
const s0 = nums.trace.samples[0];
ok("a numeric string is a number", typeof s0.t === "number" && Number.isFinite(s0.t));
ok("an absurd load is clamped", s0.load <= 100);
ok("NaN becomes zero, never NaN", s0.notes === 0);
ok("negative is clamped up", s0.lt >= 0);
ok("an out-of-range bucket is clamped", nums.trace.samples[1].speed <= 13);
// JSON.stringify turns NaN and Infinity into null, so a null anywhere in the
// serialised trace is the tell that a non-number reached the output
ok("nothing serialises to null", !JSON.stringify(nums.trace).includes("null"));

// size limits: a trace cannot become a channel by being enormous
const huge = wellFormed();
huge.samples = Array.from({ length: 5000 }, (_, i) => ({ ...wellFormed().samples[0], t: i * 100 }));
huge.events = Array.from({ length: 5000 }, () => ({ t: 1, kind: "freeze", n: 1, code: "" }));
const capped = S.redactTrace(huge);
ok("samples are capped", capped.trace.samples.length <= S.MAX_SAMPLES);
ok("events are capped", capped.trace.events.length <= S.MAX_EVENTS);
ok("the cap is reported", capped.dropped.some((d) => d.includes("samples") || d.includes("events")));

// structurally broken input is refused, not half-stored
for (const bad of [null, undefined, 42, "trace", [], { }, { v: 99, id: "x" }]) {
  const r = S.redactTrace(bad);
  ok("refused: " + JSON.stringify(bad), r.ok === false && r.trace === null);
}
ok("a wrong schema version is refused", S.redactTrace({ ...wellFormed(), v: 2 }).ok === false);
ok("a malformed id is refused", S.redactTrace({ ...wellFormed(), id: "../../etc/passwd" }).ok === false);
ok("an id that is a path traversal cannot become a filename",
  S.redactTrace({ ...wellFormed(), id: "a/../b" }).ok === false);

// ---- the page's own life is the thing being measured now ------------------
// Nine Tesla runs said the engine is fine: zero late steps, zero stalls, zero
// errors, notes flowing to the last sample — and four of them ended in
// `pagehide` after 11 to 44 seconds. The music does not die, the PAGE is taken
// away. Telling apart "backgrounded and recoverable" from "discarded" needs the
// browser's own lifecycle vocabulary, so the schema learns it.
for (const kind of ["hidden", "visible", "pagehide", "pageshow", "audiostate",
  "discarded", "wakelock"]) {
  ok("the schema can record a " + kind + " event", S.EVENT_KINDS.includes(kind));
}
for (const code of ["persisted", "discarded", "suspended", "interrupted",
  "running", "granted", "lost"]) {
  ok("...and qualify it with " + code, S.EVENT_CODES.includes(code));
}

// The audio context's state per sample. A suspended context is silence with a
// perfectly healthy sequencer behind it — the exact shape of "it got stuck",
// and until now nothing in a trace could show it.
{
  const withAudio = wellFormed();
  withAudio.samples[0].audio = "suspended";
  withAudio.samples[1].audio = "erfunden";
  const r = S.redactTrace(withAudio);
  eq("a real audio state survives", r.trace.samples[0].audio, "suspended");
  ok("an invented one does not", r.trace.samples[1].audio === "");
  ok("and the states are the ones a browser actually reports",
    ["running", "suspended", "interrupted", "closed"].every((s) => S.AUDIO_STATES.includes(s)));
}

// How weak is this device? The Tesla reports no vendor token at all — its agent
// string is plain "Linux Chrome", indistinguishable from a desktop — so the
// useful question is not which car it is but how much machine it has. Small
// integers, and the ones that decide whether the low-power graph should be on.
{
  const r = S.redactTrace({ ...wellFormed(), hw: 4, mem: 4 });
  eq("cores travel", r.trace.hw, 4);
  eq("memory travels", r.trace.mem, 4);
  const absurd = S.redactTrace({ ...wellFormed(), hw: 4096, mem: -3 });
  ok("clamped, like every other number", absurd.trace.hw <= 64 && absurd.trace.mem >= 0);
  eq("and an absent value is zero, not a guess",
    S.redactTrace({ ...wellFormed(), hw: undefined }).trace.hw, 0);
}

// ---- the free-text fields, and the fact that both are sanitised -----------
// Two fields cannot be enumerated in advance: error messages, and the agent
// string's vendor tokens. Both are the documented exceptions to "no free text",
// so both get their own assertions rather than a quiet pass in the sweep below.
//
// The list is exported and asserted small: adding a third free-text field turns
// this red, which is the point — each one is a decision, not a default.
ok("the free-text fields are declared", Array.isArray(S.FREE_TEXT_FIELDS));
ok("and there are exactly the two that were argued for (" + S.FREE_TEXT_FIELDS + ")",
  S.FREE_TEXT_FIELDS.length === 2 &&
  S.FREE_TEXT_FIELDS.includes("msgs") && S.FREE_TEXT_FIELDS.includes("ua"));

// the agent field is sanitised on the way in as well, so a client that sends a
// raw string gets the same treatment the browser should have applied
const uaRaw = S.redactTrace({ ...wellFormed(), ua: UA_TESLA }).trace.ua;
ok("a raw agent string is reduced at the door, not stored", !/\d/.test(uaRaw));
ok("while keeping the vendor", uaRaw.includes("Tesla"));

const msgy = wellFormed();
msgy.msgs = [
  "Cannot read properties of undefined reading gain",
  "boom at https://x.test/app.js?key=sk-live-9",
  "/Users/clemens/frunky/engine.js line 412",
  "contact a.b@c.de",
  "y".repeat(400),
  "a", "b", "c", "d", "e", "f",
];
const msgOut = S.redactTrace(msgy).trace.msgs;
ok("messages are capped in number", msgOut.length <= S.MAX_MSGS);
ok("each message is capped in length", msgOut.every((m) => m.length <= S.MSG_MAX));
const msgText = msgOut.join(" | ");
for (const forbidden of ["http", "sk-live", "Users", "clemens", "@", "412"]) {
  ok("msgs sanitised: " + forbidden, !msgText.includes(forbidden));
}
ok("but a real message still arrives readable",
  msgText.includes("Cannot read properties of undefined reading gain"));

// ---- the poison sweep -----------------------------------------------------
// The generative half, and the assertion that actually holds the line. Every
// leaf of a well-formed trace is replaced by a unique letters-only poison; what
// comes back must contain none of them. A field added later that forwards its
// input verbatim fails here, with nobody having had to remember to extend a
// list of forbidden names. (Letters only on purpose: a poison containing digits
// would be destroyed by the message sanitiser and the sweep would pass for the
// wrong reason.)
//
// `msgs` is the ONE documented exemption — it is free text by design, covered
// by the block above.
const poisons = [];
const letters = "abcdefghijklmnopqrstuvwxyz";
let poisonN = 0;
const poison = () => {
  const p = "PZN" + letters[poisonN % 26] + letters[Math.floor(poisonN / 26) % 26] + "SECRET";
  poisonN++;
  poisons.push(p);
  return p;
};

// Build the input by walking the exported spec: every declared field gets a
// poison, including one declared after this test was written.
const poisonField = (field) => {
  if (!field || typeof field !== "object") return poison();
  if (field.t === "obj") return poisonFields(field.fields);
  if (field.t === "arr") return [poisonField(field.item), poisonField(field.item)];
  return poison();
};
const poisonFields = (fields) => {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = poisonField(fields[k]);
  return out;
};

ok("the spec is exported for the sweep to walk",
  S.SPEC && typeof S.SPEC === "object" && Object.keys(S.SPEC).length >= 8);

const poisoned = poisonFields(S.SPEC);
// `v` and `id` are structural and we mint them ourselves; poisoning them only
// makes the trace invalid, and a sweep over a refused trace proves nothing
poisoned.v = 1;
poisoned.id = "a1b2c3d4e5f60718";
// the free-text fields are exempt by design — the block above is where they are
// held to account instead. Driving the exemption off the exported list rather
// than off two names typed here means a third such field cannot be quietly
// waved through: it would have to be added to FREE_TEXT_FIELDS, which the
// assertion above refuses.
for (const f of S.FREE_TEXT_FIELDS) poisoned[f] = Array.isArray(poisoned[f]) ? [] : "";
const poisonCount = poisons.length;
const swept = JSON.stringify(S.redactTrace(poisoned).trace);
const leaked = poisons.filter((p) => swept.includes(p));
ok("every declared field was poisoned (" + poisonCount + ")", poisonCount >= 25);
ok("no poisoned leaf survives redaction (" + leaked.length + " leaked: " +
  leaked.slice(0, 3).join(",") + ")", leaked.length === 0);
// and the sweep must be able to fail: prove the detector can see a value that
// really is in the output, so a green sweep is evidence rather than a vacuum
ok("the sweep would notice a leak", swept.length > 40 &&
  JSON.stringify(S.redactTrace({ ...wellFormed(), id: "deadbeefbeefbeef" }).trace)
    .includes("deadbeefbeefbeef"));

// ---- trace ids are ephemeral and unguessable ------------------------------
const ids = new Set();
for (let i = 0; i < 200; i++) ids.add(S.newTraceId());
eq("ids do not repeat", ids.size, 200);
ok("an id is 16 lowercase hex characters", [...ids].every((i) => /^[0-9a-f]{16}$/.test(i)));
ok("a fresh id passes its own validator", S.redactTrace({ ...wellFormed(), id: S.newTraceId() }).ok);

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("TRACE_SCHEMA_OK");
