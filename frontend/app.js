const $ = (selector) => document.querySelector(selector);
const icon = (name, className = "") => `<svg class="icon ${className}" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const shortLabel = (node) => String(node.label || node.path || "Untitled").split(/[\\/]/).pop();
const number = (value) => new Intl.NumberFormat("en-US").format(value || 0);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const readPreference = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writePreference = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const state = { data: null, job: "", selectedId: "", query: "", graphView: "files", hidden: new Set(), status: "Ready to explore", error: "", busy: false, focus: false, expanded: false, explorerOpen: false, motion: !motionPreference.matches && readPreference("pyarch-motion") !== "off", camera: { zoom: 1, panX: 0, panY: 0 } };
const relationColors = { CONTAINS: "#73869c", IMPORTS: "#79cbb0", CALLS: "#dfbd87", INSTANTIATES: "#c8d88d", REFERENCES: "#7db7de", USES_TYPE: "#b79edb", DECORATED_BY: "#d7a48e", INHERITS: "#a492d6", OVERRIDES: "#8e9fda", RAISES: "#dd938e", DEFINES_ROUTE: "#90cbaa", HTTP_REQUEST: "#cf91b5" };
const relationLabels = { CONTAINS: "Contains", IMPORTS: "Imports", CALLS: "Calls", INSTANTIATES: "Creates instances", REFERENCES: "References / callbacks", USES_TYPE: "Type annotations", DECORATED_BY: "Decorated by", INHERITS: "Inheritance", OVERRIDES: "Overrides", RAISES: "Raises", DEFINES_ROUTE: "Routes", HTTP_REQUEST: "HTTP requests" };
const filterLabels = { ...relationLabels, INSTANTIATES: "Instances", REFERENCES: "References", USES_TYPE: "Type usage", DECORATED_BY: "Decorators", HTTP_REQUEST: "HTTP requests" };
let pollTimer = null;
let analysisVersion = 0;
let currentLayout = null;
let currentEdges = [];
let currentNodes = [];
let lastMapKey = "";
let lastMapData = null;
let drag = null;
let suppressClick = false;

const nodes = () => state.data?.nodes || [];
const selected = () => nodes().find((node) => node.id === state.selectedId) || null;
const selectedFile = () => { const node = selected(); return node?.kind === "file" ? node : nodes().find((item) => item.id === node?.file_id) || null; };
const files = () => {
  const query = state.query.trim().toLowerCase();
  const matchingFiles = new Set(nodes().filter((node) => node.file_id && `${node.label} ${node.qualname || ""} ${node.kind}`.toLowerCase().includes(query)).map((node) => node.file_id));
  return nodes().filter((node) => node.kind === "file" && (!query || matchingFiles.has(node.id) || `${node.label} ${node.path || ""} ${node.module || ""}`.toLowerCase().includes(query)));
};
const symbols = () => {
  const file = selectedFile();
  const query = state.query.trim().toLowerCase();
  return file ? nodes().filter((node) => node.file_id === file.id && (!query || `${node.label} ${node.qualname || ""}`.toLowerCase().includes(query))) : [];
};
const graphNodes = () => {
  const list = files();
  if (state.graphView === "files") return list;
  const fileIds = new Set(list.map((file) => file.id));
  const local = nodes().filter((node) => fileIds.has(node.id) || fileIds.has(node.file_id));
  const localIds = new Set(local.map((node) => node.id));
  const dependencies = new Set((state.data?.edges || []).filter((edge) => localIds.has(edge.source) && !state.hidden.has(edge.type)).map((edge) => edge.target));
  return [...local, ...nodes().filter((node) => node.kind === "external" && dependencies.has(node.id))];
};
const activeGraphId = () => state.graphView === "files" ? selectedFile()?.id : selected()?.id;
const visibleEdges = (list = graphNodes()) => {
  const ids = new Set(list.map((node) => node.id));
  const edges = state.graphView === "files" ? state.data?.file_edges : state.data?.edges;
  const active = activeGraphId();
  return (edges || []).filter((edge) => !state.hidden.has(edge.type) && ids.has(edge.source) && ids.has(edge.target) && (!state.focus || !active || edge.source === active || edge.target === active));
};

function setStatus(message, busy = false) {
  state.status = message;
  state.busy = busy;
  $("#status-text").textContent = message;
  $("#status-dot").classList.toggle("busy", busy);
  $("#analyze-button").disabled = busy;
  $("#analyze-button span").textContent = busy ? "Analyzing..." : "Analyze project";
}

function positions(list) {
  const fileNodes = list.filter((node) => node.kind === "file");
  const symbolNodes = list.filter((node) => node.kind !== "file" && node.kind !== "external");
  const externalNodes = list.filter((node) => node.kind === "external");
  const rings = [];
  let radius = 0;
  if (symbolNodes.length) {
    radius = Math.max(155, symbolNodes.length * 43 / (Math.PI * 2));
    rings.push({ kind: "symbols", nodes: symbolNodes, radius });
  }
  if (externalNodes.length) {
    radius = Math.max(radius + 95, 190, externalNodes.length * 42 / (Math.PI * 2));
    rings.push({ kind: "dependencies", nodes: externalNodes, radius });
  }
  radius = Math.max(radius ? radius + 125 : 220, fileNodes.length * 68 / (Math.PI * 2));
  if (fileNodes.length) rings.push({ kind: "files", nodes: fileNodes, radius });
  const width = (radius + 145) * 2;
  const height = (radius + 75) * 2;
  const centerX = width / 2;
  const centerY = height / 2;
  const map = new Map();
  for (const ring of rings) ring.nodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / ring.nodes.length) * Math.PI * 2;
    map.set(node.id, { x: centerX + Math.cos(angle) * ring.radius, y: centerY + Math.sin(angle) * ring.radius, angle, radius: ring.radius });
  });
  return { map, width, height, centerX, centerY, radius, rings };
}

function renderStats() {
  const stats = state.data?.stats;
  $("#stats").innerHTML = `<div class="stat-grid"><div><strong>${stats ? number(stats.files) : "—"}</strong><span>Files</span></div><div><strong>${stats ? number(stats.symbols) : "—"}</strong><span>Symbols</span></div><div><strong>${stats ? number(stats.edges) : "—"}</strong><span>Relations</span></div></div>`;
  $("#file-count").textContent = files().length;
  const root = state.data?.root || $("#path-input").value;
  $("#rail-root").title = root;
  $("#rail-root span").textContent = root.split(/[\\/]/).filter(Boolean).pop() || root;
}

function renderFiles() {
  const list = files();
  $("#file-list").innerHTML = list.length ? list.map((file) => `<button type="button" class="file-row ${selectedFile()?.id === file.id ? "active" : ""}" data-node-id="${escapeHtml(file.id)}" title="${escapeHtml(file.path)}"><span class="file-icon">${icon("file")}</span><span class="file-row-copy"><strong>${escapeHtml(shortLabel(file))}</strong><small>${escapeHtml(file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "project root")}</small></span><span class="file-count">${number(file.symbol_count)}</span></button>`).join("") : `<div class="rail-placeholder">${state.data ? "No files match your search." : "Your project files will appear here. Start with the demo or enter a local directory."}</div>`;
}

function renderFilters() {
  const counts = new Map();
  for (const edge of state.data?.edges || []) counts.set(edge.type, (counts.get(edge.type) || 0) + 1);
  $("#relation-filters").innerHTML = Object.keys(relationColors).map((type) => `<label class="relation-toggle ${state.hidden.has(type) ? "off" : ""}" title="${relationLabels[type]}"><input type="checkbox" data-relation="${type}" aria-label="Show ${relationLabels[type]}" ${state.hidden.has(type) ? "" : "checked"}><span class="relation-swatch" style="background:${relationColors[type]}"></span><span class="relation-name">${filterLabels[type]}</span><small>${number(counts.get(type))}</small></label>`).join("");
}

function edgePaths(edges, layout, list) {
  const byId = new Map(list.map((node) => [node.id, node]));
  const groups = new Map();
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }
  let serial = 0;
  return [...groups.values()].flatMap((group) => group.map((edge, index) => {
    const source = layout.map.get(edge.source);
    const target = layout.map.get(edge.target);
    const deltaX = target.x - source.x;
    const deltaY = target.y - source.y;
    const distance = Math.hypot(deltaX, deltaY) || 1;
    const offset = clamp((index - (group.length - 1) / 2) * 16, -95, 95) * (edge.source < edge.target ? 1 : -1);
    const middleX = (source.x + target.x) / 2;
    const middleY = (source.y + target.y) / 2;
    const control = { x: middleX + (layout.centerX - middleX) * .42 - deltaY / distance * offset, y: middleY + (layout.centerY - middleY) * .42 + deltaX / distance * offset };
    const sourceDistance = Math.hypot(control.x - source.x, control.y - source.y) || 1;
    const targetDistance = Math.hypot(control.x - target.x, control.y - target.y) || 1;
    const sourcePadding = byId.get(edge.source)?.kind === "file" ? 30 : 21;
    const targetPadding = byId.get(edge.target)?.kind === "file" ? 31 : 22;
    const start = { x: source.x + (control.x - source.x) / sourceDistance * sourcePadding, y: source.y + (control.y - source.y) / sourceDistance * sourcePadding };
    const end = { x: target.x + (control.x - target.x) / targetDistance * targetPadding, y: target.y + (control.y - target.y) / targetDistance * targetPadding };
    const path = edge.source === edge.target
      ? `M ${source.x + 16} ${source.y - 20} C ${source.x + 90} ${source.y - 95} ${source.x + 100} ${source.y + 65} ${source.x + 27} ${source.y + 9}`
      : `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
    const sourceLabel = byId.get(edge.source)?.qualname || byId.get(edge.source)?.label;
    const targetLabel = byId.get(edge.target)?.qualname || byId.get(edge.target)?.label;
    const title = `${relationLabels[edge.type] || edge.type}: ${sourceLabel} → ${targetLabel}${edge.count ? ` (${edge.count})` : ""}`;
    const type = relationColors[edge.type] ? edge.type : "REFERENCES";
    const edgeIndex = currentEdges.indexOf(edge);
    const order = serial++;
    const packet = order < 48 ? `<g class="signal-packet"><path d="M -4 -2.5 L 0 0 L -4 2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><animateMotion dur="${6 + order % 5}s" begin="-${order % 7}s" repeatCount="indefinite" rotate="auto" path="${path}"/></g>` : "";
    return `<g class="relation-link" data-edge-index="${edgeIndex}" data-source="${escapeHtml(edge.source)}" data-target="${escapeHtml(edge.target)}" style="--relation:${relationColors[type]};--flow-delay:-${order % 9}s"><title>${escapeHtml(title)}</title><path class="relation-line" d="${path}" ${edge.type === "CONTAINS" ? 'stroke-dasharray="3 5"' : ""} marker-end="url(#arrow-${type})"/><path class="relation-flow" d="${path}" pathLength="100" stroke-dasharray="1 16"/>${packet}</g>`;
  })).join("");
}

