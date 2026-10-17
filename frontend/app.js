const state = { data: null, job: "", selectedId: "", query: "", hidden: new Set(), status: "Ready to scan", error: "" };
let pollTimer = null;

const relationColors = { IMPORTS: "#4bb7a5", CALLS: "#f0b35b", INHERITS: "#ad8af5", DEFINES_ROUTE: "#6dcf8f", HTTP_REQUEST: "#f0799a" };
const relationLabels = { IMPORTS: "Imports", CALLS: "Calls", INHERITS: "Inheritance", DEFINES_ROUTE: "Routes", HTTP_REQUEST: "HTTP requests" };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const shortLabel = (node) => String(node.label || node.path || "Untitled").split(/[\\/]/).pop();
const initials = (label) => { const parts = String(label).replace(/[^a-zA-Z0-9_./-]/g, "").split(/[./_-]/).filter(Boolean); return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : label.slice(0, 2)).toUpperCase(); };
const number = (value) => new Intl.NumberFormat("en-US").format(value || 0);
const nodes = () => state.data?.nodes || [];
const files = () => { const query = state.query.trim().toLowerCase(); return nodes().filter((node) => node.kind === "file" && (!query || `${node.label} ${node.path || ""} ${node.module || ""}`.toLowerCase().includes(query))); };
const selected = () => nodes().find((node) => node.id === state.selectedId) || null;
const selectedFile = () => { const node = selected(); if (!node) return null; return node.kind === "file" ? node : nodes().find((item) => item.id === node.file_id) || null; };
const symbols = () => { const file = selectedFile(); const query = state.query.trim().toLowerCase(); return file ? nodes().filter((node) => node.kind !== "file" && node.file_id === file.id && (!query || `${node.label} ${node.qualname || ""} ${node.kind}`.toLowerCase().includes(query))) : []; };
const visibleEdges = () => { const ids = new Set(files().map((file) => file.id)); return (state.data?.file_edges || []).filter((edge) => !state.hidden.has(edge.type) && ids.has(edge.source) && ids.has(edge.target)); };

function setStatus(message, busy = false) {
  state.status = message;
  $("#status-text").textContent = message;
  $("#status-dot").classList.toggle("busy", busy);
}

function positions() {
  const result = new Map();
  const list = files();
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(Math.max(list.length, 1)))));
  const rows = Math.ceil(Math.max(list.length, 1) / columns);
  list.forEach((file, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    result.set(file.id, { x: columns === 1 ? 50 : 14 + (column * 72) / (columns - 1), y: rows === 1 ? 50 : 18 + (row * 64) / (rows - 1) });
  });
  return result;
}

function renderStats() {
  const stats = state.data?.stats;
  $("#stats").innerHTML = stats ? `<div class="stat-grid"><div><strong>${number(stats.files)}</strong><span>Files</span></div><div><strong>${number(stats.symbols)}</strong><span>Symbols</span></div><div><strong>${number(stats.edges)}</strong><span>Relations</span></div></div>` : `<div class="rail-placeholder">Run a scan to populate the project map.</div>`;
  $("#file-count").textContent = files().length;
  $("#rail-root").title = state.data?.root || $("#path-input").value;
  $("#rail-root span:last-child").textContent = state.data?.root || $("#path-input").value;
}

function renderFiles() {
  const list = files();
  $("#file-list").innerHTML = list.length ? list.map((file) => `<button class="file-row ${selectedFile()?.id === file.id ? "active" : ""}" data-node-id="${escapeHtml(file.id)}"><span class="file-icon">${escapeHtml(initials(shortLabel(file)))}</span><span class="file-row-copy"><strong>${escapeHtml(shortLabel(file))}</strong><small>${escapeHtml(file.module || "module")}</small></span><span class="file-count">${number(file.symbol_count)}</span></button>`).join("") : state.data ? `<div class="no-results">No files match “${escapeHtml(state.query)}”.</div>` : `<div class="rail-placeholder">Run a scan to populate the project map.</div>`;
}

function renderFilters() {
  $("#relation-filters").innerHTML = Object.keys(relationColors).map((type) => `<label class="relation-toggle ${state.hidden.has(type) ? "off" : ""}"><input type="checkbox" data-relation="${type}" ${state.hidden.has(type) ? "" : "checked"}><span class="relation-swatch" style="background:${relationColors[type]}"></span><span>${relationLabels[type]}</span></label>`).join("");
}

