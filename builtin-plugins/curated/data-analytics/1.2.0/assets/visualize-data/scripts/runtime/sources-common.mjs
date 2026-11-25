import { createHash } from "node:crypto";

import {
  reviewedSource,
  reviewedQueryLink,
  safeSourceHref,
  scopedMetricDefinitions,
} from "../../../../output_formats/html/src/source-provenance.js";

export const MAX_INLINE_ROWS = 2_000;
export const MAX_INLINE_INPUT_BYTES = 2_000_000;
export const MAX_INLINE_FRAGMENT_BYTES = 1_000_000;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const sensitiveParameter =
  /(?:^|_)(?:auth|authorization|credential|credentials|password|secret|session|signature|sig|token|api_key|access_key)(?:_|$)|^(?:code|awsaccesskeyid|googleaccessid)$/iu;
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
// Catch common sensitive literals, including in comments. This supplements an
// explicit review of the full executed statement; it cannot certify arbitrary SQL.
const sensitiveSql = [
  /\b(?:Bearer\s+[a-z\d._-]{12,}|sk-[a-z\d_-]{20,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /\b(?:password|passwd|pwd|api[_-]?key|access[_-]?token|secret)["'`\]]?\s*[=:]\s*["'][^"']+["']/iu,
  /\b(?:password|passwd|pwd)\s*=\s*[^\s;'"),]+/iu,
  /\b[a-z][a-z\d+.-]{0,31}:\/\/[^\s/]{1,512}:[^\s/]{1,512}@|\b(?:jdbc|odbc):|\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|mssql|sqlserver|oracle|snowflake|redshift):\/\//iu,
  /\b[a-z\d._%+-]{1,64}@[a-z\d.-]{1,253}\.[a-z]{2,63}\b/iu,
  /(?:\(\d{3}\)\s*|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b|["']\+\d(?:[ .()-]*\d){7,14}["']|\b\d{3}-\d{2}-\d{4}\b/u,
  /\b(?:[a-z\d]+_)*(?:phone|telephone|mobile|ssn|social_?security|credit_?card|card_?number|account_?number)(?:_?number)?["'`\]]?\s*(?:=|IN\s*\()\s*(?:["'][^"']+["']|\d+)/iu,
];

function fail(message) {
  throw new Error(`Invalid inline chart: ${message}`);
}
function object(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
function text(value, name, { optional = false, max = 500 } = {}) {
  if (optional && (value == null || value === "")) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    fail(`${name} must be a nonempty string of at most ${max} characters.`);
  }
  return value.trim();
}
function scalar(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}
export function assertJson(value, path = "input", depth = 0) {
  if (depth > 16) fail(`${path} is nested too deeply.`);
  if (scalar(value)) {
    if (typeof value === "string" && value.length > 100_000) fail(`${path} is too long.`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_INLINE_ROWS * 8) fail(`${path} has too many entries.`);
    value.forEach((item, index) => assertJson(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!object(value)) fail(`${path} must contain JSON values only.`);
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) fail(`${path} contains a forbidden property.`);
    assertJson(child, `${path}.${key}`, depth + 1);
  }
}
function timestamp(value, name) {
  if (value == null || value === "") return undefined;
  const result = text(value, name, { max: 100 });
  if (!Number.isFinite(Date.parse(result))) fail(`${name} must be a real recorded timestamp.`);
  return result;
}
function assertCredentialFreeHref(value) {
  if (typeof value !== "string") return;
  let url;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  const sensitive = (key) => {
    const normalized = key.replace(/([a-z\d])([A-Z])/gu, "$1_$2").replaceAll("-", "_");
    return (
      sensitiveParameter.test(normalized) ||
      /^(?:awsaccesskeyid|googleaccessid)$/iu.test(normalized.replaceAll("_", ""))
    );
  };
  const fragment = url.hash.slice(1);
  const fragmentParameters = new URLSearchParams(
    fragment.includes("?") ? fragment.slice(fragment.indexOf("?") + 1) : fragment,
  );
  if (url.username || url.password || [...url.searchParams.keys(), ...fragmentParameters.keys()].some(sensitive)) {
    fail("source links must not contain credentials or access tokens.");
  }
}
function cleanHref(value) {
  assertCredentialFreeHref(value);
  return safeSourceHref(value) ?? undefined;
}
function assertSourceUrlsCredentialFree(source) {
  const query = object(source.query) ? source.query : {};
  const links = [
    source.url,
    source.href,
    source.queryUrl,
    source.query_url,
    query.queryUrl,
    query.query_url,
    query.url,
    ...(Array.isArray(source.links) ? source.links : []),
    ...(Array.isArray(query.links) ? query.links : []),
  ];
  const tables = [
    source.tables ?? [],
    source.tablesUsed ?? [],
    query.tables_used ?? [],
    source.tableLinks ?? [],
    source.table_links ?? [],
    query.table_links ?? [],
  ]
    .flat()
    .filter((entry) => object(entry) && String(entry.name ?? entry.table ?? "").trim());
  const files = [source.files ?? [], source.sourceFiles ?? [], query.files ?? [], query.sourceFiles ?? []]
    .flat()
    .filter((entry) => object(entry) && String(entry.name ?? entry.label ?? entry.file ?? "").trim());
  for (const entry of [...links, ...tables, ...files]) {
    assertCredentialFreeHref(typeof entry === "string" ? entry : entry?.href ?? entry?.url);
  }
}
function cleanLink(entry, { includeTrust = false } = {}) {
  const source = typeof entry === "string" ? { href: entry } : entry;
  if (!object(source)) return null;
  const href = cleanHref(source.href ?? source.url);
  if (!href) return null;
  return {
    href,
    ...(typeof source.label === "string" ? { label: source.label } : {}),
    ...(source.kind === "dashboard" ? { kind: source.kind } : {}),
    ...(includeTrust && object(source.trust) ? { trust: source.trust } : {}),
  };
}
function disclosableEvidenceText(value, includeSourceUrls) {
  if (typeof value !== "string") return true;
  const urls = value.match(/\bhttps?:[^\s<>"'`]+|(?:[a-z][a-z\d+.-]*:)?\/\/[^\s<>"'`]+/giu) ?? [];
  if (!includeSourceUrls) return !urls.length;
  return urls.every((href) => Boolean(cleanHref(href) || reviewedQueryLink({ url: href })));
}
export function assertDisclosedSourceText(value, includeSourceUrls) {
  if (typeof value === "string") {
    if (!disclosableEvidenceText(value, includeSourceUrls))
      fail(includeSourceUrls ? "source text contains an unsafe source URL."
        : "source text URLs require explicit source URL disclosure.");
  } else if (Array.isArray(value)) {
    value.forEach((entry) => assertDisclosedSourceText(entry, includeSourceUrls));
  } else if (object(value)) {
    Object.values(value).forEach((entry) => assertDisclosedSourceText(entry, includeSourceUrls));
  }
}
function cleanEvidence(steps, { includeSql, includeSourceUrls, sql }) {
  return steps.flatMap((step) => {
    const item = typeof step === "string" ? { title: step } : step;
    if (!object(item)) return [];
    const title = item.title ?? item.label;
    const detail = item.detail ?? item.description ?? item.summary ?? item.text;
    if (typeof title !== "string" || !title.trim()) return [];
    if (
      !includeSql &&
      (/\b(?:sql|query text|raw query)\b/iu.test(title) ||
        (typeof sql === "string" &&
          sql.trim() &&
          [title, detail].some((value) => typeof value === "string" && value.includes(sql.trim()))))
    )
      return [];
    // Evidence prose is serialized too, not only its structured links. Omit
    // URL-bearing steps unless their URLs pass the same disclosure boundary.
    if (![title, detail].every((value) => disclosableEvidenceText(value, includeSourceUrls))) return [];
    const links = includeSourceUrls
      ? (Array.isArray(item.links) ? item.links : []).map((entry) => cleanLink(entry))
        .filter((entry) => entry && disclosableEvidenceText(entry.label, includeSourceUrls))
      : [];
    const kind = ["question", "metric", "definition", "source", "filter", "method", "calculation", "result", "validation"].includes(item.kind)
      ? item.kind : undefined;
    return [{ title, ...(kind ? { kind } : {}), ...(item.showInReceipt === false ? { showInReceipt: false } : {}), ...(typeof detail === "string" ? { detail } : {}), ...(links.length ? { links } : {}) }];
  });
}

// The dashboard normalizer intentionally retains extension fields. An inline
// artifact is a separately shareable payload, so project only inspector fields.
function cleanDefinition(record, reviewedLineage) {
  const result = {};
  for (const key of ["label", "definition", "formula", "calculationSummary", "variable", "identifier", "field", "chartLabel"]) {
    if (typeof record[key] === "string") result[key] = record[key];
  }
  for (const key of ["componentIds", "dependencies"]) {
    if (Array.isArray(record[key])) result[key] = record[key].filter((value) => typeof value === "string");
  }
  for (const key of ["numerator", "denominator", "result"]) {
    if (!object(record[key])) continue;
    result[key] = Object.fromEntries(
      ["field", "label", "definition"]
        .filter((field) => typeof record[key][field] === "string")
        .map((field) => [field, record[key][field]]),
    );
  }
  if (Array.isArray(record.sourceLineage))
    result.sourceLineage = record.sourceLineage.flatMap((lineage) => {
      const tables = (lineage.tables ?? []).filter((name) => reviewedLineage.tables.has(name));
      const files = (lineage.files ?? []).filter((name) => reviewedLineage.files.has(name));
      return tables.length || files.length ? [{
        ...(tables.length ? { tables } : {}), ...(files.length ? { files } : {}),
      }] : [];
    });
  return result;
}

export function sourceForInput(source, component, { includeSql, includeSourceUrls, displayedFields, scopeToFields = true }) {
  if (!object(source)) fail("source must describe the reviewed or explicitly illustrative data.");
  const sourceLabel = text(source.label, "source.label");
  // The shared sanitizer drops unsafe URLs. Reject credentials in explicitly
  // requested links before that projection, without inspecting hidden metadata.
  if (includeSourceUrls) assertSourceUrlsCredentialFree(source);
  const reviewed = reviewedSource(source);
  const reviewedLineage = {
    tables: new Set(reviewed.tables),
    files: new Set(reviewed.files.map(({ label }) => label)),
  };
  const definitions = scopedMetricDefinitions(reviewed.definitions, component.id, {
    displayedFields,
    chartEdited: scopeToFields,
  }).map((definition) => cleanDefinition(definition, reviewedLineage));
  const sql = includeSql && reviewed.sql != null ? reviewed.sql : undefined;
  if (sql != null) {
    text(sql, "source.sql", { max: 100_000 });
    if (sensitiveSql.some((pattern) => pattern.test(sql)))
      fail("source.sql contains credentials or direct contact/payment identifiers; omit the statement instead of embedding it.");
  }
  const projected = {
    label: sourceLabel,
    ...(sql ? { sql } : {}),
    ...(sql && includeSourceUrls && reviewed.queryLink ? { queryUrl: reviewed.queryLink.href } : {}),
    ...(reviewed.executedAt ? { executedAt: timestamp(reviewed.executedAt, "source.executedAt") } : {}),
    tables: reviewed.tables.map((name) => ({
      name,
      ...(includeSourceUrls && reviewed.tableLinks[name] ? { href: cleanHref(reviewed.tableLinks[name]) } : {}),
      ...(reviewed.tableTrust[name] ? { trust: reviewed.tableTrust[name] } : {}),
    })),
    files: reviewed.files.map((file) => ({
      label: file.label,
      ...(includeSourceUrls && file.href ? { href: cleanHref(file.href) } : {}),
    })),
    filters: reviewed.filters,
    metricDefinitions: definitions,
    links: includeSourceUrls
      ? reviewed.links.map((entry) => cleanLink(entry, { includeTrust: true })).filter(Boolean)
      : [],
    caveats: reviewed.caveats,
    evidenceFlow: cleanEvidence(reviewed.evidenceFlow, { includeSql, includeSourceUrls, sql: reviewed.sql }),
  };
  // Check only projected, shareable metadata, not excluded input extensions or
  // unrelated definitions. Explicit SQL disclosure does not authorize URLs.
  assertDisclosedSourceText(projected, includeSourceUrls);
  assertDisclosedSourceText(component.description, includeSourceUrls);
  // Retained annotation text is embedded even when no mark or figure note resolves.
  assertDisclosedSourceText(component.chart?.annotations, includeSourceUrls);
  return projected;
}

/** JSON remains data even when labels contain HTML, script terminators, or replacement metacharacters. */
export function inlineJson(value) {
  return JSON.stringify(value).replace(
    /[<>&$\u2028\u2029]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function assertReplacementSafe(value) {
  const marker = "<!--data-inline-chart-->";
  const template = `before${marker}after`;
  if (template.replace(marker, value) !== template.replace(marker, () => value)) {
    throw new Error("Inline chart contains unsafe JavaScript replacement sequences.");
  }
}
