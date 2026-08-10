// Wiring guard. The engine now lives in its own file and two pages call into
// it, so a renamed or dropped API method breaks a page that no other test
// loads — silently, because a static site has no build step to notice.
// This asserts that every Frunky.* / FrunkyGeo.* a page calls actually exists,
// and that each page loads the scripts it needs.
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const engine = read("engine.js");
const geo = read("geo.js");
const drive = read("index.html");
const bench = read("bench.html");

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

// what the modules publish
const published = (src, global) => {
  const m = src.match(new RegExp("window\\." + global + "\\s*=\\s*\\{([\\s\\S]*?)\\};"));
  if (!m) return null;
  return new Set(
    m[1].split(",").map((part) => (part.split(":")[0] || "").trim())
      .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
  );
};
const engineApi = published(engine, "Frunky");
const geoApi = published(geo, "FrunkyGeo");
ok("engine.js publishes a window.Frunky object literal", engineApi && engineApi.size > 0);
ok("geo.js publishes a window.FrunkyGeo object literal", geoApi && geoApi.size > 0);

// what the pages call
const calls = (src, global) =>
  [...src.matchAll(new RegExp(global + "\\.([A-Za-z_$][\\w$]*)", "g"))].map((m) => m[1]);

for (const [name, src] of [["index.html", drive], ["bench.html", bench]]) {
  for (const fn of calls(src, "Frunky")) {
    if (engineApi && !engineApi.has(fn)) failures.push(`${name} calls Frunky.${fn}, which engine.js does not export`);
  }
  for (const fn of calls(src, "FrunkyGeo")) {
    if (geoApi && !geoApi.has(fn)) failures.push(`${name} calls FrunkyGeo.${fn}, which geo.js does not export`);
  }
}

// a page that forgets a <script> fails with a bare ReferenceError in the car
ok("driver page loads Tone", drive.includes('src="vendor/Tone.js"'));
// the version query is how a car browser with no hard reload gets fresh code
ok("driver page loads the engine", /src="engine\.js(\?v=\d+)?"/.test(drive));
ok("driver page loads the GPS reader", /src="geo\.js(\?v=\d+)?"/.test(drive));
ok("bench loads Tone", bench.includes('src="vendor/Tone.js"'));
ok("bench loads the engine", /src="engine\.js(\?v=\d+)?"/.test(bench));

// the two pages must stay distinct in role: only the driver page reads real
// GPS, only the bench simulates one. Mixing them up is how a "fixed" bug turns
// out to have been fixed on the page nobody drives with
ok("driver page watches real position", drive.includes("watchPosition"));
ok("bench does not read real GPS", !bench.includes("watchPosition"));
ok("bench still simulates the degraded signal", bench.includes("advanceSim"));
ok("driver page does not simulate a drive", !drive.includes("advanceSim"));

// the engine must stay host-agnostic — the moment it touches the DOM it can
// only be tested through a page again
ok("engine.js touches no DOM", !/\bdocument\.|getElementById|requestAnimationFrame/.test(engine));

// both pages carry a build stamp: reviewing a stale cached copy has cost this
// project two full feedback rounds already
ok("driver page stamps its build", drive.includes("lastModified"));
// the build number must reach the report, or a stale run is indistinguishable
// from a fresh one — which cost three field tests
ok("the driver page reports its build number", /const BUILD = "\d+"/.test(drive));
ok("and the script query matches it",
  (drive.match(/const BUILD = "(\d+)"/) || [])[1] === (drive.match(/engine\.js\?v=(\d+)/) || [])[1]);
ok("bench stamps its build", bench.includes("lastModified"));

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PAGES_OK");
