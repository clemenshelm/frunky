// Why did the page stop?
//
// A fourteen-second gap in the frame loop has several possible causes, and they
// need completely different answers: our own JavaScript blocking the thread is
// a bug we can fix; the browser deciding not to run the page is not. Guessing
// between them has already cost several test drives, so the page measures the
// four things that actually discriminate and this turns them into a verdict.
//
// The decisive one is the long-task record. If the browser reports long tasks
// covering the gap, the thread was busy — with our code. If it reports none
// while the page was visible, the page was not running at all, which is a
// suspension no amount of optimisation would have prevented.
(() => {
  "use strict";

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  function classifyFreeze(sample) {
    const ms = num(sample && sample.ms);
    const longtaskMs = num(sample && sample.longtaskMs);
    const heapDelta = num(sample && sample.heapDelta);
    const wasHidden = sample && sample.wasHidden === true;

    if (ms == null) {
      return { verdict: "unknown", detail: "Keine verwertbare Messung der Lücke." };
    }
    if (wasHidden) {
      return {
        verdict: "hidden",
        detail: "Die Seite war im Hintergrund. Ein Browser darf sie dann anhalten — " +
          "die Musik muss danach von selbst zurückkommen, verhindern lässt es sich nicht.",
      };
    }
    if (longtaskMs == null) {
      return {
        verdict: "unknown",
        detail: "Dieser Browser meldet keine langen Aufgaben, also lässt sich nicht " +
          "unterscheiden, ob unser Code blockiert hat oder die Seite angehalten wurde.",
      };
    }
    // "most of the gap" rather than "all of it": the observer only reports tasks
    // above 50 ms and cannot see the scheduling around them
    if (longtaskMs >= ms * 0.6) {
      if (heapDelta != null && heapDelta < -50e6) {
        return {
          verdict: "gc",
          detail: "Lange Aufgaben über fast die ganze Lücke, und der Speicher fiel " +
            "dabei deutlich — das sieht nach Aufräumen unter Speicherdruck aus.",
        };
      }
      return {
        verdict: "our-js",
        detail: "Lange Aufgaben decken die Lücke ab: unser eigener Code hat den " +
          "Hauptthread blockiert. Das ist ein Fehler, den wir finden können.",
      };
    }
    if (longtaskMs <= ms * 0.15) {
      return {
        verdict: "browser-stopped",
        detail: "Die Seite war sichtbar und hat trotzdem fast nichts ausgeführt — " +
          "der Browser hat sie angehalten. Nicht unser Code; wir können nur " +
          "sauber daraus zurückkommen.",
      };
    }
    return {
      verdict: "mixed",
      detail: "Teils lange Aufgaben, teils gar keine Ausführung — beides zusammen. " +
        "Mehr Fahrten nötig, um das zu trennen.",
    };
  }

  window.FrunkyDiag = { classifyFreeze };
})();
