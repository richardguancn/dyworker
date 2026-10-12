import assert from "node:assert/strict";
import test from "node:test";

import { assertNoPublicationSecrets } from "../skills/publish-artifact-to-sites/scripts/publication-secrets.mjs";

const inspect = (overrides = {}) =>
  assertNoPublicationSecrets({
    html: "<!doctype html><html><body>Reviewed dashboard</body></html>",
    seedSnapshot: { queries: {} },
    initialPresentation: { title: "Dashboard" },
    ...overrides,
  });
const disclosure =
  /^Error: Publication contains a possible credential\. Remove credentials from the artifact before publishing\.$/u;

test("rejects common credential literals in HTML, rows, and presentation strings", () => {
  const literals = [
    "-----BEGIN RSA PRIVATE KEY-----\nINERT_TEST_FIXTURE\n-----END RSA PRIVATE KEY-----",
    "Bearer INERT_TEST_BEARER_VALUE_1234567890",
    "sk-proj-INERT_TEST_API_KEY_1234567890",
    "ghp_INERT_TEST_GITHUB_TOKEN_1234567890",
    "xoxb-INERT-TEST-SLACK-TOKEN-1234567890",
  ];
  for (const value of literals) {
    assert.throws(() => inspect({ html: `<main>${value}</main>` }), disclosure);
    assert.throws(() => inspect({ seedSnapshot: { queries: { reviewed: { rows: [{ value }] } } } }), disclosure);
    assert.throws(() => inspect({ initialPresentation: { title: value } }), disclosure);
  }
});

test("rejects nonempty credential fields, including nested metadata and rows", () => {
  for (const key of ["api_key", "accessToken", "Authorization", "password", "client-secret", "private_key", "cookie"]) {
    assert.throws(() => inspect({ seedSnapshot: { source: { [key]: "INERT_TEST_VALUE" } } }), disclosure);
    assert.throws(
      () => inspect({ seedSnapshot: { queries: { reviewed: { rows: [{ [key]: "INERT_TEST_VALUE" }] } } } }),
      disclosure,
    );
  }
  assert.throws(
    () => inspect({ initialPresentation: { configuration: { refresh_token: "INERT_TEST_VALUE" } } }),
    disclosure,
  );
});

test("rejects generic credential fields in metadata even when nested properties are named rows", () => {
  const value = "INERT_TEST_VALUE";
  const cases = [
    ["snapshot metadata", { seedSnapshot: { secret: value } }],
    ["query metadata", { seedSnapshot: { queries: { reviewed: { token: value, rows: [] } } } }],
    ["source metadata", { seedSnapshot: { queries: { reviewed: { source: { authToken: value }, rows: [] } } } }],
    ["source rows metadata", { seedSnapshot: { source: { rows: [{ secret: value }] } } }],
    ["presentation metadata", { initialPresentation: { notes: { auth_token: value } } }],
    [
      "presentation rows metadata",
      { initialPresentation: { queries: { reviewed: { rows: [{ "auth-token": value }] } } } },
    ],
  ];
  for (const [label, input] of cases) assert.throws(() => inspect(input), disclosure, label);
});

test("a row exemption does not exempt the same object when it is also source metadata", () => {
  const shared = { rows: [{ token: "INERT_TEST_VALUE" }] };
  const snapshot = { source: shared, queries: { reviewed: shared } };
  assert.throws(() => inspect({ seedSnapshot: snapshot }), disclosure);
});

