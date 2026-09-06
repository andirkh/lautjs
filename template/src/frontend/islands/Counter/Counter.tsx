import { Button } from "kinu";
import { count, inc, reset } from "../../core/state/counter.ts";
import "./Counter.css";

// An island is a plain Preact component with a default export. The folder is
// its own: the component, its stylesheet, and any sub-component it owns.
export default function Counter({ step = 1 }: { step?: number }) {
  return (
    <section class="panel">
      <h2>Counter</h2>
      <div class="row">
        <Button variant="outline" onClick={() => inc(-step)}>
          −{step}
        </Button>
        <Button onClick={() => inc(step)}>+{step}</Button>
        <Button variant="ghost" onClick={reset}>
          Reset
        </Button>
      </div>
      {/* `count` is a signal: stringify it and this island re-renders on change */}
      <p class="muted">Value: {count}</p>
    </section>
  );
}
