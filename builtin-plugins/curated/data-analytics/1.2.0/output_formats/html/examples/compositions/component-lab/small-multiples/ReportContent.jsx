import React from "react";
import { SharedSmallMultiplesExample } from "../shared/small-multiples/SharedSmallMultiplesExample.jsx";

export function ReportContent() {
  return <article className="report-content"><header className="report-hero">
    <h1>Regional revenue index</h1>
    <p className="report-deck">Synthetic sample · January–June 2026 · January = 100 in each region.</p>
    <p>Compare each region's movement from its January baseline. Missing observations remain gaps.</p>
  </header><SharedSmallMultiplesExample /></article>;
}
