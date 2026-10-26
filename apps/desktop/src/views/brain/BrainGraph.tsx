import { Maximize2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type ForceGraph from "force-graph";
import type { LinkObject, NodeObject } from "force-graph";
import { brain, type BrainGraphData } from "~/api/brain";
import { Button } from "~/components/ui/Button";
import { Segmented, Spinner } from "~/components/ui/bits";
import { useTheme } from "~/app/theme";
import { cx } from "~/lib/cx";

/**
 * The brain as a living graph (Obsidian-style): you at the centre, the people
 * in your life, and what Mercury knows, joined only by real links (who
 * appears in which memory, who relates to whom). d3-force physics: drag a
 * node and its neighbours follow with springy, fluid motion; let go and it
 * settles. Canvas rendering; the library and the data load only when the
 * graph is opened; animation pauses while it is hidden; positions are kept
 * for the session so reopening doesn't re-settle from scratch.
 */

export interface GraphNode extends NodeObject {
  id: string;
  kind: "you" | "person" | "pet" | "memory";
  label: string;
  type?: string;
  weight: number;
  relationship?: string | null;
}

interface GraphLink extends LinkObject<GraphNode> {
  kind: "about" | "relation" | "you";
}

const POSITIONS_KEY = "mercury.brain.graph.positions.v1";
const TYPE_COLORS: Record<string, string> = {
  fact: "#7E8FA3", preference: "#C9A227", trait: "#9B7BD8", situation: "#5AA9C8", relationship: "#E07BA8",
  goal: "#3FB37F", project: "#8B7CF6", episode: "#6C8EF0", identity: "#2BB5C9", habit: "#E8894A", decision: "#4C8FD6", constraint: "#E06B6B", reflection: "#3BA99C",
};

export function BrainGraph({ visible, onSelect, selectedId }: { visible: boolean; onSelect: (node: { id: string; kind: GraphNode["kind"] } | null) => void; selectedId: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraph<GraphNode, GraphLink> | null>(null);
  const [data, setData] = useState<BrainGraphData | null>(null);
  const [limit, setLimit] = useState(300);
  const [show, setShow] = useState<"all" | "people" | "memories">("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const hover = useRef<GraphNode | null>(null);
  const neighbours = useRef<Set<string>>(new Set());
  const resolved = useTheme((s) => s.resolved);
  const selectedRef = useRef<string | null>(selectedId);
  selectedRef.current = selectedId;

  const load = useCallback(async (n: number) => {
    setLoading(true);
    setError(null);
    try { setData(await brain.graph(n)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, []);

  // Lazy: nothing is fetched until the graph is first shown.
  useEffect(() => { if (visible && !data && !loading) void load(limit); }, [visible, data, loading, limit, load]);

  const graphData = useMemo(() => (data ? toGraph(data, show) : null), [data, show]);

  // Create the engine once, lazily (dynamic import keeps it out of the main bundle).
  useEffect(() => {
    if (!visible || !graphData || graph.current || !host.current) return;
    let disposed = false;
    void import("force-graph").then(({ default: ForceGraphCtor }) => {
      if (disposed || !host.current) return;
      const el = host.current;
      const g = new ForceGraphCtor<GraphNode, GraphLink>(el)
        .width(el.clientWidth)
        .height(el.clientHeight)
        .backgroundColor("rgba(0,0,0,0)")
        .nodeId("id")
        .nodeRelSize(4)
        .d3VelocityDecay(0.28) // low friction: fluid, springy motion
        .d3AlphaDecay(0.018)
        .cooldownTime(12_000)
        .warmupTicks(30)
        .linkColor((l) => linkColor(l, hover.current))
        .linkWidth((l) => (hover.current && (endId(l.source) === hover.current.id || endId(l.target) === hover.current.id) ? 1.6 : 0.6))
        .nodeCanvasObject((node, ctx, scale) => drawNode(node, ctx, scale, hover.current, neighbours.current, selectedRef.current))
        .nodePointerAreaPaint((node, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(node.x ?? 0, node.y ?? 0, radius(node) + 3, 0, 2 * Math.PI); ctx.fill(); })
        .onNodeHover((node) => {
          hover.current = node ?? null;
          neighbours.current = node ? neighbourIds(g.graphData(), node.id) : new Set();
          el.style.cursor = node ? "pointer" : "grab";
        })
        .onNodeClick((node) => {
          onSelect({ id: node.id, kind: node.kind });
          g.centerAt(node.x, node.y, 500);
        })
        .onBackgroundClick(() => onSelect(null))
        .onNodeDragEnd((node) => {
          // Release it back into the flow (fluid) rather than pinning it.
          node.fx = undefined;
          node.fy = undefined;
          savePositions(g.graphData().nodes);
        })
        .onEngineStop(() => savePositions(g.graphData().nodes));
      const charge = g.d3Force("charge");
      charge?.strength?.((n: GraphNode) => (n.kind === "memory" ? -18 : n.kind === "you" ? -400 : -120));
      const link = g.d3Force("link");
      link?.distance?.((l: GraphLink) => (l.kind === "you" ? 90 : l.kind === "relation" ? 60 : 34));
      graph.current = g;
      g.graphData(withPositions(graphData));
      setTimeout(() => g.zoomToFit(600, 60), 900);
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => { disposed = true; };
  }, [visible, graphData, onSelect]);

  // New data or filter: swap the data in, keeping positions.
  useEffect(() => {
    if (graph.current && graphData) graph.current.graphData(withPositions(graphData, graph.current.graphData().nodes));
  }, [graphData]);

  // Pause when hidden: no frames, no CPU.
  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    if (visible) g.resumeAnimation();
    else g.pauseAnimation();
  }, [visible]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { graph.current?.width(el.clientWidth).height(el.clientHeight); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => { graph.current?._destructor(); graph.current = null; }, []);
  useEffect(() => { graph.current?.nodeCanvasObject(graph.current.nodeCanvasObject()); }, [resolved, selectedId]);

  const counts = data ? { people: data.persons.length, memories: data.memories.length, links: data.memoryPersons.length + data.relationships.length } : null;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={host} className="absolute inset-0" style={{ cursor: "grab" }} />
      <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2">
        <div className="pointer-events-auto"><Segmented value={show} onChange={setShow} options={[{ value: "all", label: "Everything" }, { value: "people", label: "People" }, { value: "memories", label: "Memories" }]} /></div>
        {counts && <span className="rounded-md bg-surface/80 px-2 py-1 text-xs text-ink3 backdrop-blur">{counts.people} people · {counts.memories} memories · {counts.links} links</span>}
      </div>
      <div className="absolute right-4 top-3 flex items-center gap-1.5">
        {data && data.memories.length >= limit && limit < 2000 && (
          <Button size="sm" variant="outline" onClick={() => { const next = Math.min(2000, limit * 2); setLimit(next); void load(next); }}>Load more</Button>
        )}
        <Button size="sm" variant="ghost" icon onClick={() => graph.current?.zoomToFit(500, 60)} aria-label="Fit to view"><Maximize2 size={14} /></Button>
        <Button size="sm" variant="ghost" icon onClick={() => void load(limit)} loading={loading} aria-label="Reload"><RefreshCw size={14} /></Button>
      </div>
      {!data && !error && <div className="absolute inset-0 flex items-center justify-center text-ink3"><Spinner size={20} /></div>}
      {error && <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-ink3">Couldn't load the brain: {error}</div>}
      {data && data.memories.length === 0 && data.persons.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-sm text-ink3">Nothing in the brain yet.</div>}
      <Legend />
    </div>
  );

  function linkColor(l: GraphLink, h: GraphNode | null): string {
    const dark = resolved === "dark";
    const lit = h && (endId(l.source) === h.id || endId(l.target) === h.id);
    if (lit) return dark ? "rgba(52,225,161,0.85)" : "rgba(26,158,110,0.85)";
    if (l.kind === "relation") return dark ? "rgba(224,123,168,0.5)" : "rgba(200,90,140,0.45)";
    return dark ? "rgba(230,234,237,0.12)" : "rgba(22,24,26,0.12)";
  }

  function drawNode(n: GraphNode, ctx: CanvasRenderingContext2D, scale: number, h: GraphNode | null, near: Set<string>, selected: string | null) {
    const dark = resolved === "dark";
    const r = radius(n);
    const dim = h && h.id !== n.id && !near.has(n.id);
    ctx.globalAlpha = dim ? 0.25 : 1;
    ctx.beginPath();
    ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
    ctx.fillStyle = n.kind === "you" ? (dark ? "#34E1A1" : "#1A9E6E") : n.kind === "person" ? (dark ? "#7FD8E8" : "#0E7C8C") : n.kind === "pet" ? "#F5C451" : TYPE_COLORS[n.type ?? ""] ?? "#8A97A3";
    ctx.fill();
    if (selected === n.id) {
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = dark ? "#fff" : "#000";
      ctx.stroke();
    }
    // Names for people always; memory labels only when zoomed in or hovered.
    const showLabel = n.kind !== "memory" || scale > 2.2 || h?.id === n.id;
    if (showLabel) {
      const size = Math.max(10 / scale, n.kind === "memory" ? 3 : 4);
      ctx.font = `${n.kind === "memory" ? 400 : 600} ${size}px "Geist Variable", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = dark ? "rgba(230,234,237,0.92)" : "rgba(22,24,26,0.9)";
      const text = n.kind === "memory" ? truncate(n.label, 48) : n.label;
      ctx.fillText(text, n.x ?? 0, (n.y ?? 0) + r + 1.5);
    }
    ctx.globalAlpha = 1;
  }
}

function toGraph(d: BrainGraphData, show: "all" | "people" | "memories"): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [{ id: "you", kind: "you", label: "You", weight: 10 }];
  const links: GraphLink[] = [];
  const people = show !== "memories";
  const mems = show !== "people";
  if (people) {
    for (const p of d.persons) {
      nodes.push({ id: p.id, kind: p.kind === "pet" ? "pet" : "person", label: p.name, weight: p.memoryCount, relationship: p.relationship });
      if (p.relationship && p.relationship !== "known") links.push({ source: "you", target: p.id, kind: "you" });
    }
    for (const r of d.relationships) links.push({ source: r.source, target: r.target, kind: "relation" });
  }
  if (mems) {
    for (const m of d.memories) nodes.push({ id: m.id, kind: "memory", label: m.summary, type: m.type, weight: m.importance });
    if (people) for (const l of d.memoryPersons) links.push({ source: l.memoryId, target: l.personId, kind: "about" });
    // Memories with no person are about you.
    const linked = new Set(people ? d.memoryPersons.map((l) => l.memoryId) : []);
    for (const m of d.memories) if (!linked.has(m.id)) links.push({ source: "you", target: m.id, kind: "you" });
  }
  return { nodes, links };
}

function radius(n: GraphNode): number {
  if (n.kind === "you") return 9;
  if (n.kind === "memory") return 2.2 + Math.min(2.5, n.weight * 2.5);
  return 3.5 + Math.min(6, Math.sqrt(n.weight) * 1.1);
}

function endId(e: string | number | GraphNode | undefined): string {
  return typeof e === "object" && e ? String(e.id) : String(e ?? "");
}

function neighbourIds(data: { links: GraphLink[] }, id: string): Set<string> {
  const out = new Set<string>();
  for (const l of data.links) {
    const s = endId(l.source);
    const t = endId(l.target);
    if (s === id) out.add(t);
    if (t === id) out.add(s);
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function savePositions(nodes: GraphNode[]): void {
  try {
    const out: Record<string, [number, number]> = {};
    for (const n of nodes) if (n.x !== undefined && n.y !== undefined) out[n.id] = [Math.round(n.x), Math.round(n.y)];
    sessionStorage.setItem(POSITIONS_KEY, JSON.stringify(out));
  } catch { /* storage full or blocked: positions are a convenience */ }
}

function withPositions(g: { nodes: GraphNode[]; links: GraphLink[] }, live?: GraphNode[]): { nodes: GraphNode[]; links: GraphLink[] } {
  let saved: Record<string, [number, number]> = {};
  try { saved = JSON.parse(sessionStorage.getItem(POSITIONS_KEY) ?? "{}"); } catch { saved = {}; }
  const current = new Map((live ?? []).map((n) => [n.id, n]));
  return {
    nodes: g.nodes.map((n) => {
      const c = current.get(n.id);
      if (c?.x !== undefined) return { ...n, x: c.x, y: c.y };
      const p = saved[n.id];
      return p ? { ...n, x: p[0], y: p[1] } : n;
    }),
    links: g.links.map((l) => ({ ...l, source: endId(l.source), target: endId(l.target) })),
  };
}

function Legend() {
  const items: Array<[string, string]> = [["You", "bg-accent"], ["Person", "bg-cyan"], ["Pet", "bg-amber"], ["Memory", "bg-ink3"]];
  return (
    <div className="pointer-events-none absolute bottom-3 left-4 flex items-center gap-3 rounded-md bg-surface/80 px-2.5 py-1.5 text-xs text-ink3 backdrop-blur">
      {items.map(([label, cls]) => <span key={label} className="flex items-center gap-1.5"><span className={cx("block h-2.5 w-2.5 rounded-full", cls)} />{label}</span>)}
      <span className="text-ink4">· drag to move · scroll to zoom · click for details</span>
    </div>
  );
}
