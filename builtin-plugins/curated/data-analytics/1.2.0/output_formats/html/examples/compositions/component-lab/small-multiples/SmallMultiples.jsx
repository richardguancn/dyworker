import React from "react";
import { EvidenceChart } from "../../../data-app-public.jsx";
import "./example.css";

// Authored layout recipe. EvidenceChart retains the shell's saved edits/actions.
export function SmallMultiples({ panels, columns = 3, spec }) {
  if (![1, 2, 3].includes(columns)) throw new Error("SmallMultiples supports one, two, or three columns.");
  return <section className="small-multiples" aria-label="Regional comparison">
    <div className="small-multiples-grid" data-columns={columns} style={{ "--small-multiples-columns": columns }}>
      {panels.map(({ id, title, queryId, rows, sourceRows }) =>
        <EvidenceChart key={id} id={id} title={title} queryId={queryId}
          spec={spec} rows={rows} sourceRows={sourceRows} height={240} />)}
    </div>
  </section>;
}
