// static/graph.js - Interactive physics-based session graph and canvas renderer

// --- Physics Simulation Constants ---
const REPEL = 1800;
const SPRING = 0.02;
const REST = 80;
const GRAVITY = 0.012;
const DAMP = 0.85;
const MIN_ALPHA = 0.01;

// --- State Variables ---
let graphActive = true;
let graphNodes = [];
let graphEdges = [];
let graphById = new Map();
let graphSize = { w: 0, h: 0, dpr: 1 };
let view = { tx: 0, ty: 0, scale: 1.25 };
let alpha = 1;
let frameQueued = false;
let hovered = null;
let drag = null;
let initialCenterDone = false;

// --- DOM and Callback References ---
let canvas, ctx, graphContainerBox, graphEmpty, homeInput;
let onSelectSessionCallback = null;

// --- Camera State Management ---
export function getCameraState() {
    return { tx: view.tx, ty: view.ty, scale: view.scale, initialCenterDone };
}

export function setCameraState(state) {
    if (state) {
        view.tx = state.tx;
        view.ty = state.ty;
        view.scale = state.scale;
        initialCenterDone = state.initialCenterDone;
    }
}

// --- Helper Calculations ---
const nodeRadius = (n) => 3 + Math.sqrt(n.degree) * 1.6;

const toWorld = (x, y) => ({
    x: (x - view.tx) / view.scale,
    y: (y - view.ty) / view.scale
});

function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function nodeAt(sx, sy) {
    const { x, y } = toWorld(sx, sy);
    for (let i = graphNodes.length - 1; i >= 0; i--) {
        const n = graphNodes[i];
        const r = nodeRadius(n) + 3 / view.scale;
        if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
    }
    return null;
}

// --- Initialization & Event Listeners ---
export function initGraph(options) {
    canvas = options.canvas;
    ctx = canvas.getContext('2d');
    graphContainerBox = options.containerBox;
    graphEmpty = options.emptyElement;
    homeInput = options.inputElement;
    onSelectSessionCallback = options.onSelectSession;

    new ResizeObserver(resizeGraph).observe(graphContainerBox);

    canvas.addEventListener('pointerdown', (e) => {
        const p = pointerPos(e);
        drag = { node: nodeAt(p.x, p.y), startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: false };
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
        const p = pointerPos(e);
        if (drag) {
            if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4) drag.moved = true;
            if (drag.node && drag.moved) {
                const w = toWorld(p.x, p.y);
                drag.node.x = w.x;
                drag.node.y = w.y;
                wake(0.3);
            } else if (!drag.node) {
                view.tx += p.x - drag.lastX;
                view.ty += p.y - drag.lastY;
            }
            drag.lastX = p.x;
            drag.lastY = p.y;
            requestFrame();
        } else {
            const hit = nodeAt(p.x, p.y);
            if (hit !== hovered) {
                hovered = hit;
                canvas.style.cursor = hit ? 'pointer' : 'default';
                requestFrame();
            }
        }
    });

    canvas.addEventListener('pointerup', () => {
        if (drag && drag.node && !drag.moved && onSelectSessionCallback) {
            onSelectSessionCallback(drag.node.id);
        }
        drag = null;
    });

    canvas.addEventListener('pointercancel', () => { drag = null; });

    canvas.addEventListener('pointerleave', () => {
        if (hovered && !drag) {
            hovered = null;
            requestFrame();
        }
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = pointerPos(e);
        const scale = Math.min(4, Math.max(0.2, view.scale * Math.exp(-e.deltaY * 0.001)));
        const k = scale / view.scale;
        view.tx = p.x - (p.x - view.tx) * k;
        view.ty = p.y - (p.y - view.ty) * k;
        view.scale = scale;
        requestFrame();
    }, { passive: false });
}

// --- Data Loading & Management ---
export async function loadGraph() {
    try {
        const res = await fetch('/api/graph');
        const data = await res.json();
        const prev = new Map(graphNodes.map((n) => [n.id, n]));

        graphNodes = data.nodes.map((n) => {
            const old = prev.get(n.id);
            const angle = Math.random() * Math.PI * 2;
            const radius = 40 + Math.random() * 120;
            return {
                id: n.id,
                title: n.title,
                pinned: !!n.is_pinned,
                x: old ? old.x : Math.cos(angle) * radius,
                y: old ? old.y : Math.sin(angle) * radius,
                vx: 0,
                vy: 0,
                degree: 0,
                neighbors: new Set()
            };
        });

        graphById = new Map(graphNodes.map((n) => [n.id, n]));
        
        graphEdges = data.edges.map((e) => ({
            a: graphById.get(e.source),
            b: graphById.get(e.target),
            weight: e.weight
        }));

        graphEdges.forEach((e) => {
            if (e.a && e.b) {
                e.a.neighbors.add(e.b.id);
                e.b.neighbors.add(e.a.id);
            }
        });

        graphNodes.forEach((n) => { n.degree = n.neighbors.size; });

        hovered = hovered ? (graphById.get(hovered.id) || null) : null;
        graphEmpty.classList.toggle('hidden', graphNodes.length > 0);
        if (!initialCenterDone) {
            initialCenterDone = false;
        }
        wake(prev.size ? 0.3 : 1);
    } catch (err) {
        console.error("Failed to load graph", err);
    }
}

export function setGraphActive(active) {
    graphActive = active;
    if (active) {
        resizeGraph();
        loadGraph();
    }
}

