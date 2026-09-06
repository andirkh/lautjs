import "./Widget.css";

export function Widget({ label = "widget" }: { label?: string }) {
  return (
    <div>
      <button type="button">{label}</button>
    </div>
  );
}
