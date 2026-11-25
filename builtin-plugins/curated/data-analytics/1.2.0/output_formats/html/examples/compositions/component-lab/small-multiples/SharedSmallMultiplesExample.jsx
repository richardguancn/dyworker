import React from "react";
import { useDataApp } from "../../../data-app-public.jsx";
import { SmallMultiples } from "./SmallMultiples.jsx";
import { buildPanels, chartSpec, regionDefinitions } from "./fixture.mjs";

export function SharedSmallMultiplesExample() {
  const { reviewedRows } = useDataApp();
  const regionalPanels = buildPanels(Object.fromEntries(regionDefinitions.map(({ queryId }) =>
    [queryId, reviewedRows(queryId, ["month"])])));
  return <SmallMultiples panels={regionalPanels} columns={3} spec={chartSpec} />;
}