function orbitGuides(layout) {
  const circles = layout.rings.map((ring) => `<circle class="orbit-track" cx="${layout.centerX}" cy="${layout.centerY}" r="${ring.radius}"/><circle class="orbit-track secondary" cx="${layout.centerX}" cy="${layout.centerY}" r="${ring.radius + 24}"/>`).join("");
  const diameter = (layout.radius + 30) * 2;
  return `<div class="orbit-sweep" style="left:${layout.centerX - diameter / 2}px;top:${layout.centerY - diameter / 2}px;width:${diameter}px;height:${diameter}px"></div><svg class="orbit-guides" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true">${circles}<circle class="orbit-track secondary" cx="${layout.centerX}" cy="${layout.centerY}" r="112"/><circle class="orbit-tracer" cx="${layout.centerX}" cy="${layout.centerY}" r="${layout.radius + 40}"/><path class="orbit-crosshair" d="M ${layout.centerX} 35 V ${layout.height - 35} M 85 ${layout.centerY} H ${layout.width - 85}"/></svg>`;
}

function renderMap() {
  const list = graphNodes();
  const edges = visibleEdges(list);
  const stage = $("#map-stage");
  currentNodes = list;
  currentEdges = edges;
  $("#map-summary").textContent = state.data ? `${list.length} ${state.graphView === "files" ? "files" : "nodes"} · ${edges.length} links` : "";
  $("#canvas-caption").textContent = state.data ? `${edges.length} visible connections` : "Waiting for a project";
  document.querySelectorAll("[data-graph-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.graphView === state.graphView)));
  if (!state.data || !list.length) {
    const key = state.data ? "no-results" : "empty";
    if (lastMapKey !== key) stage.innerHTML = `<div class="empty-map"><div class="empty-orbit">${icon("orbit")}<i></i><i></i></div><span class="eyebrow">${state.data ? "A little too specific?" : "A new perspective on your code"}</span><h2>${state.data ? "No files in this orbit." : "Everything connects.<br>See how."}</h2><p>${state.data ? "Try another file name or symbol to find your way back." : "Turn your Python project into a living map. Explore files, trace dependencies, and discover the relationships in between."}</p><button class="empty-action" type="button" data-action="${state.data ? "clear-search" : "demo"}">${icon(state.data ? "search" : "orbit")}${state.data ? "Clear search" : "Explore the demo project"}${icon("arrow")}</button></div>`;
    currentLayout = null;
    lastMapKey = key;
    lastMapData = state.data;
    updateControls();
    applyMotion();
    return;
  }
  const key = `${state.graphView}|${list.map((node) => node.id).join(",")}|${edges.map((edge) => edge.id || `${edge.source}:${edge.target}:${edge.type}`).join(",")}`;
  if (lastMapKey !== key || lastMapData !== state.data) {
    const previousNodeIds = currentLayout ? [...currentLayout.map.keys()].join(",") : "";
    currentLayout = positions(list);
    if (previousNodeIds !== list.map((node) => node.id).join(",") || lastMapData !== state.data) state.camera = { zoom: 1, panX: 0, panY: 0 };
    const layout = currentLayout;
    const connections = new Map();
    for (const edge of edges) for (const nodeId of new Set([edge.source, edge.target])) connections.set(nodeId, (connections.get(nodeId) || 0) + 1);
    const cards = list.map((node, index) => {
      const position = layout.map.get(node.id);
      const isFile = node.kind === "file";
      const color = isFile ? node.path?.includes("clients/") ? "#b09bdd" : node.path?.includes("routes/") ? "#86bad8" : node.path?.includes("repositories/") ? "#d8b78f" : "var(--accent)" : node.kind === "external" ? "var(--purple)" : "#8cb9d7";
      const labelPosition = isFile ? `--label-x:${Math.cos(position.angle) * 73}px;--label-y:${Math.sin(position.angle) * 57}px;` : "";
      const metadata = isFile ? `${node.module || "root"} · ${connections.get(node.id) || 0}` : node.kind.replace(/_/g, " ");
      return `<button type="button" class="map-card ${isFile ? "file-card" : "symbol-card"} ${node.kind === "external" ? "external-card" : ""}" data-node-id="${escapeHtml(node.id)}" title="${escapeHtml(node.qualname || node.path || node.label)}" aria-label="${escapeHtml(`${node.kind.replace(/_/g, " ")}: ${node.qualname || node.path || node.label}`)}" style="left:${position.x}px;top:${position.y}px;--node-color:${color};${labelPosition}--arrival:${Math.min(index * .025, .8)}s"><span class="node-body"><span class="node-emblem">${icon(isFile ? "file" : node.kind === "external" ? "orbit" : "code")}</span><span class="node-label">${escapeHtml(shortLabel(node))}</span><span class="node-meta">${escapeHtml(metadata)}</span></span></button>`;
    }).join("");
    const markers = Object.keys(relationColors).map((type) => `<marker id="arrow-${type}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 7 3.5 L 0 7 Z" fill="${relationColors[type]}"/></marker>`).join("");
    const rootName = state.data.root?.split(/[\\/]/).filter(Boolean).pop() || "your project";
    stage.innerHTML = `<div class="graph-world" style="width:${layout.width}px;height:${layout.height}px">${orbitGuides(layout)}<svg class="edge-layer" viewBox="0 0 ${layout.width} ${layout.height}" aria-label="Directed project relationships"><defs>${markers}</defs>${edgePaths(edges, layout, list)}</svg><div class="orbit-nucleus" style="left:${layout.centerX}px;top:${layout.centerY}px">${icon("orbit", "nucleus-icon")}<span class="nucleus-caption">PROJECT ORBIT</span><span class="nucleus-count">${number(files().length)}</span><span class="nucleus-label">files, connected</span><span class="nucleus-project">${escapeHtml(rootName)}</span></div>${cards}</div>`;
    lastMapKey = key;
    lastMapData = state.data;
  }
  applySelection();
  updateCamera();
  applyMotion();
}

function applySelection() {
  const active = activeGraphId();
  const hasSelection = Boolean(active && currentLayout?.map.has(active));
  const connected = new Set([active]);
  for (const edge of currentEdges) if (edge.source === active || edge.target === active) { connected.add(edge.source); connected.add(edge.target); }
  $("#graph-canvas").classList.toggle("has-selection", hasSelection);
  document.querySelectorAll(".map-card").forEach((button) => {
    button.classList.toggle("selected", button.dataset.nodeId === active);
    button.classList.toggle("is-muted", hasSelection && !connected.has(button.dataset.nodeId));
    button.setAttribute("aria-pressed", String(button.dataset.nodeId === active));
  });
  document.querySelectorAll(".relation-link").forEach((group) => {
    const linked = group.dataset.source === active || group.dataset.target === active;
    group.classList.toggle("is-connected", hasSelection && linked);
    group.classList.toggle("is-muted", hasSelection && !linked);
  });
}

function fitScale() {
  if (!currentLayout) return 1;
  const stage = $("#map-stage");
  return Math.max(.001, Math.min((stage.clientWidth - 25) / currentLayout.width, (stage.clientHeight - 72) / currentLayout.height));
}

function updateCamera() {
  const world = $(".graph-world");
  if (world && currentLayout) {
    const stage = $("#map-stage");
    const scale = fitScale() * state.camera.zoom;
    $("#graph-canvas").classList.toggle("is-dense", state.graphView === "symbols" && scale < .6);
    const translateX = stage.clientWidth / 2 + state.camera.panX - currentLayout.centerX * scale;
    const translateY = stage.clientHeight / 2 + state.camera.panY - currentLayout.centerY * scale;
    world.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    $("#zoom-label").textContent = `${Math.round(scale * 100)}%`;
  } else $("#zoom-label").textContent = "100%";
  $("#edge-tooltip").hidden = true;
  updateControls();
}

function zoomGraph(factor, point) {
  if (!currentLayout) return;
  const stage = $("#map-stage");
  const oldZoom = state.camera.zoom;
  const newZoom = clamp(oldZoom * factor, .35, Math.max(10, 2.5 / fitScale()));
  const ratio = newZoom / oldZoom;
  const pointer = point || { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
  state.camera.panX = pointer.x - stage.clientWidth / 2 - (pointer.x - stage.clientWidth / 2 - state.camera.panX) * ratio;
  state.camera.panY = pointer.y - stage.clientHeight / 2 - (pointer.y - stage.clientHeight / 2 - state.camera.panY) * ratio;
  state.camera.zoom = newZoom;
  updateCamera();
}

function applyMotion() {
  const canvas = $("#graph-canvas");
  canvas.classList.toggle("motion-paused", !state.motion);
  const svg = $(".edge-layer");
  if (svg) {
    if (state.motion) svg.unpauseAnimations?.();
    else svg.pauseAnimations?.();
  }
  const button = $("#motion-toggle");
  button.setAttribute("aria-pressed", String(state.motion));
  button.title = motionPreference.matches ? "Reduced motion follows your system setting" : state.motion ? "Pause graph animations" : "Resume graph animations";
  button.innerHTML = `${icon(state.motion ? "pause" : "play")}<span>${state.motion ? "Live motion" : motionPreference.matches ? "Reduced motion" : "Motion paused"}</span>`;
}

function updateControls() {
  $("#workspace").classList.toggle("is-expanded", state.expanded);
  $("#workspace").classList.toggle("has-selection", Boolean(selected()));
  $("#workspace").classList.toggle("explorer-open", state.explorerOpen);
  document.querySelectorAll('[data-action="expand"]').forEach((button) => { button.setAttribute("aria-pressed", String(state.expanded)); button.title = state.expanded ? "Restore panels" : "Expand graph workspace"; });
  document.querySelectorAll('[data-action="focus"]').forEach((button) => { button.setAttribute("aria-pressed", String(state.focus)); button.disabled = !activeGraphId(); });
  document.querySelectorAll('[data-action="explorer"]').forEach((button) => button.setAttribute("aria-pressed", String(state.explorerOpen)));
  document.querySelectorAll('[data-action="zoom-in"], [data-action="zoom-out"], [data-action="fit"]').forEach((button) => { button.disabled = !currentLayout; });
}

function renderDock() {
  const file = selectedFile();
  const list = symbols();
  $("#symbol-dock").innerHTML = file && list.length ? `<div class="symbol-dock"><div class="dock-heading"><span>Inside ${escapeHtml(shortLabel(file))}</span><small>${list.length} symbols</small></div><div class="symbol-list">${list.map((symbol) => `<button type="button" class="symbol-chip ${selected()?.id === symbol.id ? "active" : ""}" data-node-id="${escapeHtml(symbol.id)}"><span>${escapeHtml(symbol.kind.replace(/_/g, " "))}</span>${escapeHtml(symbol.label)}</button>`).join("")}</div></div>` : "";
}

function renderInspector() {
  const node = selected();
  if (!node) {
    $("#inspector-content").innerHTML = `<div class="inspector-empty"><div class="inspector-orbit">${icon("focus")}<i></i><i></i></div><h2>A closer look.</h2><p>Select a file in the orbit to explore what lives inside and how it connects to everything else.</p><div class="inspector-tips"><div>${icon("file")}<span><strong>Discover the details</strong>Functions, classes, and source snippets.</span></div><div>${icon("arrow")}<span><strong>Follow a connection</strong>Every arrow has a type, a direction, and evidence.</span></div><div>${icon("focus")}<span><strong>Less noise, more signal</strong>Select a node, then focus its connections.</span></div></div></div>`;
    return;
  }
  const memberIds = new Set([node.id, ...nodes().filter((item) => node.kind === "file" && item.file_id === node.id).map((item) => item.id)]);
  const relatedEdges = (state.data?.edges || []).filter((edge) => !state.hidden.has(edge.type) && (memberIds.has(edge.source) || memberIds.has(edge.target))).sort((first, second) => Number(first.type === "CONTAINS") - Number(second.type === "CONTAINS"));
  const byId = new Map(nodes().map((item) => [item.id, item]));
  const endpoint = (nodeId) => { const item = byId.get(nodeId); return `<button type="button" class="evidence-link" data-node-id="${escapeHtml(nodeId)}">${escapeHtml(item?.qualname || item?.label || nodeId)}</button>`; };
  const evidence = relatedEdges.map((edge) => `<div class="evidence-row" style="--relation:${relationColors[edge.type] || "#7db7de"}"><span class="evidence-type">${escapeHtml(relationLabels[edge.type] || edge.type)}</span><div class="evidence-endpoints">${endpoint(edge.source)}<span>→</span>${endpoint(edge.target)}</div><details><summary>${escapeHtml(edge.path || "source")}:${number(edge.line)} · ${escapeHtml(edge.status)} · ${Math.round((edge.confidence || 0) * 100)}%</summary><pre>${escapeHtml(edge.evidence || "No source evidence")}</pre>${edge.explanation ? `<p>${escapeHtml(edge.explanation)}</p>` : ""}</details></div>`).join("");
  const warnings = (state.data?.warnings || []).map((warning) => `<div class="notice warning">${escapeHtml(warning.message)}</div>`).join("");
  const limitations = (state.data?.limitations || []).map((limitation) => `<div class="notice">${escapeHtml(limitation)}</div>`).join("");
  const lines = node.loc || (node.end_line && node.line ? node.end_line - node.line + 1 : 0);
  $("#inspector-content").innerHTML = `<div class="inspector-content"><div class="detail-heading"><div class="detail-icon">${icon(node.kind === "file" ? "file" : node.kind === "external" ? "orbit" : "code")}</div><div><span class="detail-kind">${escapeHtml(node.kind.replace(/_/g, " "))}</span><h2>${escapeHtml(shortLabel(node))}</h2></div></div><p class="detail-path">${escapeHtml(node.qualname || node.path || node.label)}</p>${node.signature ? `<code class="signature">(${escapeHtml(node.signature)})</code>` : ""}<div class="detail-stats"><span><b>${number(relatedEdges.length)}</b><small>Relationships</small></span><span><b>${number(node.kind === "file" ? memberIds.size - 1 : lines)}</b><small>${node.kind === "file" ? "Symbols inside" : "Lines of code"}</small></span></div>${node.docstring ? `<div class="inspector-block"><span class="block-label">About this node</span><p>${escapeHtml(node.docstring)}</p></div>` : ""}${node.snippet ? `<div class="inspector-block"><details class="source-disclosure"><summary>View source preview</summary><pre>${escapeHtml(node.snippet)}</pre></details></div>` : ""}<div class="inspector-block"><span class="block-label">Connections & evidence <b>${relatedEdges.length}</b></span>${evidence || '<p>No relationships match the active filters.</p>'}</div><details class="analysis-notes"><summary>Analysis notes & limitations</summary>${warnings}${limitations}</details></div>`;
}

function render() {
  renderStats();
  renderFiles();
  renderFilters();
  renderDock();
  renderInspector();
  renderMap();
  $("#export-button").disabled = !state.data;
  $("#error-toast").hidden = !state.error;
  $("#error-toast").textContent = state.error;
}

async function pollAnalysis(version = analysisVersion) {
  if (!state.job || version !== analysisVersion) return;
  try {
    const response = await fetch(`/api/analyses/${state.job}`);
    if (!response.ok) throw new Error("Unable to retrieve analysis progress.");
    const result = await response.json();
    if (version !== analysisVersion) return;
    if (result.status === "complete") {
      state.data = result.result;
      state.error = "";
      setStatus("Project mapped");
      render();
      return;
    }
    if (result.status === "error") throw new Error(result.message || "Analysis failed.");
    setStatus(`${result.progress || 0}% · ${result.message || "Mapping your project"}`, true);
    pollTimer = setTimeout(() => pollAnalysis(version), 400);
  } catch (error) {
    if (version !== analysisVersion) return;
    state.error = error instanceof Error ? error.message : "The analyzer could not be reached.";
    setStatus("Scan failed");
    render();
  }
}

async function analyze() {
  const path = $("#path-input").value.trim();
  if (!path) { state.error = "Enter a local project directory first."; render(); return; }
  clearTimeout(pollTimer);
  const version = ++analysisVersion;
  state.data = null;
  state.job = "";
  state.selectedId = "";
  state.focus = false;
  state.error = "";
  setStatus("Mapping your project", true);
  render();
  try {
    const response = await fetch("/api/analyses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(typeof error.detail === "string" ? error.detail : "Unable to start analysis. Check the directory path.");
    }
    const result = await response.json();
    if (version !== analysisVersion) return;
    state.job = result.job_id;
    pollAnalysis(version);
  } catch (error) {
    if (version !== analysisVersion) return;
    state.error = error instanceof Error ? error.message : "Unable to start analysis.";
    setStatus("Scan failed");
    render();
  }
}

function performAction(action) {
  if (action === "zoom-in") zoomGraph(1.25);
  if (action === "zoom-out") zoomGraph(.8);
  if (action === "fit") { state.camera = { zoom: 1, panX: 0, panY: 0 }; updateCamera(); }
  if (action === "motion") {
    if (motionPreference.matches) return;
    state.motion = !state.motion;
    writePreference("pyarch-motion", state.motion ? "on" : "off");
    applyMotion();
  }
  if (action === "expand") { state.expanded = !state.expanded; updateControls(); requestAnimationFrame(updateCamera); }
  if (action === "explorer") { state.explorerOpen = !state.explorerOpen; updateControls(); }
  if (action === "focus") { state.focus = !state.focus; render(); }
  if (action === "show-all") { state.hidden.clear(); render(); }
  if (action === "clear-selection") { state.selectedId = ""; state.focus = false; render(); }
  if (action === "clear-search") { state.query = ""; $("#search-input").value = ""; render(); }
  if (action === "demo") { $("#path-input").value = "demo_project"; analyze(); }
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (suppressClick) { suppressClick = false; return; }
  const action = event.target.closest("[data-action]");
  if (action) { performAction(action.dataset.action); return; }
  const view = event.target.closest("[data-graph-view]");
  if (view) { state.graphView = view.dataset.graphView; state.focus = false; render(); return; }
  const node = event.target.closest("[data-node-id]");
  if (node) { state.selectedId = node.dataset.nodeId || ""; state.error = ""; state.explorerOpen = false; render(); }
});

document.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLInputElement) || !event.target.dataset.relation) return;
  if (event.target.checked) state.hidden.delete(event.target.dataset.relation);
  else state.hidden.add(event.target.dataset.relation);
  render();
});

