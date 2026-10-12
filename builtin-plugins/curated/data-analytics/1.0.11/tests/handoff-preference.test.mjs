import assert from "node:assert/strict";
import test from "node:test";

import { HANDOFF_DESTINATION_COOKIE, readHandoffDestination, writeHandoffDestination } from "../templates/data-app/base/src/handoff-preference.js";

const site = name => new URL(`https://${name}.example.chatgpt.site/`);

function browserJar() {
  const entries = new Map();
  const jar = {
    blocked: false,
    writes: [],
    document(location) {
      return {
        get cookie() {
          return [...entries.values()]
            .filter(({ domain, path }) => (location.hostname === domain || location.hostname.endsWith(`.${domain}`))
              && location.pathname.startsWith(path))
            .map(({ pair }) => pair).join("; ");
        },
        set cookie(value) {
          jar.writes.push(value);
          if (jar.blocked) return;
          const [pair, ...attributes] = value.split("; ");
          const domain = attributes.find(attribute => attribute.startsWith("Domain="))?.slice(7) ?? location.hostname;
          const path = attributes.find(attribute => attribute.startsWith("Path="))?.slice(5) ?? "/";
          if (location.hostname !== domain && !location.hostname.endsWith(`.${domain}`)) return;
          if (attributes.includes("Secure") && location.protocol !== "https:") return;
          const key = JSON.stringify([domain, path, pair.split("=", 1)[0]]);
          if (attributes.includes("Max-Age=0")) entries.delete(key);
          else entries.set(key, { domain, path, pair });
        },
      };
    },
  };
  return jar;
}

test("destination choices persist across page instances and dashboard origins without renewing reads", () => {
  const jar = browserJar(), first = site("first"), second = site("second");
  const firstEnvironment = { location: first, document: jar.document(first) };
  assert.equal(readHandoffDestination(firstEnvironment), null);
  assert.equal(writeHandoffDestination("desktop", firstEnvironment), true);
  assert.equal(readHandoffDestination({ location: first, document: jar.document(first) }), "desktop");
  const secondEnvironment = { location: second, document: jar.document(second) };
  assert.equal(readHandoffDestination(secondEnvironment), "desktop");
  assert.equal(writeHandoffDestination("web", secondEnvironment), true);
  for (let read = 0; read < 10; read += 1) assert.equal(readHandoffDestination(firstEnvironment), "web");
  assert.equal(jar.writes.length, 2, "Reading from another dashboard never rewrites the preference");
});

test("preferences remain within their workspace and browser", () => {
  const jar = browserJar(), otherBrowser = browserJar();
  const first = site("first"), otherWorkspace = new URL("https://first.other.chatgpt.site/");
  assert.equal(writeHandoffDestination("desktop", { location: first, document: jar.document(first) }), true);
  assert.equal(readHandoffDestination({ location: first, document: otherBrowser.document(first) }), null);
  assert.equal(readHandoffDestination({ location: otherWorkspace, document: jar.document(otherWorkspace) }), null);
  assert.equal(writeHandoffDestination("web", { location: otherWorkspace, document: jar.document(otherWorkspace) }), true);
  assert.equal(readHandoffDestination({ location: first, document: jar.document(first) }), "desktop");
  assert.equal(readHandoffDestination({ location: otherWorkspace, document: jar.document(otherWorkspace) }), "web");
});

test("clearing removes the shared preference with the same domain and path", () => {
  const jar = browserJar(), first = site("first"), second = site("second");
  assert.equal(writeHandoffDestination("desktop", { location: first, document: jar.document(first) }), true);
  assert.equal(writeHandoffDestination(null, { location: second, document: jar.document(second) }), true);
  assert.equal(readHandoffDestination({ location: first, document: jar.document(first) }), null);
  assert.equal(jar.document(first).cookie, "");
  assert.equal(jar.writes[1], `${HANDOFF_DESTINATION_COOKIE}=; Domain=example.chatgpt.site; Path=/; Max-Age=0; Secure; SameSite=Lax`);
  assert.equal(writeHandoffDestination(null, { location: first, document: jar.document(first) }), true,
    "Clearing an already absent preference is idempotent");
});

test("the cookie stores a bounded enum with the workspace security attributes", () => {
  const jar = browserJar(), location = new URL("https://sample-cafe-sales-master.openai.chatgpt.site/");
  for (const [destination, bytes] of [["desktop", 39], ["web", 35]]) {
    assert.equal(writeHandoffDestination(destination, { location, document: jar.document(location) }), true);
    const [pair, ...attributes] = jar.writes.at(-1).split("; ");
    assert.equal(pair, `${HANDOFF_DESTINATION_COOKIE}=${destination}`);
    assert.equal(Buffer.byteLength(pair), bytes, "Only a compact enum enters matching request headers");
    assert.deepEqual(attributes, ["Domain=openai.chatgpt.site", "Path=/", "Max-Age=34560000", "Secure", "SameSite=Lax"]);
  }
});

