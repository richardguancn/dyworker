import { cpSync } from "node:fs";
import { join } from "node:path";
import { assembleDataAppTemplate } from "../../../scripts/prepare-data-app.mjs";

// Populate the report surface; an unrelated example dashboard would introduce
// queries that are absent from this report's reviewed snapshot.
export function prepareReportExample(template, project) {
  assembleDataAppTemplate(template, project, { blankContent: true });
  cpSync(join(template, "starters/report/content"), join(project, "src/content"), { recursive: true });
  cpSync(join(template, "src/content/report/report.css"), join(project, "src/content/report/report.css"));
}
