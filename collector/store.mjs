// Where traces live: one newline-delimited JSON file per day, in one directory.
//
// A database would be the reflex and a day-file is the better answer for this
// job, because the promise that matters is retention — and with a file per day,
// retention is `unlink`. Nothing has to remember to run a DELETE, nothing can
// leave rows behind in an index or a WAL, and "is it really gone?" is answered
// by looking at the directory rather than by trusting a query.
//
// The other reason is inspection: when something goes wrong at three in the
// morning in a car, the evidence should be greppable.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync,
  unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const DAY_MS = 24 * 3600e3;
const FILE_RE = /^frunky-(\d{4})-(\d{2})-(\d{2})\.ndjson$/;

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const fileFor = (ms) => "frunky-" + dayKey(ms) + ".ndjson";

// The end of the day a file covers — the youngest a record in it can be. Using
// the day's END is what stops a sweep from deleting a file holding records that
// are still inside the window.
function dayEnd(name) {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) + DAY_MS;
}

export function createStore(config) {
  const cfg = config || {};
  const dir = cfg.dir;
  const now = typeof cfg.now === "function" ? cfg.now : () => Date.now();
  const retentionMs = (cfg.retentionDays || 30) * DAY_MS;

  mkdirSync(dir, { recursive: true });

  const files = () => (existsSync(dir) ? readdirSync(dir).filter((f) => FILE_RE.test(f)).sort() : []);

  // A half-written line after a power cut must not cost the whole day. Every
  // line is parsed on its own and an unreadable one is simply not a record.
  function readFile(name) {
    let text = "";
    try { text = readFileSync(join(dir, name), "utf8"); } catch (err) { void err; return []; }
    const out = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && typeof rec === "object" && typeof rec.id === "string") out.push(rec);
      } catch (err) { void err; }
    }
    return out;
  }

  // Arrival is stamped to the hour. Finding a report again needs about that
  // much; timing somebody's journey needs more, and there is no reason for us
  // to be able to do the second in order to do the first.
  const stampHour = (ms) => Math.floor(ms / 3600e3) * 3600e3;

  function append(trace) {
    const at = stampHour(now());
    const record = Object.assign({ at }, trace);
    appendFileSync(join(dir, fileFor(now())), JSON.stringify(record) + "\n");
    return record;
  }

  function list() {
    const cutoff = now() - retentionMs;
    const out = [];
    for (const f of files()) {
      for (const rec of readFile(f)) {
        // filtered as well as swept: a record must not be readable past its
        // retention just because the sweep timer has not fired yet
        if (typeof rec.at === "number" && rec.at < cutoff) continue;
        out.push(rec);
      }
    }
    out.sort((a, b) => (b.at - a.at) || String(a.id).localeCompare(String(b.id)));
    return out;
  }

  function get(id) {
    return list().find((r) => r.id === id) || null;
  }

  // Retention as an unlink. Returns how many records went with the files, so
  // the caller can say something true in a log line.
  function sweep() {
    const cutoff = now() - retentionMs;
    let removed = 0;
    for (const f of files()) {
      const end = dayEnd(f);
      if (end == null || end >= cutoff) continue;
      try {
        removed += readFile(f).length;
        unlinkSync(join(dir, f));
      } catch (err) { void err; }
    }
    return removed;
  }

  // Erasure on request. The id is the only handle on a record and whoever holds
  // it is the only person who ever had it, so possession of the id is the whole
  // authorisation — there is no account here to check it against.
  function remove(id) {
    let removed = 0;
    for (const f of files()) {
      const recs = readFile(f);
      if (!recs.some((r) => r.id === id)) continue;
      const kept = recs.filter((r) => r.id !== id);
      removed += recs.length - kept.length;
      const path = join(dir, f);
      if (kept.length) writeFileSync(path, kept.map((r) => JSON.stringify(r)).join("\n") + "\n");
      else { try { unlinkSync(path); } catch (err) { void err; } }
    }
    return removed;
  }

  function stats() {
    const all = list();
    return { traces: all.length, files: files().length,
      oldest: all.length ? all[all.length - 1].at : null };
  }

  return { append, list, get, sweep, remove, stats, dir };
}
