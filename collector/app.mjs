// The collector's request handling, as a pure function of (method, path,
// headers, body) — no socket, no framework. That shape is what lets the tests
// assert the promises against the bytes that reach the disk instead of against
// the handler's good intentions.
//
// What this file is careful about:
//
//   * It never reads the request's address for anything but rate limiting, and
//     rate limiting keeps a keyed hash in memory that is thrown away on the
//     hour. There is no code path from a connection to a file.
//   * Everything that is stored goes through the browser's own redactor first.
//     A client that sends more than the schema allows does not get a 400; it
//     gets a 204 and the extra fields are simply not stored. Refusing would
//     teach a broken client to keep retrying the same oversized payload.
//   * The viewer is behind a password and marked never-index, never-frame. The
//     ingest endpoint is open, because it has to be.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SCHEMA } from "./schema.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const ID_RE = /^[0-9a-f]{16}$/;

export function createApp(config) {
  const cfg = config || {};
  const store = cfg.store;
  // the bench's verdict channel (build 69) — its own store, its own family
  // of day files, so trace retention and feedback retention stay separable
  const feedback = cfg.feedback || null;
  const now = typeof cfg.now === "function" ? cfg.now : () => Date.now();
  const origins = Array.isArray(cfg.origins) ? cfg.origins : ["*"];
  const maxBodyBytes = cfg.maxBodyBytes || 256 * 1024;
  const perMinute = (cfg.rateLimit && cfg.rateLimit.perMinute) || 120;
  const viewer = cfg.viewer || null;

  // ---- rate limiting without keeping an identity --------------------------
  // The address is hashed with a secret that this process invented at start-up
  // and replaces every hour, and the map is memory only. So the counter can
  // tell "same sender, this hour" apart and cannot tell anyone who that was —
  // not even us, and not from a core dump an hour later.
  let salt = randomBytes(32);
  let saltHour = Math.floor(now() / 3600e3);
  let counts = new Map();
  let countMinute = Math.floor(now() / 60e3);

  function rateKey(headers) {
    const hour = Math.floor(now() / 3600e3);
    if (hour !== saltHour) { salt = randomBytes(32); saltHour = hour; counts = new Map(); }
    const fwd = headers["x-forwarded-for"] || headers["x-real-ip"] || headers["remote-address"] || "";
    const first = String(fwd).split(",")[0].trim();
    return createHmac("sha256", salt).update(first).digest("hex").slice(0, 16);
  }

  function overLimit(headers) {
    const minute = Math.floor(now() / 60e3);
    if (minute !== countMinute) { counts = new Map(); countMinute = minute; }
    const key = rateKey(headers);
    const n = (counts.get(key) || 0) + 1;
    counts.set(key, n);
    return n > perMinute;
  }

  // ---- CORS ---------------------------------------------------------------
  function corsFor(headers) {
    const origin = headers.origin || headers.Origin || "";
    if (!origin) return { allowed: true, headers: {} };
    const any = origins.includes("*");
    if (!any && !origins.includes(origin)) return { allowed: false, headers: {} };
    return {
      allowed: true,
      headers: {
        "access-control-allow-origin": any ? "*" : origin,
        "access-control-allow-methods": "POST, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
        vary: "Origin",
        // deliberately no allow-credentials: this endpoint has no session and
        // must never be reachable as one
      },
    };
  }

  const reply = (status, body, headers) => ({
    status,
    headers: Object.assign({ "x-content-type-options": "nosniff" }, headers || {}),
    body: body === undefined ? "" : body,
  });

  // ---- viewer authentication ----------------------------------------------
  function authorised(headers) {
    if (!viewer || !viewer.user) return true;      // no password configured: open
    const raw = headers.authorization || "";
    const m = /^Basic\s+(.+)$/i.exec(raw);
    if (!m) return false;
    let decoded = "";
    try { decoded = Buffer.from(m[1], "base64").toString("utf8"); } catch (err) { void err; return false; }
    const idx = decoded.indexOf(":");
    if (idx < 0) return false;
    const given = Buffer.from(decoded.slice(0, idx) + "\u0000" + decoded.slice(idx + 1));
    const want = Buffer.from(viewer.user + "\u0000" + viewer.pass);
    if (given.length !== want.length) {
      // still spend the comparison, so length is not a faster "no"
      timingSafeEqual(want, want);
      return false;
    }
    return timingSafeEqual(given, want);
  }

  const needAuth = () => reply(401, "Zugang nur mit Passwort.\n", {
    "www-authenticate": 'Basic realm="frunky traces", charset="UTF-8"',
    "content-type": "text/plain; charset=utf-8",
  });

  async function handle(req) {
    const method = (req.method || "GET").toUpperCase();
    const path = (req.path || "/").split("?")[0];
    const headers = req.headers || {};
    const cors = corsFor(headers);

    if (method === "OPTIONS") {
      if (!cors.allowed) return reply(403, "");
      return reply(204, "", cors.headers);
    }
    if (!cors.allowed) return reply(403, "Origin nicht erlaubt.\n", JSON_HEADERS);

    // health says nothing about anybody, so it needs no password and no limit
    if (method === "GET" && path === "/api/health") {
      return reply(200, JSON.stringify({ status: "ok", v: SCHEMA.VERSION }), JSON_HEADERS);
    }

    if (overLimit(headers)) {
      return reply(429, "Zu viele Anfragen.\n",
        Object.assign({ "retry-after": "60" }, cors.headers));
    }

    if (method === "POST" && path === "/api/v1/trace") return ingest(req, cors);
    if (method === "DELETE" && path.startsWith("/api/v1/trace/")) return erase(path, cors);
    if (feedback && method === "POST" && path === "/api/v1/feedback") {
      return ingestFeedback(req, cors);
    }
    if (feedback && method === "DELETE" && path.startsWith("/api/v1/feedback/")) {
      return eraseFeedback(path, cors);
    }

    if (method === "GET" && path === "/api/v1/traces") {
      if (!authorised(headers)) return needAuth();
      return reply(200, JSON.stringify({ traces: store.list(), stats: store.stats() }), JSON_HEADERS);
    }
    if (method === "GET" && (path === "/" || path === "/index.html")) {
      if (!authorised(headers)) return needAuth();
      return reply(200, renderViewer(store.list(), store.stats(),
        feedback ? feedback.list() : []), {
        "content-type": "text/html; charset=utf-8",
        "x-frame-options": "DENY",
        "x-robots-tag": "noindex, nofollow",
        "cache-control": "no-store",
      });
    }
    return reply(404, "Nicht gefunden.\n", { "content-type": "text/plain; charset=utf-8" });
  }

  function ingest(req, cors) {
    const raw = typeof req.body === "string" ? req.body : "";
    if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) {
      return reply(413, "Zu gross.\n", cors.headers);
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (err) {
      void err;
      return reply(400, "Kein JSON.\n", cors.headers);
    }
    const r = SCHEMA.redactTrace(parsed);
    if (!r.ok) return reply(400, "Ungültiger Trace: " + r.reason + "\n", cors.headers);
    // A trace that arrives twice (the client retried, the first response was
    // lost) replaces its earlier self rather than doubling it.
    try { store.remove(r.trace.id); } catch (err) { void err; }
    store.append(r.trace);
    return reply(204, "", cors.headers);
  }

  function erase(path, cors) {
    const id = decodeURIComponent(path.slice("/api/v1/trace/".length));
    if (!ID_RE.test(id)) return reply(400, "Ungültige Kennung.\n", cors.headers);
    store.remove(id);
    // an unknown id answers exactly like a known one: the endpoint must not
    // become a way of asking which drives exist
    return reply(204, "", cors.headers);
  }

  // feedback walks the same doors as a trace: redacted by the shared schema
  // before anything touches disk, replaced on retry, erased by its own id
  function ingestFeedback(req, cors) {
    const raw = typeof req.body === "string" ? req.body : "";
    if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) {
      return reply(413, "Zu gross.\n", cors.headers);
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (err) {
      void err;
      return reply(400, "Kein JSON.\n", cors.headers);
    }
    const r = SCHEMA.redactFeedback(parsed);
    if (!r.ok) return reply(400, "Ungültiges Feedback: " + r.reason + "\n", cors.headers);
    try { feedback.remove(r.feedback.id); } catch (err) { void err; }
    feedback.append(r.feedback);
    return reply(204, "", cors.headers);
  }

  function eraseFeedback(path, cors) {
    const id = decodeURIComponent(path.slice("/api/v1/feedback/".length));
    if (!ID_RE.test(id)) return reply(400, "Ungültige Kennung.\n", cors.headers);
    feedback.remove(id);
    return reply(204, "", cors.headers);
  }

  return { handle, __rateKeys: () => [...counts.keys()] };
}

