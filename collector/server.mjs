// The socket layer. Everything interesting happens in app.mjs and store.mjs;
// this file exists to bind them to a port, read a body without letting anyone
// send an unbounded one, and run the retention sweep on a timer.
//
// It logs counts and never addresses. That is not decoration: a request log
// with an IP in it would quietly recreate, in a file we do keep, exactly the
// identifier the rest of the system goes to some trouble not to store.
import { createServer } from "node:http";
import { createStore } from "./store.mjs";
import { createApp } from "./app.mjs";

const env = process.env;
const PORT = Number(env.TRACE_PORT || 8099);
const HOST = env.TRACE_HOST || "0.0.0.0";
const DIR = env.TRACE_DIR || new URL("./data", import.meta.url).pathname;
const RETENTION_DAYS = Number(env.TRACE_RETENTION_DAYS || 30);
const ORIGINS = (env.TRACE_ORIGINS || "https://clemenshelm.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);
const MAX_BODY = Number(env.TRACE_MAX_BODY || 256 * 1024);
const PER_MINUTE = Number(env.TRACE_RATE_PER_MINUTE || 120);

export function startServer(options) {
  const opt = options || {};
  const store = createStore({
    dir: opt.dir || DIR,
    retentionDays: opt.retentionDays || RETENTION_DAYS,
  });
  // bench feedback (build 69): its own file family in the same directory.
  // Retention is longer on purpose — a typed verdict is product feedback the
  // operator wrote to be kept, not telemetry that must age out
  const feedback = createStore({
    dir: opt.dir || DIR,
    prefix: "feedback",
    retentionDays: opt.feedbackRetentionDays || Number(env.TRACE_FEEDBACK_RETENTION_DAYS || 365),
  });
  const app = createApp({
    store,
    feedback,
    origins: opt.origins || ORIGINS,
    maxBodyBytes: opt.maxBodyBytes || MAX_BODY,
    rateLimit: { perMinute: opt.perMinute || PER_MINUTE },
    viewer: opt.viewer || { user: env.TRACE_VIEW_USER || "", pass: env.TRACE_VIEW_PASS || "" },
  });

  const server = createServer((req, res) => {
    const chunks = [];
    let size = 0;
    let aborted = false;

    req.on("data", (chunk) => {
      if (aborted) return;
      size += chunk.length;
      // refuse while it is still arriving rather than after: buffering a body
      // in order to then say it was too large is the same denial of service
      if (size > MAX_BODY) {
        aborted = true;
        res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
        res.end("Zu gross.\n");
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("error", () => { aborted = true; });

    req.on("end", async () => {
      if (aborted) return;
      const headers = Object.assign({}, req.headers);
      // The socket's own address is the last place an identity could enter, so
      // it is handed to the rate limiter under a name the store never reads.
      if (!headers["x-forwarded-for"] && !headers["x-real-ip"]) {
        headers["remote-address"] = req.socket && req.socket.remoteAddress || "";
      }
      let out;
      try {
        out = await app.handle({
          method: req.method,
          path: req.url || "/",
          headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      } catch (err) {
        console.error("[frunky-trace] handler failed:", err && err.message);
        out = { status: 500, headers: { "content-type": "text/plain" }, body: "Fehler.\n" };
      }
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    });
  });

  const sweep = () => {
    try {
      const removed = store.sweep();
      if (removed) console.log("[frunky-trace] retention: " + removed + " Fahrten gelöscht");
      const removedFb = feedback.sweep();
      if (removedFb) console.log("[frunky-trace] retention: " + removedFb + " Feedback-Einträge gelöscht");
    } catch (err) { console.error("[frunky-trace] sweep failed:", err && err.message); }
  };
  sweep();
  const timer = setInterval(sweep, 3600e3);
  timer.unref?.();

  return new Promise((resolve) => {
    // `??`, not `||`: port 0 means "any free port", which a truthiness check
    // silently turns back into the default — and a test that thinks it bound an
    // ephemeral port while really sitting on 8099 passes until the day the real
    // collector is running on the same machine
    server.listen(opt.port ?? PORT, opt.host || HOST, () => {
      const a = server.address();
      console.log("[frunky-trace] hört auf " + (typeof a === "string" ? a : a.address + ":" + a.port) +
        " · Ablage " + store.dir + " · Aufbewahrung " + (opt.retentionDays || RETENTION_DAYS) + " Tage" +
        " · Herkunft " + (opt.origins || ORIGINS).join(", "));
      resolve({ server, store, feedback, app, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

// started directly (node collector/server.mjs), as opposed to imported by a test
const invokedDirectly = process.argv[1] && process.argv[1].endsWith("server.mjs");
if (invokedDirectly) {
  startServer().catch((err) => {
    console.error("[frunky-trace] konnte nicht starten:", err);
    process.exit(1);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => { console.log("[frunky-trace] beendet."); process.exit(0); });
  }
}
