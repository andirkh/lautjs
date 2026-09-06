import { Button } from "kinu";
import { useEffect, useState } from "preact/hooks";
import "./Deferred.css";

// Placed with `when="visible"`, so the browser does not fetch this module until
// the island is about to scroll into view. Everything below is server-rendered
// either way -- what waits is the JavaScript, not the HTML.
export default function Deferred() {
  const [at, setAt] = useState<string | null>(null);
  const [clicks, setClicks] = useState(0);

  // An effect never runs on the server, so this timestamp is the moment the
  // island's module actually arrived in the browser. Scroll back up, reload,
  // and watch the line below change only once you come back down.
  useEffect(() => setAt(new Date().toLocaleTimeString()), []);

  return (
    <section class="panel">
      <h2>Deferred island</h2>
      <p class="muted">
        {at
          ? `Hydrated at ${at} — scrolling here is what fetched it.`
          : "Server-rendered. Not hydrated yet."}
      </p>
      <Button onClick={() => setClicks(clicks + 1)}>Clicked {clicks}×</Button>
    </section>
  );
}
