// The collector reads the browser's own schema file. Not a copy of it, not an
// equivalent of it — the same bytes, loaded from ../trace-schema.js.
//
// A second definition would be the ordinary way to build this and the wrong
// one: two lists drift, and a drifted server-side filter passes exactly the
// fields the client stopped sending, which is the opposite of a check. The
// awkward `eval` of a browser IIFE is the price of there being one definition,
// and it is cheaper than the class of bug it removes.
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../trace-schema.js", import.meta.url), "utf8");
(0, eval)(source);

export const SCHEMA = globalThis.FrunkyTraceSchema;

if (!SCHEMA || typeof SCHEMA.redactTrace !== "function") {
  throw new Error("trace-schema.js did not define FrunkyTraceSchema");
}
