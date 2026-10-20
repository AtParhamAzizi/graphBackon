const testCases = [];
const test = (name, run) => testCases.push({ name, run });
const assert = (condition, message = "Assertion failed") => { if (!condition) throw new Error(message); };
const frame = document.getElementById("workspace-frame");
let appWindow;
let appDocument;
let started = false;
const evaluate = (source) => appWindow.eval(source);
const fixture = {
  root: "demo_project",
  nodes: [
    { id: "file:main", kind: "file", label: "main.py", path: "main.py", symbol_count: 1 },
    { id: "file:worker", kind: "file", label: "worker.py", path: "worker.py", symbol_count: 1 },
    { id: "symbol:run", kind: "function", label: "run", qualname: "main.run", file_id: "file:main", path: "main.py", line: 1, end_line: 20 },
    { id: "symbol:execute", kind: "function", label: "execute", qualname: "worker.execute", file_id: "file:worker", path: "worker.py", line: 1, end_line: 4 },
    { id: "external:module:library", kind: "external", label: "library" },
  ],
  edges: [
    { id: "contains", source: "file:main", target: "symbol:run", type: "CONTAINS", line: 1, status: "resolved", confidence: 1 },
    ...Array.from({ length: 12 }, (value, index) => ({ id: `call:${index}`, source: "symbol:run", target: "symbol:execute", type: "CALLS", line: index + 2, path: "main.py", evidence: "execute('<script>')", status: "resolved", confidence: 1 })),
    { id: "external", source: "symbol:run", target: "external:module:library", type: "CALLS", line: 20, status: "inferred", confidence: .85 },
  ],
  file_edges: [
    { id: "file-calls", source: "file:main", target: "file:worker", type: "CALLS", count: 12 },
    { id: "file-types", source: "file:main", target: "file:worker", type: "USES_TYPE", count: 1 },
  ],
  stats: { files: 2, symbols: 2, edges: 14 },
  warnings: [],
  limitations: [],
};
function reset(data = fixture) {
  appWindow.testFixture = structuredClone(data);
  evaluate("state.data = window.testFixture; state.selectedId = ''; state.query = ''; state.hidden.clear(); state.graphView = 'files'; state.focus = false; state.expanded = false; state.explorerOpen = false; state.error = ''; state.camera = { zoom: 1, panX: 0, panY: 0 }; document.querySelector('#search-input').value = ''; render();");
}
const click = (selector) => { const element = appDocument.querySelector(selector); assert(element, `Missing element: ${selector}`); element.click(); };
const input = (selector, value) => { const element = appDocument.querySelector(selector); element.value = value; element.dispatchEvent(new appWindow.Event("input", { bubbles: true })); };

test("Files sit on the circumference of a true circle", () => {
  reset();
  const geometry = evaluate("positions(Array.from({ length: 25 }, (_, index) => ({ id: 'file:' + index, kind: 'file' })))");
  assert(geometry.map.size === 25);
  const points = [...geometry.map.values()];
  for (const point of points) assert(Math.abs(Math.hypot(point.x - geometry.centerX, point.y - geometry.centerY) - geometry.radius) < .00001, "A file is not on the circle");
  assert(new Set(points.map((point) => `${point.x}:${point.y}`)).size === 25);
});