$("#scan-form").addEventListener("submit", (event) => { event.preventDefault(); analyze(); });
$("#path-input").addEventListener("input", renderStats);
$("#search-input").addEventListener("input", (event) => { state.query = event.target.value; render(); });
$("#export-button").addEventListener("click", () => { if (state.job && state.data) window.open(`/api/analyses/${state.job}/export`, "_blank", "noopener"); });

const stage = $("#map-stage");
stage.addEventListener("wheel", (event) => {
  if (!currentLayout) return;
  event.preventDefault();
  const bounds = stage.getBoundingClientRect();
  zoomGraph(Math.exp(-clamp(event.deltaY, -150, 150) * .0025), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
}, { passive: false });
stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !currentLayout || event.target.closest("[data-node-id]")) return;
  drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: state.camera.panX, panY: state.camera.panY, moved: false };
  suppressClick = false;
  stage.setPointerCapture(event.pointerId);
  stage.classList.add("is-dragging");
});
stage.addEventListener("pointermove", (event) => {
  if (drag && event.pointerId === drag.pointerId) {
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    if (Math.hypot(deltaX, deltaY) > 4) drag.moved = true;
    state.camera.panX = drag.panX + deltaX;
    state.camera.panY = drag.panY + deltaY;
    updateCamera();
    return;
  }
  const group = event.target.closest?.("[data-edge-index]");
  const tooltip = $("#edge-tooltip");
  if (!group) { tooltip.hidden = true; return; }
  const edge = currentEdges[Number(group.dataset.edgeIndex)];
  if (!edge) return;
  const byId = new Map(currentNodes.map((node) => [node.id, node]));
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  tooltip.innerHTML = `<strong>${escapeHtml(relationLabels[edge.type] || edge.type)}</strong>${escapeHtml(source?.qualname || source?.label)} → ${escapeHtml(target?.qualname || target?.label)}<br><small>${edge.count ? `${edge.count} source relationships` : escapeHtml(edge.status || "resolved")}</small>`;
  tooltip.hidden = false;
  const bounds = $("#graph-canvas").getBoundingClientRect();
  tooltip.style.left = `${clamp(event.clientX - bounds.left + 15, 8, Math.max(8, bounds.width - tooltip.offsetWidth - 10))}px`;
  tooltip.style.top = `${clamp(event.clientY - bounds.top + 15, 8, Math.max(8, bounds.height - tooltip.offsetHeight - 10))}px`;
});
function endDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const moved = drag.moved;
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  drag = null;
  suppressClick = moved;
  stage.classList.remove("is-dragging");
  if (moved) setTimeout(() => { suppressClick = false; }, 0);
}
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);
stage.addEventListener("lostpointercapture", endDrag);
stage.addEventListener("pointerleave", () => { $("#edge-tooltip").hidden = true; });

document.addEventListener("keydown", (event) => {
  const editing = event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']");
  if (event.key === "/" && !editing) { event.preventDefault(); $("#search-input").focus(); return; }
  if (event.key === "Escape") {
    state.selectedId = "";
    state.focus = false;
    state.explorerOpen = false;
    render();
    return;
  }
  if (editing || !stage.contains(event.target)) return;
  if (["+", "=", "-", "0", " "].includes(event.key)) event.preventDefault();
  if (event.key === "+" || event.key === "=") zoomGraph(1.25);
  if (event.key === "-") zoomGraph(.8);
  if (event.key === "0") performAction("fit");
  if (event.key === " ") performAction("motion");
});
motionPreference.addEventListener("change", () => {
  state.motion = !motionPreference.matches && readPreference("pyarch-motion") !== "off";
  applyMotion();
});
document.addEventListener("visibilitychange", () => {
  const svg = $(".edge-layer");
  if (document.hidden) svg?.pauseAnimations?.();
  else if (state.motion) svg?.unpauseAnimations?.();
});
if ("ResizeObserver" in window) new ResizeObserver(() => updateCamera()).observe(stage);
else window.addEventListener("resize", updateCamera);
render();