function renderMap() {
  const list = files();
  const stage = $("#map-stage");
  $("#map-summary").textContent = state.data ? `${list.length} files · ${visibleEdges().length} visible links` : "";
  if (!state.data) {
    stage.innerHTML = `<div class="empty-map"><div class="empty-orbit"><span></span><span></span><span></span></div><span class="eyebrow">Ready when you are</span><h2>See how your Python project fits together.</h2><p>Enter a directory path above and run an analysis. Files, symbols, calls, imports, and routes will appear here as a readable 2D map.</p><div class="empty-steps"><span><b>01</b> Point to a project</span><span><b>02</b> Analyze source</span><span><b>03</b> Inspect relationships</span></div></div>`;
    return;
  }
  if (!list.length) { stage.innerHTML = `<div class="empty-map"><span class="eyebrow">No matches</span><h2>Nothing found for “${escapeHtml(state.query)}”.</h2><p>Try a different file name, module, or symbol.</p></div>`; return; }
  const map = positions();
  const lines = visibleEdges().map((edge) => { const source = map.get(edge.source); const target = map.get(edge.target); if (!source || !target) return ""; return `<line x1="${source.x * 10}" y1="${source.y * 10}" x2="${target.x * 10}" y2="${target.y * 10}" stroke="${relationColors[edge.type] || "#7990ad"}" stroke-width="${Math.min(5, 1.5 + (edge.count || 1) / 3)}" stroke-opacity=".6"></line>`; }).join("");
  const cards = list.map((file) => { const position = map.get(file.id); const connected = visibleEdges().filter((edge) => edge.source === file.id || edge.target === file.id).length; return `<button class="map-card ${selectedFile()?.id === file.id ? "selected" : ""}" data-node-id="${escapeHtml(file.id)}" style="left:${position.x}%;top:${position.y}%"><span class="card-topline"><span class="file-icon large">${escapeHtml(initials(shortLabel(file)))}</span><span class="card-kind">PYTHON FILE</span><span class="card-menu">···</span></span><strong>${escapeHtml(shortLabel(file))}</strong><span class="card-path">${escapeHtml(file.module || file.path || "source file")}</span><span class="card-meta"><span>${number(file.symbol_count)} symbols</span><span>${connected} links</span></span></button>`; }).join("");
  stage.innerHTML = `<div class="map-viewport"><div class="map-grid"></div><svg class="edge-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><defs><filter id="soft-glow"><feGaussianBlur stdDeviation="2.5" result="coloredBlur"></feGaussianBlur><feMerge><feMergeNode in="coloredBlur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter></defs>${lines}</svg>${cards}<div class="map-key"><span><i class="key-dot"></i> File</span><span><i class="key-line"></i> Relationship</span></div></div>`;
}

function renderDock() {
  const file = selectedFile();
  const list = symbols();
  $("#symbol-dock").innerHTML = file && list.length ? `<div class="symbol-dock"><div class="dock-heading"><span>Symbols in ${escapeHtml(shortLabel(file))}</span><small>${list.length} found</small></div><div class="symbol-list">${list.map((symbol) => `<button class="symbol-chip ${selected()?.id === symbol.id ? "active" : ""}" data-node-id="${escapeHtml(symbol.id)}"><span>${escapeHtml(symbol.kind)}</span>${escapeHtml(symbol.label)}</button>`).join("")}</div></div>` : "";
}