test("Large and single-file layouts remain finite and deterministic", () => {
  reset();
  for (const count of [1, 2, 100, 2000]) {
    appWindow.layoutCount = count;
    const first = evaluate("positions(Array.from({ length: window.layoutCount }, (_, index) => ({ id: 'file:' + index, kind: 'file' })))");
    const second = evaluate("positions(Array.from({ length: window.layoutCount }, (_, index) => ({ id: 'file:' + index, kind: 'file' })))");
    assert(first.map.size === count);
    assert(first.width === second.width);
    for (const [key, point] of first.map) {
      assert(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert(point.x === second.map.get(key).x && point.y === second.map.get(key).y);
      assert(point.x > 0 && point.x < first.width && point.y > 0 && point.y < first.height);
    }
  }
});

test("Every graph relationship has a directed arrow and animated flow", () => {
  reset();
  assert(appDocument.querySelectorAll(".relation-line[marker-end]").length === 2);
  assert(appDocument.querySelectorAll(".relation-flow").length === 2);
  assert(appDocument.querySelector("animateMotion"), "Moving arrow packets are missing");
  assert(!appDocument.querySelector("#map-stage").innerHTML.includes("NaN"));
  const titles = [...appDocument.querySelectorAll(".relation-link title")].map((element) => element.textContent);
  assert(titles.some((title) => title.includes("Calls: main.py")));
  assert(titles.some((title) => title.includes("Type annotations: main.py")));
});

test("All twelve relationship filters remain available", () => {
  reset();
  assert(appDocument.querySelectorAll("[data-relation]").length === 12);
  for (const type of ["CONTAINS", "USES_TYPE", "DECORATED_BY", "OVERRIDES", "REFERENCES", "RAISES"]) assert(appDocument.querySelector(`[data-relation="${type}"]`));
});

test("The symbol view includes internal links and external dependencies", () => {
  reset();
  click('[data-graph-view="symbols"]');
  assert(appDocument.querySelector('.map-card[data-node-id="symbol:run"]'));
  assert(appDocument.querySelector('.map-card[data-node-id="external:module:library"]'));
  assert(appDocument.querySelectorAll(".relation-line").length === 14);
  assert(evaluate("currentLayout.rings.some(ring => ring.kind === 'files')"));
  assert(evaluate("currentLayout.rings.some(ring => ring.kind === 'symbols')"));
});

test("Relationship filters change the map and inspector together", () => {
  reset();
  click('[data-graph-view="symbols"]');
  click('[data-node-id="file:main"]');
  click('[data-relation="CALLS"]');
  assert(appDocument.querySelectorAll(".relation-line").length === 1);
  assert(!appDocument.querySelector('.map-card[data-node-id="external:module:library"]'));
  assert(appDocument.querySelectorAll(".evidence-row").length === 1);
  click('[data-action="show-all"]');
  assert(appDocument.querySelectorAll(".relation-line").length === 14);
});

test("Dense symbol maps declutter labels without hiding selected symbols", () => {
  reset();
  click('[data-graph-view="symbols"]');
  evaluate("state.camera.zoom = .05; updateCamera()");
  const symbol = appDocument.querySelector('.map-card[data-node-id="symbol:run"]');
  assert(appDocument.querySelector("#graph-canvas").classList.contains("is-dense"));
  assert(appWindow.getComputedStyle(symbol.querySelector(".node-label")).visibility === "hidden");
  symbol.click();
  assert(appWindow.getComputedStyle(symbol.querySelector(".node-label")).visibility === "visible");
});

test("Symbol search keeps its owning file visible", () => {
  reset();
  input("#search-input", "execute");
  const rows = [...appDocument.querySelectorAll(".file-row")];
  assert(rows.length === 1 && rows[0].dataset.nodeId === "file:worker");
});

test("File inspection includes all evidence and escapes source expressions", () => {
  reset();
  click('.file-row[data-node-id="file:main"]');
  const inspector = appDocument.querySelector("#inspector-content");
  assert(inspector.querySelectorAll(".evidence-row").length === 14);
  assert(inspector.innerHTML.includes("&lt;script&gt;"));
  assert(!inspector.querySelector("script"));
  assert(inspector.querySelector('[data-node-id="symbol:execute"]'));
});

test("Selecting a node preserves the animated scene instead of rebuilding it", () => {
  reset();
  const world = appDocument.querySelector(".graph-world");
  click('.file-row[data-node-id="file:main"]');
  assert(appDocument.querySelector(".graph-world") === world);
  assert(appDocument.querySelector('.map-card[data-node-id="file:main"]').getAttribute("aria-pressed") === "true");
  assert(appDocument.querySelector("#graph-canvas").classList.contains("has-selection"));
});

test("Zoom controls, pointer-anchored zoom, and fit preserve valid camera state", () => {
  reset();
  const before = evaluate("state.camera.zoom");
  click('[data-action="zoom-in"]');
  assert(evaluate("state.camera.zoom") > before);
  click('[data-action="zoom-out"]');
  assert(Math.abs(evaluate("state.camera.zoom") - before) < .00001);
  evaluate("zoomGraph(1.4, { x: 123, y: 97 })");
  assert(evaluate("Number.isFinite(state.camera.panX) && Number.isFinite(state.camera.panY)"));
  click('[data-action="fit"]');
  assert(evaluate("state.camera.zoom === 1 && state.camera.panX === 0 && state.camera.panY === 0"));
  assert(!appDocument.querySelector(".graph-world").style.transform.includes("NaN"));
});

test("Scrolling over the scene zooms without scrolling the page", () => {
  reset();
  const stage = appDocument.querySelector("#map-stage");
  const before = evaluate("state.camera.zoom");
  const wheel = new appWindow.WheelEvent("wheel", { deltaY: -80, clientX: 300, clientY: 300, bubbles: true, cancelable: true });
  stage.dispatchEvent(wheel);
  assert(wheel.defaultPrevented);
  assert(evaluate("state.camera.zoom") > before);
});

test("Pause stops CSS and SVG animation and respects reduced-motion preference", () => {
  reset();
  const canvas = appDocument.querySelector("#graph-canvas");
  if (appWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    assert(evaluate("state.motion === false"));
    assert(canvas.classList.contains("motion-paused"));
    return;
  }
  evaluate("state.motion = true; applyMotion()");
  click('[data-action="motion"]');
  assert(canvas.classList.contains("motion-paused"));
  assert(appDocument.querySelector(".edge-layer").animationsPaused());
  assert(appWindow.getComputedStyle(appDocument.querySelector(".relation-flow")).animationPlayState === "paused");
  click('[data-action="motion"]');
  assert(!canvas.classList.contains("motion-paused"));
  assert(!appDocument.querySelector(".edge-layer").animationsPaused());
});

test("Expanded workspace hides panels and restores them", () => {
  reset();
  click('[data-action="expand"]');
  assert(appDocument.querySelector("#workspace").classList.contains("is-expanded"));
  assert(appWindow.getComputedStyle(appDocument.querySelector(".project-rail")).display === "none");
  assert(appWindow.getComputedStyle(appDocument.querySelector(".inspector")).display === "none");
  click('[data-action="expand"]');
  assert(!appDocument.querySelector("#workspace").classList.contains("is-expanded"));
});

test("Light and dark themes update without replacing the graph", () => {
  reset();
  const world = appDocument.querySelector(".graph-world");
  const before = appDocument.documentElement.dataset.theme;
  click("#theme-toggle");
  assert(appDocument.documentElement.dataset.theme !== before);
  assert(appDocument.querySelector(".graph-world") === world);
  click("#theme-toggle");
  assert(appDocument.documentElement.dataset.theme === before);
});

test("Empty searches have a working reset action", () => {
  reset();
  input("#search-input", "no-such-file");
  assert(appDocument.querySelector(".empty-map"));
  click('[data-action="clear-search"]');
  assert(appDocument.querySelectorAll(".map-card").length === 2);
  assert(appDocument.querySelector("#search-input").value === "");
});

test("Keyboard zoom and Escape work without interfering with text input", () => {
  reset();
  const stage = appDocument.querySelector("#map-stage");
  stage.focus();
  const before = evaluate("state.camera.zoom");
  stage.dispatchEvent(new appWindow.KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true }));
  assert(evaluate("state.camera.zoom") > before);
  click('.file-row[data-node-id="file:main"]');
  appDocument.dispatchEvent(new appWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert(evaluate("state.selectedId === ''"));
  input("#search-input", "run");
  appDocument.querySelector("#search-input").dispatchEvent(new appWindow.KeyboardEvent("keydown", { key: "+", bubbles: true }));
  assert(appDocument.querySelector("#search-input").value === "run");
});

