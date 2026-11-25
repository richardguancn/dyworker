import React from "react";
import { SharedSmallMultiplesExample } from "../shared/small-multiples/SharedSmallMultiplesExample.jsx";

export function DashboardContent() {
  return <section className="small-multiples-dashboard"><header>
    <h1>Regional revenue index</h1>
    <p>Synthetic sample · January–June 2026 · January = 100 in each region.</p>
    <p>Compare each region's movement from its January baseline. Missing observations remain gaps.</p>
  </header><SharedSmallMultiplesExample /></section>;
}