test("unsupported or malformed locations never access browser storage", () => {
  for (const location of [
    ...["http://first.example.chatgpt.site", "https://dashboard.chatgpt.site", "https://chatgpt.site",
      "https://custom.example.com", "https://localhost", "https://a.b.c.chatgpt.site", "https://a.b.chatgpt.site.evil.test"]
      .map(href => new URL(href)),
    null, {}, { protocol: "https:", hostname: 123 },
  ]) {
    let accessed = false;
    const document = { get cookie() { accessed = true; return `${HANDOFF_DESTINATION_COOKIE}=web`; },
      set cookie(_) { accessed = true; } };
    assert.equal(readHandoffDestination({ location, document }), null);
    assert.equal(writeHandoffDestination("web", { location, document }), false);
    assert.equal(writeHandoffDestination(null, { location, document }), false);
    assert.equal(accessed, false);
  }
});

test("reads reject malformed, ambiguous, or non-enum cookies", () => {
  const location = site("first");
  for (const cookie of ["", HANDOFF_DESTINATION_COOKIE, `${HANDOFF_DESTINATION_COOKIE}=`, `${HANDOFF_DESTINATION_COOKIE}=Desktop`,
    `${HANDOFF_DESTINATION_COOKIE}=true`, `${HANDOFF_DESTINATION_COOKIE}=%77eb`, `${HANDOFF_DESTINATION_COOKIE}="web"`,
    `${HANDOFF_DESTINATION_COOKIE}=web=desktop`, `${HANDOFF_DESTINATION_COOKIE}=https://example.com`,
    `other_${HANDOFF_DESTINATION_COOKIE}=web`, `${HANDOFF_DESTINATION_COOKIE}=web; ${HANDOFF_DESTINATION_COOKIE}=web`,
    `${HANDOFF_DESTINATION_COOKIE}=web; ${HANDOFF_DESTINATION_COOKIE}=desktop`,
    `${HANDOFF_DESTINATION_COOKIE}=web; ${HANDOFF_DESTINATION_COOKIE}`, null, 1]) {
    assert.equal(readHandoffDestination({ location, document: { cookie } }), null, String(cookie));
  }
  assert.equal(readHandoffDestination({ location, document: { cookie: `unrelated=1; ${HANDOFF_DESTINATION_COOKIE}=web; another=0` } }), "web");
});

test("invalid destinations never read or write browser storage", () => {
  const location = site("first");
  let accessed = false;
  const document = { get cookie() { accessed = true; return ""; }, set cookie(_) { accessed = true; } };
  for (const destination of [undefined, "", "always-ask", "Desktop", "web; Domain=other.test", "https://example.com", 1, false, {}]) {
    assert.equal(writeHandoffDestination(destination, { document, location }), false);
  }
  assert.equal(accessed, false);
});

test("blocked or throwing storage never reports a changed preference as saved", () => {
  const jar = browserJar(), location = site("first"), document = jar.document(location);
  jar.blocked = true;
  assert.equal(writeHandoffDestination("web", { location, document }), false);
  assert.equal(readHandoffDestination({ location, document }), null);
  jar.blocked = false;
  assert.equal(writeHandoffDestination("desktop", { location, document }), true);
  jar.blocked = true;
  assert.equal(writeHandoffDestination("web", { location, document }), false);
  assert.equal(writeHandoffDestination(null, { location, document }), false);
  assert.equal(readHandoffDestination({ location, document }), "desktop");
  for (const document of [null,
    { get cookie() { throw new Error("Cookie access blocked"); }, set cookie(_) {} },
    { get cookie() { return ""; }, set cookie(_) { throw new Error("Cookie write blocked"); } },
  ]) {
    assert.equal(readHandoffDestination({ location, document }), null);
    assert.equal(writeHandoffDestination("web", { location, document }), false);
    assert.equal(writeHandoffDestination(null, { location, document }), false);
  }
});

test("readback rejects conflicting cookies and does not mistake malformed values for successful deletion", () => {
  const location = site("first");
  for (const cookie of [`${HANDOFF_DESTINATION_COOKIE}=invalid`, HANDOFF_DESTINATION_COOKIE,
    `${HANDOFF_DESTINATION_COOKIE}=web; ${HANDOFF_DESTINATION_COOKIE}=web`]) {
    const document = { get cookie() { return cookie; }, set cookie(_) {} };
    assert.equal(writeHandoffDestination("web", { location, document }), false);
    assert.equal(writeHandoffDestination(null, { location, document }), false);
  }
});