test("rejects credentials in URL query strings, fragments, paths, and userinfo", () => {
  const urls = [
    "https://example.test/file?X-Amz-Signature=INERT_TEST_VALUE",
    "https://example.test/file?X-Goog-Signature=INERT_TEST_VALUE",
    "https://example.test/file?sv=2025-01-01&sig=INERT_TEST_VALUE",
    "https://example.test/file?Key-Pair-Id=PUBLIC_ID&Signature=INERT_TEST_VALUE",
    "https://example.test/file?access%5Ftoken=INERT_TEST_VALUE",
    "https://example.test/file?download=1&amp;api_key=INERT_TEST_VALUE",
    "https://example.test/file?key=INERT_TEST_VALUE",
    "https://example.test/file?secret=INERT_TEST_VALUE",
    "https://example.test/file#access_token=INERT_TEST_VALUE",
    "https://example.test/file#refresh%5Ftoken=INERT_TEST_VALUE",
    "https://example.test/file#/callback?access_token=INERT_TEST_VALUE",
    "https://example.test/file#access_token%3DINERT_TEST_VALUE",
    "https://example.test/access_token/INERT_TEST_VALUE",
    "https://example.test/signed/INERT_TEST_VALUE",
    "https://example.test/api%5Fkey/INERT_TEST_VALUE",
    "https://example.test/file#/token/INERT_TEST_VALUE",
    "https://example.test/redirect?next=https%3A%2F%2Fexample.test%2Ffile%23access_token%3DINERT_TEST_VALUE",
    "https://example.test/redirect#next=https%3A%2F%2Fexample.test%2Ffile%3Fkey%3DINERT_TEST_VALUE",
    "/file?download=1&sig=INERT_TEST_VALUE",
    "//example.test/file?access_token=INERT_TEST_VALUE",
    "/file#access_token=INERT_TEST_VALUE",
    "https://test-user:INERT_TEST_PASSWORD@example.test/data",
    "postgresql://test-user:INERT_TEST_PASSWORD@example.test/db",
  ];
  for (const url of urls) {
    assert.throws(() => inspect({ html: `<a href="${url}">Source</a>` }), disclosure);
    assert.throws(() => inspect({ seedSnapshot: { source: { url } } }), disclosure);
    assert.throws(() => inspect({ seedSnapshot: { queries: { reviewed: { rows: [{ url }] } } } }), disclosure);
  }
});

test("preserves ordinary URL paths, filters, anchors, and encoded navigation targets", () => {
  for (const url of [
    "https://example.test/data?code=US&state=CA#chart-1",
    "https://example.test/%64ata#/overview?tab=revenue&token_count=12",
    "https://example.test/data?next=https%3A%2F%2Fexample.test%2Fdata%3Fcode%3DUS%23chart-1",
    "https://example.test/data#next=https%3A%2F%2Fexample.test%2Fdata%3Ftab%3Drevenue",
  ]) {
    const snapshot = { source: { url }, queries: {} };
    const before = JSON.stringify(snapshot);
    inspect({ seedSnapshot: snapshot });
    assert.equal(JSON.stringify(snapshot), before);
  }
});

test("rejects OAuth callback codes and PKCE verifiers in source URLs and metadata", () => {
  for (const url of [
    "https://app.example/oauth/callback?code=private",
    "/callback?state=reviewed&code=private",
    "oauth/callback%3F%63ode%3Dprivate",
    "/signin-oidc#code=private&state=reviewed",
    "https://app.example/#/callback?code=private&state=reviewed",
    "https://warehouse.example/open?url=https%3A%2F%2Fapp.example%2Foauth%2Fcallback%3Fstate%3Dreviewed%26code%3Dprivate",
    "https://warehouse.example/open#url=https%3A%2F%2Fapp.example%2Fcallback%3Fstate%3Dreviewed%26code%3Dprivate",
    "https://warehouse.example/open?url=https%253A%252F%252Fapp.example%252Fcallback%253Fcode%253Dprivate",
    "/data?auth_code=private",
    "/data#code_verifier=private",
  ]) {
    assert.throws(() => inspect({ seedSnapshot: { source: { url } } }), disclosure, url);
  }
  for (const key of ["auth_code", "code_verifier"]) {
    assert.throws(() => inspect({ seedSnapshot: { source: { metadata: { [key]: "private" } } } }), disclosure);
  }
});

test("preserves ordinary code and state filters without interpreting outer filters as nested callback credentials", () => {
  for (const url of [
    "https://warehouse.example/datasets?code=US&state=CA#summary",
    "https://warehouse.example/datasets?url=https%3A%2F%2Fapp.example%2Fcallback&code=US&state=CA",
    "https://warehouse.example/datasets#code=US&url=https%3A%2F%2Fapp.example%2Fcallback",
    "https://app.example/callback?code=&state=reviewed",
  ]) inspect({ seedSnapshot: { source: { url } } });
});

test("permits ordinary SQL, analytics identifiers, numeric auth metrics, and useful query parameters", () => {
  const snapshot = {
    api_key: "",
    password: null,
    authorization: 12,
    cookie: false,
    secret: " ",
    token: 12,
    authToken: null,
    source: {
      sql: "SELECT session_id, token_count, auth_success_rate FROM sessions WHERE token_count > 0",
      localPath: "/Users/analyst/data/source.csv",
      url: "https://example.test/dashboard?tab=overview&session_id=stable-id&token_count=12#chart-1",
    },
    queries: {
      reviewed: {
        rows: [
          {
            session_id: "session-123",
            token: "word",
            token_count: 12,
            secret_count: 3,
            authentication_rate: 0.9,
            details: { secret: "word", values: [{ authToken: "category" }] },
          },
        ],
      },
    },
  };
  const before = JSON.stringify(snapshot);
  inspect({ seedSnapshot: snapshot });
  assert.equal(JSON.stringify(snapshot), before);
});

