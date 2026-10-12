import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";

import compiler from "../assets/data-app-runtime/compiler.cjs";
import { loadHostedSnapshot } from "../templates/data-app/base/src/hosted-query-bootstrap.js";
import { createQueryDataStore } from "../templates/data-app/base/src/query-data-store.js";

const source = readFileSync(new URL("../templates/data-app/base/src/DataAppRuntime.jsx", import.meta.url), "utf8");
const code = compiler.transform(source, { filePath: "DataAppRuntime.jsx" });
const snapshot = { id: "streaming-loader", title: "Complete reviewed data", surface: "dashboard",
  queries: { q: { rows: [{ value: "café 日本語 🧪" }, { value: 42 }] } } };

// Exercise the actual runtime module with a small hook scheduler. Network bodies
// are real Fetch streams; state changes stay observable after disposal as well.
function runtimeFixture({ snapshotStatus = 200, presentationStatus = 200, respectAbort = true,
  failedFetch, hosted = true } = {}) {
  const states = new Map(), effects = new Map(), requests = [], updates = [], contentSnapshots = [];
  let owner, cursor, pending = [], stream, completePresentation;
  const jsx = (type, props) => ({ type, props });
  const react = {
    createElement: (type, props, ...children) => jsx(type, { ...props, children }),
    useState(initial) {
      const slots = states.get(owner) ?? [];
      states.set(owner, slots);
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => {
        updates.push(value);
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useEffect(effect, dependencies) {
      const slots = effects.get(owner) ?? [];
      effects.set(owner, slots);
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, position) => value !== slots[index].dependencies[position])) {
        pending.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { dependencies, cleanup: effect() };
        });
      }
    },
  };
  async function fetch(endpoint, options) {
    requests.push({ endpoint, signal: options.signal });
    if (failedFetch === endpoint) throw new Error("Synthetic network failure");
    if (endpoint === "/api/presentation") {
      return new Promise((resolve) => { completePresentation = (record) => resolve(new Response(
        JSON.stringify(record), { status: presentationStatus },
      )); });
    }
    assert.equal(endpoint, "/api/snapshot");
    const body = new ReadableStream({
      start(controller) {
        stream = controller;
        if (respectAbort) options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true });
      },
    });
    const response = new Response(body, { status: snapshotStatus });
    response.json = () => assert.fail("Snapshots must be read incrementally, even when small");
    response.text = () => assert.fail("Snapshots must not buffer one document string");
    return response;
  }
  const module = { exports: {} };
  const modules = { react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "./DataAppShell.jsx": { DataAppShell: "shell" },
    "./components/DataAppLoadingContent.jsx": { DataAppLoadingContent: "loading-content" },
    "./hosted-query-bootstrap.js": { loadHostedSnapshot: (value, options) => loadHostedSnapshot(value, { ...options, request: fetch }) },
    "./query-data-store.js": { createQueryDataStore } };
  new Function("module", "exports", "require", "fetch", "AbortController", code)(
    module, module.exports, (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected runtime dependency ${name}`);
      return modules[name];
    }, fetch, AbortController,
  );
  const properties = { hosted, reviewedSnapshot: snapshot, createContent(value) {
    contentSnapshots.push(value);
    return { DashboardContent: () => jsx("article", { children: value.queries.q.rows.length }),
      ReportContent: () => jsx("article", { children: "report" }) };
  } };
  function renderComponent(component, props) {
    owner = component; cursor = 0;
    return resolve(component(props));
  }
  function resolve(value) {
    if (typeof value?.type === "function") return renderComponent(value.type, value.props);
    return value;
  }
  function render() {
    const view = renderComponent(module.exports.DataAppRuntime, properties);
    const work = pending; pending = [];
    work.forEach((effect) => effect());
    return view;
  }
  return { requests, updates, contentSnapshots, render,
    write(value) { stream.enqueue(new TextEncoder().encode(value)); },
    writeBytes(bytes) { stream.enqueue(bytes); },
    finish() { stream.close(); },
    present(record = { presentation: { title: "Saved owner title" }, revision: 7, canEdit: true }) { completePresentation(record); },
    async settled() { await setImmediate(); return render(); },
    dispose() { for (const slots of effects.values()) for (const effect of slots) effect?.cleanup?.(); },
  };
}

test("hosted content waits for complete streaming data and presentation, retaining all reviewed rows", async () => {
  const fixture = runtimeFixture();
  assert.equal(fixture.render().props["aria-busy"], "true");
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  for (const byte of bytes) fixture.writeBytes(new Uint8Array([byte]));
  assert.equal((await fixture.settled()).type, "main", "Even valid complete JSON waits for the response to end");
  fixture.finish();
  assert.equal((await fixture.settled()).type, "main", "Presentation must finish before authored modules are created");
  assert.deepEqual(fixture.contentSnapshots, []);
  fixture.present();
  const view = await fixture.settled();
  assert.equal(view.type, "shell");
  assert.deepEqual(view.props.snapshot, snapshot);
  assert.deepEqual(view.props.initialPresentation, { title: "Saved owner title" });
  assert.equal(view.props.initialRevision, 7);
  assert.equal(view.props.canEdit, true);
  assert.deepEqual(fixture.contentSnapshots, [snapshot]);
  fixture.render();
  assert.equal(fixture.contentSnapshots.length, 1, "Authored component identities survive subsequent renders");
  fixture.dispose();
});

test("streamed hosted presentation keeps explicit owner editing semantics", async () => {
  for (const canEdit of [false, undefined, "true", 1, true]) {
    const fixture = runtimeFixture();
    fixture.render(); fixture.write(JSON.stringify(snapshot)); fixture.finish();
    fixture.present({ presentation: {}, revision: 0, canEdit });
    const view = await fixture.settled();
    assert.equal(view.props.canEdit, canEdit === true);
    fixture.dispose();
  }
});

test("invalid and truncated hosted data never instantiate authored modules", async () => {
  for (const data of ['{"queries":', '{"queries":{},}', JSON.stringify(snapshot) + "x"]) {
    const fixture = runtimeFixture();
    fixture.render(); fixture.present(); fixture.write(data); fixture.finish();
    const view = await fixture.settled();
    assert.equal(view.type, "main");
    assert.notEqual(view.props.children, "Loading Data app…");
    assert.deepEqual(fixture.contentSnapshots, []);
    assert.ok(fixture.requests.every(({ signal }) => signal.aborted), "A failed read cancels both outstanding requests");
    fixture.dispose();
  }
});

test("HTTP and network failures preserve the hosted loading error and cancel sibling reads", async () => {
  for (const [options, message] of [
    [{ snapshotStatus: 503 }, "Data app snapshot is unavailable."],
    [{ presentationStatus: 403 }, "Data app presentation is unavailable."],
    [{ failedFetch: "/api/snapshot" }, "Synthetic network failure"],
    [{ failedFetch: "/api/presentation" }, "Synthetic network failure"],
  ]) {
    const fixture = runtimeFixture(options);
    fixture.render();
    if (options.failedFetch !== "/api/presentation") fixture.present();
    const view = await fixture.settled();
    assert.equal(view.props.children, message);
    assert.deepEqual(fixture.contentSnapshots, []);
    assert.ok(fixture.requests.every(({ signal }) => signal.aborted));
    fixture.dispose();
  }
});

test("disposing hosted runtime aborts streams and ignores late completions from cancelled effects", async () => {
  for (const respectAbort of [true, false]) {
    const fixture = runtimeFixture({ respectAbort });
    fixture.render(); fixture.present(); fixture.write('{"queries":');
    await fixture.settled();
    fixture.dispose();
    assert.ok(fixture.requests.every(({ signal }) => signal.aborted));
    if (!respectAbort) { fixture.write('{}}'); fixture.finish(); }
    await fixture.settled();
    assert.deepEqual(fixture.updates, [], "Disposed loads cannot replace state or display an abort error");
    assert.deepEqual(fixture.contentSnapshots, []);
  }
});

test("local runtime mounts the supplied complete snapshot without hosted reads", () => {
  const fixture = runtimeFixture({ hosted: false });
  const view = fixture.render();
  assert.equal(view.type, "shell");
  assert.equal(view.props.snapshot, snapshot);
  assert.equal(view.props.canEdit, true);
  assert.deepEqual(fixture.requests, []);
});
