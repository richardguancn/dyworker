import { BROWSER_BRAND_COLORS } from "./browserUtils";

export function BrowserBrandMark({ id, name }: { id: string; name: string }) {
  const color = BROWSER_BRAND_COLORS[id] || "#8a8f85";
  const initial = id === "qaxbrowser" ? "奇" : id === "browser360" ? "360" : name.trim().charAt(0).toUpperCase() || "?";
  return <span className="browser-brand-mark" style={{ background: color }} aria-hidden="true">{initial}</span>;
}