test("checks canonical base64 and percent-encoded inline scripts without executing them", () => {
  const script = 'throw new Error("must never execute"); const value = "Bearer INERT_TEST_BEARER_VALUE_1234567890";';
  const base64 = Buffer.from(script).toString("base64");
  assert.throws(() => inspect({ html: `<script src="data:text/javascript;base64,${base64}"></script>` }), disclosure);
  assert.throws(
    () =>
      inspect({
        html: `<script src="data:application/javascript;charset=utf-8,${encodeURIComponent(script)}"></script>`,
      }),
    disclosure,
  );
  const json = Buffer.from(JSON.stringify({ api_key: "INERT_TEST_VALUE" })).toString("base64");
  assert.throws(() => inspect({ html: `<script src="data:application/json;base64,${json}"></script>` }), disclosure);
  const metadata = Buffer.from(
    JSON.stringify({ queries: { reviewed: { rows: [{ token: "INERT_TEST_VALUE" }] } } }),
  ).toString("base64");
  assert.throws(() => inspect({ html: `<script src="data:application/json;base64,${metadata}"></script>` }), disclosure);
  inspect({ html: '<script src="data:text/javascript,throw%20new%20Error(%22must%20never%20execute%22)"></script>' });
});

test("does not reinterpret plugin references in inline bundles as credential URLs", () => {
  const script = 'const help = "Use [Data](plugin://data-analytics@openai-curated-remote)";';
  const base64 = Buffer.from(script).toString("base64");
  inspect({ html: `<script src="data:text/javascript;base64,${base64}"></script>` });
  inspect({ seedSnapshot: { documentation: "[Documents](plugin://documents@openai-primary-runtime)" } });
});

test("permits only Plotly's exact public token-documentation anchor while scanning the complete bundle", () => {
  const documentation = "https://www.mapbox.com/api-documentation/#access-tokens-and-token-scopes";
  const script = `throw new Error("must never execute"); const help = ${JSON.stringify(documentation)};`;
  const inline = (value) => `<script src="data:text/javascript;base64,${Buffer.from(value).toString("base64")}"></script>`;
  const snapshot = { source: { documentation }, queries: {} };
  const before = JSON.stringify(snapshot);
  inspect({ html: inline(script), seedSnapshot: snapshot });
  inspect({ html: `<script src="data:application/javascript,${encodeURIComponent(script)}"></script>` });
  assert.equal(JSON.stringify(snapshot), before);

  for (const url of [
    documentation.replace("https:", "http:"),
    documentation.replace("www.mapbox.com", "other.example"),
    documentation.replace("/api-documentation/", "/other-documentation/"),
    `${documentation}-INERT_TEST_VALUE`,
    documentation.replace("#", "?access_token=INERT_TEST_VALUE#"),
    documentation.replace("#", "?sig=INERT_TEST_VALUE#"),
    documentation.replace("https://", "https://test-user:INERT_TEST_PASSWORD@"),
    "https://www.mapbox.com/api-documentation/#access_token=INERT_TEST_VALUE",
    "https://www.mapbox.com/access_token/INERT_TEST_VALUE#access-tokens-and-token-scopes",
  ]) {
    assert.throws(() => inspect({ html: inline(`const help = ${JSON.stringify(url)};`) }), disclosure);
    assert.throws(() => inspect({ seedSnapshot: { source: { documentation: url } } }), disclosure);
  }
  assert.throws(() => inspect({ html: inline(`${script} const authorization = "Bearer INERT_TEST_BEARER_VALUE_1234567890";`) }), disclosure);
  assert.throws(() => inspect({ html: inline(`${script} const endpoint = "https://www.mapbox.com/tokens/INERT_TEST_VALUE";`) }), disclosure);
  assert.throws(() => inspect({ html: inline(script), initialPresentation: { token: "INERT_TEST_VALUE" } }), disclosure);
});

test("accepts JavaScript regular expressions and percent-normalized URL paths", () => {
  const script = 'const start = /^/; const path = "https://example.test/%5E?tab=overview#%5B";';
  inspect({ html: script });
  inspect({ html: `<script src="data:text/javascript;base64,${Buffer.from(script).toString("base64")}"></script>` });
});