function renderInspector() {
  const node = selected();
  $("#inspector-index").textContent = node ? "01" : "—";
  if (!node) { $("#inspector-content").innerHTML = `<div class="inspector-empty"><div class="inspector-empty-icon">+</div><h2>Select a node</h2><p>Choose a file on the map or in the project rail to inspect its symbols and evidence.</p></div>`; return; }
  const relatedEdges = (state.data?.edges || []).filter((edge) => edge.source === node.id || edge.target === node.id);
  const evidence = relatedEdges.slice(0, 8).map((edge) => { const relatedId = edge.source === node.id ? edge.target : edge.source; const related = nodes().find((item) => item.id === relatedId); return `<div class="evidence-row"><span class="evidence-type" style="color:${relationColors[edge.type] || "#a7b5c7"}">${escapeHtml(relationLabels[edge.type] || edge.type)}</span><strong>${edge.source === node.id ? "→" : "←"} ${escapeHtml(related?.label || relatedId)}</strong><small>line ${number(edge.line)} · ${escapeHtml(edge.status)} · ${Math.round((edge.confidence || 0) * 100)}% confidence</small></div>`; }).join("");
  const warnings = (state.data?.warnings || []).map((warning) => `<div class="notice warning"><span>!</span>${escapeHtml(warning.message)}</div>`).join("");
  const limitations = (state.data?.limitations || []).map((limitation) => `<div class="notice"><span>i</span>${escapeHtml(limitation)}</div>`).join("");
  $("#inspector-content").innerHTML = `<div class="inspector-content"><div class="detail-icon">${escapeHtml(initials(shortLabel(node)))}</div><span class="detail-kind">${escapeHtml(node.kind.replace(/_/g, " "))}</span><h2>${escapeHtml(node.qualname || node.path || node.label)}</h2><p class="detail-path">${escapeHtml(node.path || node.module || "No path available")}</p>${node.signature ? `<code class="signature">${escapeHtml(node.signature)}</code>` : ""}<div class="detail-stats"><span><b>${number(node.loc)}</b><small>lines</small></span><span><b>${number(symbols().length)}</b><small>symbols</small></span></div><div class="inspector-block"><span class="block-label">About</span><p>${escapeHtml(node.docstring || "No docstring was found for this node.")}</p></div>${node.snippet ? `<div class="inspector-block"><span class="block-label">Source preview</span><pre>${escapeHtml(node.snippet)}</pre></div>` : ""}<div class="inspector-block"><span class="block-label">Evidence</span>${evidence || `<p class="muted">No direct evidence edges for this node.</p>`}</div></div>${warnings}${limitations}`;
}

function render() {
  renderStats(); renderFiles(); renderFilters(); renderMap(); renderDock(); renderInspector();
  $("#export-button").disabled = !state.data;
  if (state.error) { const toast = document.createElement("div"); toast.className = "toast error-toast"; toast.textContent = state.error; $("#map-stage").appendChild(toast); }
}

async function pollAnalysis() {
  if (!state.job) return;
  try {
    const response = await fetch(`/api/analyses/${state.job}`);
    const result = await response.json();
    setStatus(`${result.progress || 0}% · ${result.message || "Scanning"}`, result.status !== "complete");
    if (result.status === "complete") { clearInterval(pollTimer); state.data = result.result; state.error = ""; setStatus("Scan complete"); render(); }
    if (result.status === "error") { clearInterval(pollTimer); state.error = result.message || "Analysis failed."; setStatus("Scan failed"); render(); }
  } catch { clearInterval(pollTimer); state.error = "The analyzer could not be reached. Is the backend running?"; setStatus("Connection lost"); render(); }
}

async function analyze() {
  const path = $("#path-input").value.trim();
  if (!path) { state.error = "Enter a project directory path first."; render(); return; }
  clearInterval(pollTimer); state.data = null; state.selectedId = ""; state.error = ""; setStatus("Starting scan", true); render();
  try {
    const response = await fetch("/api/analyses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
    if (!response.ok) throw new Error(await response.text());
    state.job = (await response.json()).job_id;
    pollTimer = setInterval(pollAnalysis, 400);
    pollAnalysis();
  } catch (error) { state.error = error instanceof Error ? error.message : "Unable to start analysis."; setStatus("Scan failed"); render(); }
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const nodeButton = event.target.closest("[data-node-id]");
  if (nodeButton) { state.selectedId = nodeButton.dataset.nodeId || ""; state.error = ""; render(); }
});
document.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLInputElement) || !event.target.dataset.relation) return;
  if (event.target.checked) state.hidden.delete(event.target.dataset.relation); else state.hidden.add(event.target.dataset.relation);
  render();
});
$("#path-input").addEventListener("input", () => { $("#rail-root span:last-child").textContent = $("#path-input").value; });
$("#search-input").addEventListener("input", (event) => { state.query = event.target.value; render(); });
$("#analyze-button").addEventListener("click", analyze);
$("#export-button").addEventListener("click", () => { if (state.job) window.open(`/api/analyses/${state.job}/export`, "_blank"); });

render();
