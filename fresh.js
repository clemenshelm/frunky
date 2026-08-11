// Freshness check — the second half of the cache fix. The server now sends
// the HTML with `Cache-Control: no-store`, which cures a stale REFETCH; this
// file cures the tab that is never refetched at all. A car browser keeps its
// tab alive across drives for days, so the Tesla played a build the deploys
// had long replaced, and every ?v= bump sat unseen on the server.
//
// It polls version.json (tiny, no-store, same origin) and reloads the page
// when a strictly newer build is live — but only when a reload cannot ruin
// anything: parked or not yet playing, at most once per session, and never
// on a payload it does not fully understand. The set state (frunky.set.v1)
// survives a reload by design, so the music resumes as the next episode.
//
// This file's fetch is the only network exit besides trace.js, and it is a
// bodyless same-origin GET of a static file: nothing about the drive, the
// device or the user travels with it. The pages test pins that shape.
(() => {
  "use strict";

  // pure: true = reload now. Every branch is exercised by test/fresh.test.mjs.
  function decide(state) {
    const s = state || {};
    if (s.reloaded) return false;                  // once per session, ever
    const local = parseBuild(s.local);
    const remote = parseBuild(s.remote);
    if (local === null || remote === null) return false;
    if (remote <= local) return false;             // equal or a rollback: stay
    if (s.running && s.speed > 2) return false;    // never mid-drive
    return true;
  }

  function parseBuild(v) {
    if (typeof v !== "string" || !/^\d+$/.test(v)) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }

  // wiring: poll every few minutes and whenever the tab becomes visible —
  // the moment a parked car's browser comes back is exactly when a reload
  // is both safe and useful.
  function start(opts) {
    const o = opts || {};
    const local = o.build;
    const getState = o.getState || (() => ({ running: false, speed: 0 }));
    const onReload = o.onReload || (() => window.location.reload());
    const intervalMs = o.intervalMs || 5 * 60 * 1000;
    let reloaded = false;

    async function check() {
      if (reloaded) return;
      let remote;
      try {
        const res = await fetch("version.json", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        remote = data && data.build;
      } catch (err) { void err; return; }          // offline is normal weather
      const st = getState();
      if (decide({
        local, remote,
        running: !!st.running, speed: st.speed || 0, reloaded,
      })) {
        reloaded = true;
        onReload();
      }
    }

    const timer = setInterval(check, intervalMs);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    check();
    return { check, stop: () => clearInterval(timer) };
  }

  window.FrunkyFresh = { decide, start };
})();