// ---- the viewer -----------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function renderViewer(traces, stats, feedbackList) {
  const fb = Array.isArray(feedbackList) ? feedbackList : [];
  const rows = traces.map((t) => {
    const end = t.end || {};
    const mins = end.t ? (end.t / 60000).toFixed(1) : "—";
    const worst = end.worstFreeze ? Math.round(end.worstFreeze) + " ms" : "—";
    const lt = (t.samples || []).reduce((a, s) => a + (s.lt || 0), 0);
    return "<tr data-id=\"" + esc(t.id) + "\">" +
      "<td class=\"mono\">" + esc(t.id.slice(0, 8)) + "</td>" +
      "<td>" + esc(new Date(t.at).toISOString().replace("T", " ").slice(0, 13)) + "h</td>" +
      // the vendor tokens rather than the five-way class: an Android Automotive
      // car reports plain "Android" and would read here as a phone
      "<td title=\"" + esc(t.platform) + "\">" + esc(t.ua || t.platform) + "</td>" +
      "<td>" + (t.engineMajor ? esc(String(t.engineMajor)) : "—") + "</td>" +
      "<td>" + (t.hw ? esc(String(t.hw)) + "×" : "—") +
        (t.mem ? " / " + esc(String(t.mem)) + "G" : "") + "</td>" +
      "<td>" + esc(t.build) + "</td>" +
      "<td>" + (t.lite ? "sparsam" : "voll") + "</td>" +
      "<td>" + mins + "</td>" +
      "<td class=\"" + (end.reason === "unload" ? "bad" : "") + "\">" +
        esc(String(end.reason || "offen")) + "</td>" +
      "<td class=\"" + (end.freezes ? "bad" : "") + "\">" + esc(String(end.freezes ?? "—")) + "</td>" +
      "<td>" + worst + "</td>" +
      "<td>" + esc(String(end.minNotes ?? "—")) + "–" + esc(String(end.maxNotes ?? "—")) + "</td>" +
      "<td>" + Math.round(lt) + " ms</td>" +
      "</tr>";
  }).join("\n");

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Frunky · Fahrten</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 1.4rem; background: #0b0d10; color: #dfe4ea;
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size: 1.1rem; letter-spacing: .12em; text-transform: uppercase; color: #6ee7ff; margin: 0 0 .2rem; }
  p.sub { color: #7c8794; margin: 0 0 1.2rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #1b212a; white-space: nowrap; }
  th { color: #7c8794; font-weight: 500; position: sticky; top: 0; background: #0b0d10; }
  tr:hover { background: #131820; cursor: pointer; }
  .mono { color: #6ee7ff; }
  .bad { color: #ff6b6b; }
  #detail { margin-top: 1.4rem; padding: 1rem; background: #10151c; border-radius: 8px; display: none; }
  #detail.on { display: block; }
  canvas { width: 100%; height: 130px; display: block; margin: .6rem 0; }
  .legend span { margin-right: 1.2rem; }
  .ev { color: #ffd166; }
  .empty { color: #7c8794; padding: 2rem 0; }
</style></head><body>
<h1>Frunky · Fahrten</h1>
<p class="sub">${traces.length} Fahrten gespeichert · ${stats.files} Tagesdateien ·
  keine Positionen, keine Adressen, keine dauerhafte Kennung</p>
${traces.length ? `<table>
<thead><tr><th>Kennung</th><th>Angekommen (UTC)</th><th>Gerät</th><th>Engine</th><th>Maschine</th><th>Build</th><th>Modus</th>
<th>Minuten</th><th>Ende</th><th>Freezes</th><th>schlimmster</th><th>Noten/s</th><th>lange Aufg.</th></tr></thead>
<tbody>
${rows}
</tbody></table>` : '<p class="empty">Noch keine Fahrt angekommen.</p>'}
<div id="detail"></div>
<h1 style="margin-top:2rem">Feedback · Testbank</h1>
${fb.length ? `<table>
<thead><tr><th>Wann (UTC)</th><th>Build</th><th>Urteil</th><th>Kontext</th><th>Text</th></tr></thead>
<tbody>
${fb.map((f) => {
    const c = f.ctx || {};
    const ctx = ["Stück " + (c.num ?? "—"), c.part, c.recipe, c.mood, c.scene,
      typeof c.kmh === "number" ? c.kmh + " km/h" : ""]
      .filter(Boolean).join(" · ");
    return "<tr>" +
      "<td>" + esc(new Date(f.at).toISOString().replace("T", " ").slice(0, 13)) + "h</td>" +
      "<td>" + esc(f.build || "—") + "</td>" +
      "<td>" + (f.verdict === "up" ? "👍" : f.verdict === "down" ? "👎" : "✎") + "</td>" +
      "<td>" + esc(ctx) + "</td>" +
      '<td style="white-space:normal;max-width:44ch">' + esc(f.text || "") + "</td>" +
      "</tr>";
  }).join("\n")}
</tbody></table>` : '<p class="empty">Noch kein Feedback von der Testbank.</p>'}
<script id="data" type="application/json">${JSON.stringify(traces).replace(/</g, "\\u003c")}</script>
<script>
(() => {
  const data = JSON.parse(document.getElementById("data").textContent);
  const byId = new Map(data.map((t) => [t.id, t]));
  const detail = document.getElementById("detail");
  const LABELS = ${JSON.stringify(SCHEMA.SPEED_LABELS)};

  function plot(trace) {
    const s = trace.samples || [];
    if (!s.length) return "<p>Keine Messpunkte.</p>";
    const w = 900, h = 120, pad = 4;
    const maxT = Math.max(1, s[s.length - 1].t);
    const x = (t) => pad + (t / maxT) * (w - 2 * pad);
    const line = (get, max, colour) => {
      const m = Math.max(1, max);
      return '<polyline fill="none" stroke="' + colour + '" stroke-width="1.5" points="' +
        s.map((p) => x(p.t).toFixed(1) + "," + (h - pad - (get(p) / m) * (h - 2 * pad)).toFixed(1)).join(" ") +
        '"/>';
    };
    const maxNotes = Math.max(...s.map((p) => p.notes), 1);
    // the render thread's own load, where the browser reported one (-1 = no
    // probe on that device, and pre-probe builds default to -1 on arrival)
    const hasRender = s.some((p) => typeof p.rload === "number" && p.rload >= 0);
    // a thumb is the driver's own verdict — it must not drown among the
    // yellow diagnostics: up is green, down is red, and it draws solid
    const marks = (trace.events || []).map((e) => {
      const colour = e.kind === "thumb"
        ? (e.code === "up" ? "#7dff9b" : "#ff6b6b") : "#ffd166";
      const dash = e.kind === "thumb" ? "" : ' stroke-dasharray="2 3"';
      return '<line x1="' + x(e.t).toFixed(1) + '" y1="0" x2="' + x(e.t).toFixed(1) +
        '" y2="' + h + '" stroke="' + colour + '"' + dash + ' opacity=".8"/>';
    }).join("");
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:150px">' +
      marks +
      line((p) => p.speed, 13, "#6ee7ff") +
      line((p) => p.notes, maxNotes, "#7dff9b") +
      line((p) => p.load, 100, "#ff9f6b") +
      (hasRender ? line((p) => Math.max(p.rload || 0, 0), 100, "#e07dff") : "") +
      "</svg>";
  }

  function show(id) {
    const t = byId.get(id);
    if (!t) return;
    const audioStates = [...new Set((t.samples || []).map((s) => s.audio).filter(Boolean))];
    const underruns = Math.max(0, ...(t.samples || []).map((s) => s.under || 0));
    const evs = (t.events || []).map((e) =>
      '<span class="ev">' + Math.round(e.t / 1000) + "s " + e.kind +
      (e.code ? "/" + e.code : "") + (e.n ? " " + e.n : "") + "</span>").join(" ");
    detail.innerHTML =
      "<strong>" + t.id + "</strong> · " + (t.ua || t.platform) +
      (t.engineMajor ? " (Engine " + t.engineMajor + ")" : "") + " · Build " + t.build +
      " · " + (t.lite ? "Sparmodus" : "voller Graph") +
      " · Kurve " + (t.opts && t.opts.curveOutward ? "aussen" : "innen") +
      " · Tiefe " + (t.opts && t.opts.inertiaDepth ? "an" : "aus") +
      (t.hw ? " · " + t.hw + " Kerne" : "") + (t.mem ? " / " + t.mem + " GB" : "") +
      (audioStates.length
        ? ' · Audio <span class="' + (audioStates.some((a) => a !== "running") ? "bad" : "") + '">' +
          audioStates.join(", ") + "</span>"
        : "") +
      (underruns > 0 ? ' · <span class="bad">' + underruns + " Underrun-Fenster</span>" : "") +
      plot(t) +
      '<p class="legend"><span style="color:#6ee7ff">Tempo (Klassen ' + LABELS[0] + "…" + LABELS[13] + ")</span>" +
      '<span style="color:#7dff9b">Noten/s</span><span style="color:#ff9f6b">Last</span>' +
      '<span style="color:#e07dff">Render-Last</span>' +
      '<span style="color:#ffd166">Ereignisse</span></p>' +
      "<p>" + (evs || "keine Ereignisse") + "</p>" +
      (t.msgs && t.msgs.length ? "<p>Meldungen: " + t.msgs.join(" · ") + "</p>" : "");
    detail.classList.add("on");
    detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.querySelectorAll("tr[data-id]").forEach((tr) =>
    tr.addEventListener("click", () => show(tr.dataset.id)));
  if (data.length) show(data[0].id);
})();
</script>
</body></html>`;
}