test("The interface loads only local styles and scripts", () => {
  const resources = [...appDocument.querySelectorAll("script[src], link[rel='stylesheet']")];
  assert(resources.every((resource) => new URL(resource.src || resource.href).origin === location.origin));
  assert(!appDocument.querySelector('script[src*="node_modules"]'));
});

test("Small screens keep controls inside the viewport and expose the explorer", async () => {
  reset();
  const previousWidth = frame.style.width;
  for (const width of [390, 600, 900, 1280]) {
    frame.style.width = `${width}px`;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(appDocument.documentElement.scrollWidth <= appWindow.innerWidth + 1, `Page overflows at ${width}px`);
    const controls = appDocument.querySelector(".canvas-controls").getBoundingClientRect();
    assert(controls.left >= 0 && controls.right <= appWindow.innerWidth + 1, `Canvas controls overflow at ${width}px`);
    if (width === 390) {
      const explorer = appDocument.querySelector('[data-action="explorer"]');
      assert(appWindow.getComputedStyle(explorer).display !== "none");
      explorer.click();
      assert(appWindow.getComputedStyle(appDocument.querySelector(".project-rail")).display !== "none");
      explorer.click();
    }
  }
  frame.style.width = previousWidth;
});

async function runTests() {
  if (started) return;
  appWindow = frame.contentWindow;
  appDocument = appWindow.document;
  if (!appDocument.querySelector("#map-stage") || !evaluate("typeof render === 'function'")) return;
  started = true;
  const parameters = new URLSearchParams(location.search);
  if (parameters.has("preview")) {
    for (const element of document.body.children) if (element !== frame) element.hidden = true;
    document.body.style.margin = "0";
    const viewport = Number(parameters.get("viewport"));
    frame.style.cssText = `position:fixed;inset:0;width:${viewport > 0 ? `${viewport}px` : "100vw"};height:100vh;margin:0;border:0;border-radius:0`;
    const theme = parameters.get("theme") || "dark";
    if (appDocument.documentElement.dataset.theme !== theme) click("#theme-toggle");
    input("#path-input", "demo_project");
    await evaluate("analyze()");
    for (let attempt = 0; attempt < 200 && !evaluate("Boolean(state.data || state.error)"); attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
    if (parameters.has("symbols")) { evaluate("state.graphView = 'symbols'; render()"); }
    if (parameters.has("expand")) click('[data-action="expand"]');
    const path = parameters.get("select");
    if (path) {
      appWindow.previewPath = path;
      evaluate("state.selectedId = nodes().find(node => node.kind === 'file' && node.path === window.previewPath)?.id || ''; render()");
    }
    document.documentElement.dataset.status = evaluate("state.error ? 'failed' : state.data ? 'passed' : 'pending'");
    document.documentElement.dataset.viewport = `${appWindow.innerWidth}/${appDocument.documentElement.scrollWidth}`;
    return;
  }
  const preferences = { motion: localStorage.getItem("pyarch-motion"), theme: localStorage.getItem("pyarch-theme") };
  const results = [];
  for (const entry of testCases) {
    const item = document.createElement("li");
    try {
      await entry.run();
      item.className = "pass";
      item.textContent = `PASS · ${entry.name}`;
      results.push({ name: entry.name, passed: true });
    } catch (error) {
      item.className = "fail";
      item.textContent = `FAIL · ${entry.name}: ${error.message}`;
      results.push({ name: entry.name, passed: false, error: error.stack || error.message });
    }
    document.getElementById("results").appendChild(item);
  }
  for (const [key, value] of Object.entries({ "pyarch-motion": preferences.motion, "pyarch-theme": preferences.theme })) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  const failed = results.filter((result) => !result.passed);
  document.getElementById("summary").textContent = `${results.length - failed.length}/${results.length} browser checks passed`;
  document.documentElement.dataset.status = failed.length ? "failed" : "passed";
  window.testResults = results;
  reset();
}
frame.addEventListener("load", runTests, { once: true });
if (frame.contentDocument?.readyState === "complete") runTests();