export function requestGraphFrame() {
    requestFrame();
}

export function highlightNodeById(sessionId) {
    if (!sessionId) {
        if (hovered !== null) {
            hovered = null;
            requestFrame();
        }
        return;
    }
    const found = graphById.get(sessionId);
    if (found !== hovered) {
        hovered = found || null;
        requestFrame();
    }
}

// --- Layout & Physics Engine ---
function centerGraph() {
    if (graphNodes.length === 0 || !graphSize.w) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    graphNodes.forEach((n) => {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
    });
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    view.tx = graphSize.w / 2 - cx * view.scale;
    view.ty = graphSize.h / 2 - cy * view.scale;
    initialCenterDone = true;
}

function step() {
    const ns = graphNodes;
    for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
            const a = ns[i], b = ns[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const d2 = Math.max(dx * dx + dy * dy, 100);
            const d = Math.sqrt(d2);
            const f = (REPEL / d2) * alpha;
            const fx = (dx / d) * f;
            const fy = (dy / d) * f;
            a.vx -= fx;
            a.vy -= fy;
            b.vx += fx;
            b.vy += fy;
        }
    }

    for (const e of graphEdges) {
        if (!e.a || !e.b) continue;
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
        const d = Math.hypot(dx, dy) || 1;
        const f = (((d - REST) * SPRING * Math.min(e.weight, 3)) * alpha) / d;
        e.a.vx += dx * f;
        e.a.vy += dy * f;
        e.b.vx -= dx * f;
        e.b.vy -= dy * f;
    }

    for (const n of ns) {
        if (drag && drag.node === n && drag.moved) {
            n.vx = n.vy = 0;
            continue;
        }
        n.vx = (n.vx - n.x * GRAVITY * alpha) * DAMP;
        n.vy = (n.vy - n.y * GRAVITY * alpha) * DAMP;
        const speed = Math.hypot(n.vx, n.vy);
        if (speed > 25) {
            const scaleFactor = 25 / speed;
            n.vx *= scaleFactor;
            n.vy *= scaleFactor;
        }
        n.x += n.vx;
        n.y += n.vy;
    }
    alpha *= 0.985;
}

// --- Canvas Rendering Loop ---
function draw() {
    const { w, h, dpr } = graphSize;
    if (!w) return;

    if (!initialCenterDone && graphNodes.length > 0) {
        centerGraph();
    }

    const accentRGB = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '244, 244, 245';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const q = homeInput ? homeInput.value.trim().toLowerCase() : '';
    const sources = new Set();
    if (q) graphNodes.forEach((n) => { if (n.title.toLowerCase().includes(q)) sources.add(n.id); });
    if (hovered) sources.add(hovered.id);
    const focusing = q.length > 0 || sources.size > 0;
    const lit = new Set(sources);
    sources.forEach((id) => {
        const node = graphById.get(id);
        if (node && node.neighbors) {
            node.neighbors.forEach((nid) => lit.add(nid));
        }
    });

    ctx.save();
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);

    for (const e of graphEdges) {
        if (!e.a || !e.b) continue;
        const on = sources.has(e.a.id) || sources.has(e.b.id);
        ctx.strokeStyle = on ? `rgba(${accentRGB}, 0.8)` : focusing ? `rgba(${accentRGB}, 0.05)` : `rgba(${accentRGB}, 0.2)`;
        ctx.lineWidth = (0.6 + Math.min(e.weight, 4) * 0.3) / view.scale;
        ctx.beginPath();
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
        ctx.stroke();
    }

    for (const n of graphNodes) {
        if (lit.has(n.id)) ctx.fillStyle = `rgba(${accentRGB}, 1.0)`;
        else if (focusing) ctx.fillStyle = n.pinned ? `rgba(${accentRGB}, 0.3)` : `rgba(${accentRGB}, 0.15)`;
        else ctx.fillStyle = n.pinned ? `rgba(${accentRGB}, 0.9)` : `rgba(${accentRGB}, 0.5)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, nodeRadius(n), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    const showAll = graphNodes.length <= 30 || view.scale > 1.4;
    for (const n of graphNodes) {
        const isLit = lit.has(n.id);
        if (focusing ? !isLit : !showAll) continue;
        ctx.fillStyle = focusing ? `rgba(${accentRGB}, 1.0)` : `rgba(${accentRGB}, 0.6)`;
        ctx.fillText(n.title, n.x * view.scale + view.tx, n.y * view.scale + view.ty + nodeRadius(n) * view.scale + 13);
    }
}

function frame() {
    frameQueued = false;
    if (!graphActive) return;
    
    if (alpha > MIN_ALPHA) {
        step();
    } else {
        const time = performance.now() * 0.0012;
        const breath = Math.sin(time) * 0.2;
        for (const n of graphNodes) {
            if (drag && drag.node === n) continue;
            const distFromOrigin = Math.hypot(n.x, n.y) || 1;
            const dirX = n.x / distFromOrigin;
            const dirY = n.y / distFromOrigin;
            n.x += dirX * breath * 0.05;
            n.y += dirY * breath * 0.05;
        }
    }

    draw();
    if (graphActive) requestFrame();
}

function requestFrame() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(frame);
}

function wake(a) {
    alpha = Math.max(alpha, a);
    requestFrame();
}

function resizeGraph() {
    const w = graphContainerBox.clientWidth;
    const h = graphContainerBox.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;

    graphSize = { w, h, dpr };
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    wake(0.2);
}