test("never includes secret values, metadata keys, or paths in failures", () => {
  const value = { UNTRUSTED_PRIVATE_LOCATION: { api_key: "UNTRUSTED_PRIVATE_VALUE" } };
  assert.throws(
    () => inspect({ seedSnapshot: value }),
    (error) => {
      assert.match(String(error), disclosure);
      assert.doesNotMatch(String(error), /UNTRUSTED|api_key/u);
      return true;
    },
  );
});

test("bounds decoding and structured traversal without recursive execution", () => {
  const scanned = inspect({ html: `data:text/javascript;base64,${"a".repeat(16 * 1024 * 1024 + 1)}` });
  assert.equal(scanned.complete, true);
  assert.equal(scanned.inlineAssets, 1);
  const cyclic = { title: "No credential" };
  cyclic.self = cyclic;
  inspect({ seedSnapshot: cyclic });
  let nestedUrl = "https://example.test/reviewed";
  for (let depth = 0; depth < 8; depth += 1) nestedUrl = `https://example.test/open?url=${encodeURIComponent(nestedUrl)}`;
  assert.throws(() => inspect({ seedSnapshot: { source: { url: nestedUrl } } }), /supported credential scan limits/u);
  let deep = {};
  for (let depth = 0; depth < 256; depth += 1) deep = { nested: deep };
  assert.throws(() => inspect({ seedSnapshot: deep }), /supported credential scan limits/u);
});

test("visits more than 500,000 scalar cells without queueing a second object graph", () => {
  const rows = Array.from({ length: 60_000 }, (_, index) => ({
    index, value: index / 3, count: 1, retained: true, optional: null,
    authorization: 0, token: 12, cookie: false, final: index === 59_999 ? "reviewed" : "",
  }));
  const events = [];
  const result = assertNoPublicationSecrets({ html: "<main>Reviewed</main>", seedSnapshot: { queries: { reviewed: { rows } } } }, {
    onProgress: (event) => events.push(event),
  });
  assert.equal(result.complete, true);
  assert.ok(result.fieldsVisited > 500_000);
  assert.ok(result.primitiveValuesSkipped >= 480_000);
  assert.ok(result.maximumActiveDepth < 10);
  assert.ok(events.length > 2);
  assert.equal(events.at(-1).complete, true);
  rows.at(-1).authorization = "INERT_TEST_VALUE";
  assert.throws(() => inspect({ seedSnapshot: { queries: { reviewed: { rows } } } }), disclosure);
});

test("scans more than 64 MiB of HTML, including late literal and URL secrets", () => {
  const html = "1234567890 ".repeat(Math.ceil(65 * 1024 * 1024 / 11));
  const result = inspect({ html });
  assert.equal(result.complete, true);
  assert.ok(result.inspectedTextUnits > 64 * 1024 * 1024);
  assert.ok(result.maximumTextWindowUnits <= 1024 * 1024);
  for (const suffix of ["Bearer INERT_TEST_BEARER_VALUE_1234567890", "https://example.test/data?access_token=INERT_TEST_VALUE"]) {
    assert.throws(() => inspect({ html: html + suffix }), disclosure);
  }
});

test("carries literal, URL, base64, UTF-8, and JSON escape state across windows", () => {
  const window = 64 * 1024;
  for (const secret of [
    "Bearer " + " ".repeat(90_000) + "INERT_TEST_BEARER_VALUE_1234567890",
    "eyj" + "a".repeat(90_000) + ".eyj" + "a".repeat(90_000) + "." + "b".repeat(32),
    "-----BEGIN " + "A ".repeat(90_000) + "PRIVATE KEY-----",
    "https://example.test/data?" + "filter=value&".repeat(7_000) + "access%5Ftoken=INERT_TEST_VALUE",
  ]) assert.throws(() => inspect({ html: " ".repeat(window - 3) + secret }), disclosure);
  for (const offset of [window - 1, window, window + 1]) {
    const script = " ".repeat(offset) + 'const symbol="💫"; const value="Bearer INERT_TEST_BEARER_VALUE_1234567890"';
    assert.throws(() => inspect({ html: `data:text/javascript;base64,${Buffer.from(script).toString("base64")}` }), disclosure);
    assert.throws(() => inspect({ html: `data:text/javascript,${encodeURIComponent(script)}` }), disclosure);
  }
  const encodedJson = '{"padding":"' + "a".repeat(window - 20) + '","api\\u005fkey":"INERT_TEST_VALUE"}';
  assert.throws(() => inspect({ html: `data:application/json;base64,${Buffer.from(encodedJson).toString("base64")}` }), disclosure);
});

