#!/usr/bin/env node
import { parseArgs } from "node:util";
import { previewCommand } from "./preview/lifecycle.mjs";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "project-dir": { type: "string" }, port: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) console.log("Usage: <codex-node> data-app-preview.mjs list | <start|status|stop|remove> --project-dir <app-project> [--port <number>]");
  else {
    if (positionals.length !== 1) throw new Error("Specify exactly one preview command: start, status, stop, list, or remove.");
    const result = await previewCommand(positionals[0], {
      projectDir: values["project-dir"], port: values.port === undefined ? undefined : Number(values.port),
    });
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