test("keeps exact word-boundary behavior and metadata checks for escaped JSON", () => {
  inspect({ html: "_Bearer INERT_TEST_BEARER_VALUE_1234567890" });
  inspect({ html: "AKIA" + "A".repeat(17) });
  inspect({ html: "aıza" + "a".repeat(35) });
  inspect({ html: "AKıA" + "A".repeat(16) });
  assert.throws(() => inspect({ html: "ſk-" + "a".repeat(20) }), disclosure);
  assert.throws(() => inspect({ html: "sK-" + "a".repeat(20) }), disclosure);
  const json = '{"a":"\\u0073k-proj-INERT_TEST_API_KEY_1234567890"}';
  assert.throws(() => inspect({ html: `data:application/json;base64,${Buffer.from(json).toString("base64")}` }), disclosure);
  const malformed = '{"api_key":"INERT_TEST_VALUE",}';
  inspect({ html: `data:application/json;base64,${Buffer.from(malformed).toString("base64")}` });
  // Every duplicate-key value remains in the published bytes. Unlike a final
  // JSON.parse object, streaming inspection intentionally checks earlier values.
  const overwritten = '{"api_key":"INERT_TEST_VALUE","api_key":""}';
  assert.throws(() => inspect({ html: `data:application/json;base64,${Buffer.from(overwritten).toString("base64")}` }), disclosure);
  for (let url of ["https://example.test/%64ata?x=1", "https://example.test/data#%2Foverview"]) {
    for (let depth = 0; depth < 7; depth += 1) url = `https://outer.test/open?next=${encodeURIComponent(url)}`;
    inspect({ html: url });
  }
});

test("cancellation and ambiguous active URL limits never return a completed scan", () => {
  const controller = new AbortController();
  assert.throws(() => assertNoPublicationSecrets({ html: "0 ".repeat(100_000) }, {
    signal: controller.signal,
    onProgress: () => controller.abort(),
  }), /did not complete/u);
  const url = "https://example.test/data?filter=" + "a".repeat(2 * 1024 * 1024);
  assert.throws(() => inspect({ html: url }), /supported credential scan limits/u);
});

test("oversized relative paths retain URL recognition until later credential delimiters", () => {
  const path = "download/" + "a".repeat(1024 * 1024 + 100);
  for (const suffix of [
    "?access_token=INERT_TEST_VALUE",
    "?access%5Ftoken=INERT_TEST_VALUE",
    "#access_token%3DINERT_TEST_VALUE",
    "%3Faccess_token%3DINERT_TEST_VALUE",
    "%2523access_token%253DINERT_TEST_VALUE",
  ]) {
    assert.throws(() => inspect({ html: `<a href="${path}${suffix}">Source</a>` }),
      /supported credential scan limits/u, suffix);
  }
  // The discarded prefix may establish both the relative URL and callback scope.
  assert.throws(() => inspect({ seedSnapshot: { source: {
    url: "oauth/" + "a".repeat(1024 * 1024 + 100) + "?code=INERT_TEST_VALUE",
  } } }), /supported credential scan limits/u);
});

test("oversized relative URL state carries encoded delimiters and Unicode segments across windows", () => {
  const window = 64 * 1024;
  const prefix = "<a href=\"download/";
  for (const offset of [-2, -1, 0, 1]) {
    const path = prefix + "a".repeat(17 * window + offset - prefix.length);
    assert.throws(() => inspect({ html: path + "%253Faccess_token%253DINERT_TEST_VALUE\">Source</a>" }),
      /supported credential scan limits/u, `encoded delimiter offset ${offset}`);
  }
  assert.throws(() => inspect({ html: "download/" + "Kſ".repeat(600_000) + "?token=INERT_TEST_VALUE" }),
    /supported credential scan limits/u);
});

test("oversized non-URL strings and invalidated relative candidates remain allowed", () => {
  const long = "a".repeat(1024 * 1024 + 100);
  for (const value of [
    long,
    long + "?token=ordinary",
    "download/" + long,
    "download/" + long + "%25ordinary",
    "download/" + long + "!chart?token=ordinary",
    "download/" + long + "=chart?token=ordinary",
    "download/" + long + " chart?token=ordinary",
    "download/" + long + '"chart?token=ordinary',
    "A/".repeat(600_000) + "AA==",
  ]) assert.equal(inspect({ html: value }).complete, true);
});
