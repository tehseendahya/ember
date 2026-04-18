"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Search, ArrowRight, Sparkles, X, RotateCcw, Plus, Minus } from "lucide-react";
import type {
  GraphCluster,
  GraphContactNode,
  GraphTargetNode,
  UnifiedGraphViewModel,
} from "@/lib/network/graph-view-model";
import type { Contact, WorldSearchResult } from "@/lib/types";
import IntroRequestModal from "@/components/IntroRequestModal";

const VIEW = { w: 1200, h: 720 };
const CENTER = { x: 600, y: 360 };

const RING1_MIN = 150;
const RING1_MAX = 260;
const RING2_OFFSET = 98;
const MAX_RING1 = 18;
const MAX_RING2_PER_INTRODUCER = 5;

const CLUSTER_CENTERS: Record<GraphCluster, number> = {
  investors: 0,
  other: Math.PI * 0.5,
  operators: Math.PI,
  builders: -Math.PI * 0.5,
};
const CLUSTER_ARC = Math.PI * 0.55;

const CLUSTER_COLORS: Record<GraphCluster, string> = {
  investors: "#6366f1",
  builders: "#d97706",
  operators: "#10b981",
  other: "#64748b",
};

const CLUSTER_LABELS: Record<GraphCluster, string> = {
  investors: "Investors",
  builders: "Builders",
  operators: "Operators",
  other: "Other",
};

type PlacedContact = GraphContactNode & { x: number; y: number; angle: number; radius: number };
type PlacedTarget = GraphTargetNode & { x: number; y: number; angle: number };

function placeRing1(contacts: GraphContactNode[]): PlacedContact[] {
  const top = contacts.slice(0, MAX_RING1);
  const byCluster = new Map<GraphCluster, GraphContactNode[]>();
  for (const c of top) {
    const list = byCluster.get(c.cluster) ?? [];
    list.push(c);
    byCluster.set(c.cluster, list);
  }
  const placed: PlacedContact[] = [];
  for (const [cluster, list] of byCluster) {
    const center = CLUSTER_CENTERS[cluster];
    const sorted = [...list].sort((a, b) => b.relationshipScore - a.relationshipScore);
    const n = sorted.length;
    sorted.forEach((c, i) => {
      const angle =
        n === 1 ? center : center + (i - (n - 1) / 2) * (CLUSTER_ARC / Math.max(1, n - 1));
      const score = Math.max(0, Math.min(100, c.relationshipScore));
      const radius = RING1_MIN + (RING1_MAX - RING1_MIN) * (1 - score / 100);
      placed.push({
        ...c,
        angle,
        radius,
        x: CENTER.x + Math.cos(angle) * radius,
        y: CENTER.y + Math.sin(angle) * radius,
      });
    });
  }
  return placed;
}

function placeRing2(
  ring1: PlacedContact[],
  targets: GraphTargetNode[],
): PlacedTarget[] {
  const byId = new Map(ring1.map((c) => [c.id, c]));
  const byIntroducer = new Map<string, GraphTargetNode[]>();
  for (const t of targets) {
    if (!byId.has(t.introducedByContactId)) continue;
    const list = byIntroducer.get(t.introducedByContactId) ?? [];
    list.push(t);
    byIntroducer.set(t.introducedByContactId, list);
  }
  const placed: PlacedTarget[] = [];
  for (const [introducerId, list] of byIntroducer) {
    const parent = byId.get(introducerId)!;
    const sorted = [...list]
      .sort((a, b) => b.introScore - a.introScore)
      .slice(0, MAX_RING2_PER_INTRODUCER);
    const n = sorted.length;
    sorted.forEach((t, j) => {
      const offset = n === 1 ? 0 : (j - (n - 1) / 2) * (Math.PI / 7);
      const angle = parent.angle + offset;
      placed.push({
        ...t,
        angle,
        x: parent.x + Math.cos(angle) * RING2_OFFSET,
        y: parent.y + Math.sin(angle) * RING2_OFFSET,
      });
    });
  }
  return placed;
}

function matchesQuery(q: string, ...fields: Array<string | undefined>): boolean {
  if (!q) return false;
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase().slice(0, 2);
}

function targetToWorldSearch(target: GraphTargetNode, introducer: GraphContactNode): WorldSearchResult {
  return {
    id: `graph-target-${target.edgeId}`,
    name: target.name,
    role: target.role,
    company: target.company,
    avatar: initialsFrom(target.name),
    avatarColor: "#7c3aed",
    relevance: target.introScore / 100,
    reason: `Warm path via ${introducer.name}`,
    introducers: [target.introducedByContactId],
    connectionPath: `You → ${introducer.name} → ${target.name}`,
    pathScore: target.introScore,
    sourceUrl: "",
  };
}

export default function NetworkGraph({
  model,
  contacts,
  selectedNodeId,
  onSelectNode,
}: {
  model: UnifiedGraphViewModel;
  contacts: Contact[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragOrigin = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [introTarget, setIntroTarget] = useState<{
    target: GraphTargetNode;
    introducer: GraphContactNode;
  } | null>(null);

  const ring1 = useMemo(() => placeRing1(model.contacts), [model.contacts]);
  const ring2 = useMemo(() => placeRing2(ring1, model.targets), [ring1, model.targets]);

  const ring1ById = useMemo(() => new Map(ring1.map((c) => [c.id, c])), [ring1]);
  const ring2ByEdgeId = useMemo(
    () => new Map(ring2.map((t) => [t.edgeId, t])),
    [ring2],
  );

  const activeConnectorIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of ring2) s.add(t.introducedByContactId);
    return s;
  }, [ring2]);

  const highlightSet = useMemo(() => {
    const set = new Set<string>();
    if (query.trim()) {
      for (const c of ring1) {
        if (matchesQuery(query, c.name, c.role, c.company)) {
          set.add(`contact:${c.id}`);
        }
      }
      for (const t of ring2) {
        if (matchesQuery(query, t.name, t.role, t.company)) {
          set.add(`target:${t.edgeId}`);
          set.add(`contact:${t.introducedByContactId}`);
        }
      }
      return set;
    }
    const activeId = hoverId ?? selectedNodeId;
    if (!activeId) return set;
    if (activeId.startsWith("contact:")) {
      const id = activeId.slice("contact:".length);
      set.add(activeId);
      for (const t of ring2) {
        if (t.introducedByContactId === id) set.add(`target:${t.edgeId}`);
      }
    } else if (activeId.startsWith("target:")) {
      const edgeId = activeId.slice("target:".length);
      const t = ring2ByEdgeId.get(edgeId);
      if (t) {
        set.add(activeId);
        set.add(`contact:${t.introducedByContactId}`);
      }
    }
    return set;
  }, [query, hoverId, selectedNodeId, ring1, ring2, ring2ByEdgeId]);

  const focused = highlightSet.size > 0;

  const opacityFor = useCallback(
    (nodeKey: string): number => {
      if (!focused) return 1;
      return highlightSet.has(nodeKey) ? 1 : 0.18;
    },
    [focused, highlightSet],
  );

  const pathActive = useCallback(
    (introducerId: string, edgeId: string): boolean => {
      return (
        highlightSet.has(`target:${edgeId}`) &&
        highlightSet.has(`contact:${introducerId}`)
      );
    },
    [highlightSet],
  );

  const selected = selectedNodeId;
  const selectedContact: PlacedContact | null = selected?.startsWith("contact:")
    ? ring1ById.get(selected.slice("contact:".length)) ?? null
    : null;
  const selectedTarget: PlacedTarget | null = selected?.startsWith("target:")
    ? ring2ByEdgeId.get(selected.slice("target:".length)) ?? null
    : null;

  function onSvgMouseDown(e: React.MouseEvent) {
    if ((e.target as SVGElement).tagName !== "svg" && (e.target as SVGElement).tagName !== "rect") {
      return;
    }
    setDragging(true);
    dragOrigin.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
  }
  function onSvgMouseMove(e: React.MouseEvent) {
    if (!dragging || !dragOrigin.current) return;
    setPan({
      x: dragOrigin.current.px + (e.clientX - dragOrigin.current.mx),
      y: dragOrigin.current.py + (e.clientY - dragOrigin.current.my),
    });
  }
  function onSvgMouseUp() {
    setDragging(false);
    dragOrigin.current = null;
  }
  function onWheel(e: React.WheelEvent) {
    const dz = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((z) => Math.max(0.7, Math.min(1.8, z + dz)));
  }

  function handleRequestIntro(target: GraphTargetNode) {
    const introducer = ring1ById.get(target.introducedByContactId);
    if (!introducer) return;
    setIntroTarget({ target, introducer });
  }

  const totalReachable = ring2.length;
  const connectorCount = activeConnectorIds.size;
  const warmPaths = ring2.filter((t) => t.introScore >= 60).length;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "14px",
        overflow: "hidden",
      }}
    >
      <div className="radar-top">
        <div className="radar-stats">
          <span><strong>{warmPaths}</strong> warm paths</span>
          <span className="radar-divider">·</span>
          <span><strong>{totalReachable}</strong> reachable</span>
          <span className="radar-divider">·</span>
          <span><strong>{connectorCount}</strong> connectors</span>
        </div>
        <div className="radar-search">
          <Search size={14} color="#9ca3af" style={{ flexShrink: 0 }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, role, or company…"
            aria-label="Search the graph"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="radar-search-clear"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="radar-zoom">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.7, z - 0.15))}>
            <Minus size={12} />
          </button>
          <button type="button" aria-label="Reset view" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
            <RotateCcw size={12} />
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.8, z + 0.15))}>
            <Plus size={12} />
          </button>
        </div>
      </div>

      <div className="radar-body">
        <div className="radar-canvas-wrap">
          <svg
            viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
            style={{
              display: "block",
              background:
                "radial-gradient(circle at 50% 50%, #ffffff 0%, #fafbff 55%, #f3f4f6 100%)",
              cursor: dragging ? "grabbing" : "grab",
              userSelect: "none",
            }}
            onMouseDown={onSvgMouseDown}
            onMouseMove={onSvgMouseMove}
            onMouseUp={onSvgMouseUp}
            onMouseLeave={onSvgMouseUp}
            onWheel={onWheel}
            onClick={(e) => {
              if ((e.target as SVGElement).tagName === "svg" || (e.target as SVGElement).tagName === "rect") {
                onSelectNode(null);
              }
            }}
          >
            <rect x={0} y={0} width={VIEW.w} height={VIEW.h} fill="transparent" />
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {/* Background ring guides */}
              {[
                { r: 95, label: null },
                { r: RING1_MIN - 10, label: "Close" },
                { r: RING1_MAX + 18, label: "Reachable" },
                { r: RING1_MAX + RING2_OFFSET + 24, label: "Beyond" },
              ].map((ring, i) => (
                <g key={`guide-${i}`} className="radar-guide">
                  <circle
                    cx={CENTER.x}
                    cy={CENTER.y}
                    r={ring.r}
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth={1}
                    strokeDasharray="4 6"
                    opacity={0.7}
                  />
                  {ring.label && (
                    <text
                      x={CENTER.x + ring.r + 6}
                      y={CENTER.y + 3}
                      fontSize={10}
                      fontWeight={500}
                      fill="#9ca3af"
                      style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
                    >
                      {ring.label}
                    </text>
                  )}
                </g>
              ))}

              {/* Paths: YOU -> introducer and introducer -> target */}
              {ring2.map((t) => {
                const introducer = ring1ById.get(t.introducedByContactId);
                if (!introducer) return null;
                const active = pathActive(introducer.id, t.edgeId);
                const baseOpacity = focused ? (active ? 0.7 : 0.06) : 0.28;
                const stroke = active ? "#7c3aed" : "#a78bfa";
                const width = active ? 2.2 : 1.3;
                return (
                  <g key={`path-${t.edgeId}`}>
                    <line
                      x1={CENTER.x}
                      y1={CENTER.y}
                      x2={introducer.x}
                      y2={introducer.y}
                      stroke={stroke}
                      strokeWidth={width}
                      strokeOpacity={baseOpacity}
                      strokeLinecap="round"
                    />
                    <line
                      x1={introducer.x}
                      y1={introducer.y}
                      x2={t.x}
                      y2={t.y}
                      stroke={stroke}
                      strokeWidth={width}
                      strokeOpacity={baseOpacity}
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}

              {/* Ring 2: targets */}
              {ring2.map((t, idx) => {
                const key = `target:${t.edgeId}`;
                const o = opacityFor(key);
                const glow = highlightSet.has(key);
                const r = 9 + (t.introScore / 100) * 5;
                const isSelected = selectedNodeId === key;
                return (
                  <g
                    key={t.edgeId}
                    className="radar-pop"
                    style={{ animationDelay: `${80 + idx * 18}ms`, opacity: o }}
                    onMouseEnter={() => setHoverId(key)}
                    onMouseLeave={() => setHoverId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectNode(isSelected ? null : key);
                    }}
                  >
                    {glow && (
                      <circle
                        cx={t.x}
                        cy={t.y}
                        r={r + 7}
                        fill="#7c3aed"
                        opacity={0.16}
                      />
                    )}
                    <circle
                      cx={t.x}
                      cy={t.y}
                      r={r}
                      fill="#fff"
                      stroke={isSelected ? "#111827" : "#7c3aed"}
                      strokeWidth={isSelected ? 2.4 : 1.6}
                      style={{ cursor: "pointer" }}
                    />
                    <text
                      x={t.x}
                      y={t.y - r - 6}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={500}
                      fill="#374151"
                      style={{ pointerEvents: "none" }}
                    >
                      {t.name.split(/\s+/)[0]}
                    </text>
                  </g>
                );
              })}

              {/* Ring 1: close contacts */}
              {ring1.map((c, idx) => {
                const key = `contact:${c.id}`;
                const o = opacityFor(key);
                const isSelected = selectedNodeId === key;
                const glow = highlightSet.has(key);
                const r = 18 + (c.relationshipScore / 100) * 10;
                const color = CLUSTER_COLORS[c.cluster];
                return (
                  <g
                    key={c.id}
                    className="radar-pop"
                    style={{ animationDelay: `${idx * 22}ms`, opacity: o }}
                    onMouseEnter={() => setHoverId(key)}
                    onMouseLeave={() => setHoverId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectNode(isSelected ? null : key);
                    }}
                  >
                    {(glow || c.recentlyActive) && (
                      <circle
                        cx={c.x}
                        cy={c.y}
                        r={r + 8}
                        fill={glow ? color : color}
                        opacity={glow ? 0.22 : 0.1}
                      />
                    )}
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={r}
                      fill={c.avatarColor}
                      stroke={isSelected ? "#111827" : color}
                      strokeWidth={isSelected ? 3 : 2}
                      style={{ cursor: "pointer" }}
                    />
                    <text
                      x={c.x}
                      y={c.y + 4}
                      textAnchor="middle"
                      fontSize={Math.round(r * 0.55)}
                      fontWeight={700}
                      fill="#fff"
                      style={{ pointerEvents: "none" }}
                    >
                      {c.avatar}
                    </text>
                    <text
                      x={c.x}
                      y={c.y + r + 14}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="#374151"
                      style={{ pointerEvents: "none" }}
                    >
                      {c.name.split(/\s+/)[0]}
                    </text>
                  </g>
                );
              })}

              {/* YOU — dead center */}
              <g className="radar-you">
                <circle
                  cx={CENTER.x}
                  cy={CENTER.y}
                  r={42}
                  fill="#4f46e5"
                  opacity={0.14}
                  className="radar-pulse"
                />
                <circle
                  cx={CENTER.x}
                  cy={CENTER.y}
                  r={30}
                  fill="#4f46e5"
                  stroke="#fff"
                  strokeWidth={3}
                />
                <text
                  x={CENTER.x}
                  y={CENTER.y + 4}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={800}
                  fill="#fff"
                  letterSpacing="0.1em"
                >
                  YOU
                </text>
              </g>
            </g>
          </svg>
        </div>

        <RadarPanel
          model={model}
          ring1ById={ring1ById}
          ring2={ring2}
          selectedContact={selectedContact}
          selectedTarget={selectedTarget}
          onSelectNode={onSelectNode}
          onRequestIntro={handleRequestIntro}
        />
      </div>

      {introTarget && (
        <IntroRequestModal
          open
          onClose={() => setIntroTarget(null)}
          result={targetToWorldSearch(introTarget.target, introTarget.introducer)}
          contacts={contacts}
          searchQuery=""
        />
      )}

      <style>{`
        .radar-top {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-bottom: 1px solid #f3f4f6;
          background: #fff;
          flex-wrap: wrap;
        }
        .radar-stats {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: #6b7280;
          white-space: nowrap;
        }
        .radar-stats strong { color: #111827; font-weight: 700; }
        .radar-divider { color: #d1d5db; }
        .radar-search {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 220px;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 7px 12px;
          transition: border-color 0.15s, background 0.15s;
        }
        .radar-search:focus-within {
          background: #fff;
          border-color: #a5b4fc;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08);
        }
        .radar-search input {
          flex: 1;
          border: none;
          background: transparent;
          font-size: 13px;
          color: #111827;
          outline: none;
          min-width: 0;
        }
        .radar-search input::placeholder { color: #9ca3af; }
        .radar-search-clear {
          background: transparent;
          border: none;
          color: #9ca3af;
          cursor: pointer;
          padding: 2px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .radar-search-clear:hover { color: #374151; }
        .radar-zoom {
          display: inline-flex;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          overflow: hidden;
        }
        .radar-zoom button {
          border: none;
          background: transparent;
          color: #6b7280;
          padding: 7px 9px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .radar-zoom button + button { border-left: 1px solid #e5e7eb; }
        .radar-zoom button:hover { background: #f3f4f6; color: #111827; }

        .radar-body {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          min-height: 520px;
        }
        .radar-canvas-wrap {
          position: relative;
          min-height: 520px;
        }

        .radar-pop {
          transform-origin: center;
          animation: radar-pop-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes radar-pop-in {
          from { opacity: 0; transform: scale(0.6); }
          to { opacity: 1; transform: scale(1); }
        }
        .radar-pulse {
          animation: radar-pulse-anim 2.6s ease-in-out infinite;
          transform-origin: center;
          transform-box: fill-box;
        }
        @keyframes radar-pulse-anim {
          0%, 100% { opacity: 0.14; transform: scale(1); }
          50% { opacity: 0.24; transform: scale(1.08); }
        }

        @media (max-width: 980px) {
          .radar-body {
            grid-template-columns: 1fr;
          }
          .radar-canvas-wrap { min-height: 440px; }
        }
      `}</style>
    </div>
  );
}

function RadarPanel({
  model,
  ring1ById,
  ring2,
  selectedContact,
  selectedTarget,
  onSelectNode,
  onRequestIntro,
}: {
  model: UnifiedGraphViewModel;
  ring1ById: Map<string, PlacedContact>;
  ring2: PlacedTarget[];
  selectedContact: PlacedContact | null;
  selectedTarget: PlacedTarget | null;
  onSelectNode: (id: string | null) => void;
  onRequestIntro: (t: GraphTargetNode) => void;
}) {
  if (selectedTarget) {
    const introducer = ring1ById.get(selectedTarget.introducedByContactId);
    if (!introducer) return null;
    return (
      <aside className="radar-panel">
        <div className="radar-panel-head">
          <div className="radar-panel-label">How to reach</div>
          <button type="button" aria-label="Clear selection" onClick={() => onSelectNode(null)} className="radar-panel-close">
            <X size={14} />
          </button>
        </div>
        <div className="radar-panel-title">{selectedTarget.name}</div>
        <div className="radar-panel-sub">
          {selectedTarget.role}
          {selectedTarget.company ? ` · ${selectedTarget.company}` : ""}
        </div>

        <div className="radar-chain">
          <div className="radar-avatar radar-avatar-you">YOU</div>
          <ArrowRight size={14} color="#9ca3af" />
          <div
            className="radar-avatar"
            style={{ background: introducer.avatarColor }}
            title={introducer.name}
          >
            {introducer.avatar}
          </div>
          <ArrowRight size={14} color="#9ca3af" />
          <div className="radar-avatar radar-avatar-target">
            {initialsFrom(selectedTarget.name)}
          </div>
        </div>

        <div className="radar-score-row">
          <Sparkles size={14} color="#7c3aed" />
          <div>
            <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Intro score
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>
              {selectedTarget.introScore}<span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500 }}>/100</span>
            </div>
          </div>
        </div>

        <div className="radar-rationale">
          {introducer.name} is {introducer.relationshipScore >= 75 ? "a warm" : "an active"} contact
          {selectedTarget.introScoreSource === "inferred" ? " — edge strength estimated." : "."}
        </div>

        <button
          type="button"
          className="radar-cta"
          onClick={() => onRequestIntro(selectedTarget)}
        >
          Request intro
        </button>
        <Link href={`/people/${introducer.id}`} className="radar-link">
          Open {introducer.name.split(/\s+/)[0]}&rsquo;s profile
          <ArrowRight size={12} />
        </Link>

        <PanelStyles />
      </aside>
    );
  }

  if (selectedContact) {
    const reachable = ring2.filter((t) => t.introducedByContactId === selectedContact.id);
    return (
      <aside className="radar-panel">
        <div className="radar-panel-head">
          <div className="radar-panel-label">Connector</div>
          <button type="button" aria-label="Clear selection" onClick={() => onSelectNode(null)} className="radar-panel-close">
            <X size={14} />
          </button>
        </div>
        <div className="radar-panel-title">{selectedContact.name}</div>
        <div className="radar-panel-sub">
          {selectedContact.role} · {selectedContact.company}
        </div>

        <div className="radar-score-row">
          <div style={{ width: 14 }} />
          <div>
            <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Warmth
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>
              {selectedContact.relationshipScore}<span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500 }}>/100</span>
            </div>
          </div>
        </div>

        <div className="radar-section-title">
          Reachable via {selectedContact.name.split(/\s+/)[0]} ({reachable.length})
        </div>
        <div className="radar-list">
          {reachable.length === 0 ? (
            <div className="radar-empty">No recorded intro paths yet.</div>
          ) : (
            reachable
              .sort((a, b) => b.introScore - a.introScore)
              .map((t) => (
                <button
                  key={t.edgeId}
                  type="button"
                  className="radar-row"
                  onClick={() => onSelectNode(`target:${t.edgeId}`)}
                >
                  <div className="radar-row-main">
                    <div className="radar-row-name">{t.name}</div>
                    <div className="radar-row-sub">
                      {t.role}{t.company ? ` · ${t.company}` : ""}
                    </div>
                  </div>
                  <div className="radar-chip">{t.introScore}</div>
                </button>
              ))
          )}
        </div>

        <Link href={`/people/${selectedContact.id}`} className="radar-link">
          Open profile
          <ArrowRight size={12} />
        </Link>

        <PanelStyles />
      </aside>
    );
  }

  const top = model.introQueue.slice(0, 8);
  return (
    <aside className="radar-panel">
      <div className="radar-panel-head">
        <div className="radar-panel-label">Warmest intros</div>
      </div>
      <div className="radar-panel-sub" style={{ marginBottom: 10 }}>
        Click anyone on the radar to see the path.
      </div>
      <div className="radar-list">
        {top.length === 0 ? (
          <div className="radar-empty">
            No intro paths yet — log second-degree connections on contact profiles to start mapping your reach.
          </div>
        ) : (
          top.map((item) => (
            <button
              key={item.edgeId}
              type="button"
              className="radar-row"
              onClick={() => onSelectNode(`target:${item.edgeId}`)}
            >
              <div className="radar-row-main">
                <div className="radar-row-name">{item.targetName}</div>
                <div className="radar-row-sub">
                  {item.targetCompany ? `${item.targetCompany} · ` : ""}via {item.introducerName}
                </div>
              </div>
              <div className="radar-chip">{item.introScore}</div>
            </button>
          ))
        )}
      </div>
      <PanelStyles />
    </aside>
  );
}

function PanelStyles() {
  return (
    <style>{`
      .radar-panel {
        border-left: 1px solid #f3f4f6;
        background: #ffffff;
        padding: 18px 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
      }
      @media (max-width: 980px) {
        .radar-panel { border-left: none; border-top: 1px solid #f3f4f6; }
      }
      .radar-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .radar-panel-label {
        font-size: 11px;
        font-weight: 700;
        color: #9ca3af;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .radar-panel-close {
        background: transparent;
        border: none;
        color: #9ca3af;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        display: inline-flex;
      }
      .radar-panel-close:hover { background: #f3f4f6; color: #374151; }
      .radar-panel-title {
        font-size: 17px;
        font-weight: 700;
        color: #111827;
        line-height: 1.25;
      }
      .radar-panel-sub {
        font-size: 12px;
        color: #6b7280;
      }
      .radar-chain {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 0 2px;
      }
      .radar-avatar {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: #6366f1;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .radar-avatar-you { background: #4f46e5; font-size: 9px; letter-spacing: 0.06em; }
      .radar-avatar-target { background: #f3f4f6; color: #7c3aed; border: 1.5px solid #ddd6fe; }
      .radar-score-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: #faf8ff;
        border: 1px solid #ede9fe;
        border-radius: 10px;
      }
      .radar-rationale {
        font-size: 12px;
        color: #6b7280;
        line-height: 1.5;
      }
      .radar-cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 10px 14px;
        background: #4f46e5;
        color: #fff;
        border: none;
        border-radius: 9px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        margin-top: 4px;
        transition: background 0.15s;
      }
      .radar-cta:hover { background: #4338ca; }
      .radar-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: #4f46e5;
        text-decoration: none;
        font-weight: 600;
      }
      .radar-link:hover { text-decoration: underline; }
      .radar-section-title {
        font-size: 11px;
        font-weight: 700;
        color: #9ca3af;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        margin-top: 10px;
      }
      .radar-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 320px;
        overflow-y: auto;
        padding-right: 2px;
      }
      .radar-empty {
        font-size: 12px;
        color: #9ca3af;
        padding: 14px;
        background: #fafafa;
        border: 1px dashed #e5e7eb;
        border-radius: 10px;
        line-height: 1.5;
      }
      .radar-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 11px;
        border: 1px solid #f3f4f6;
        background: #fff;
        border-radius: 9px;
        cursor: pointer;
        text-align: left;
        width: 100%;
        transition: border-color 0.15s, background 0.15s;
      }
      .radar-row:hover {
        border-color: #ddd6fe;
        background: #faf8ff;
      }
      .radar-row-main { flex: 1; min-width: 0; }
      .radar-row-name {
        font-size: 13px;
        font-weight: 600;
        color: #111827;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .radar-row-sub {
        font-size: 11px;
        color: #6b7280;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .radar-chip {
        font-size: 11px;
        font-weight: 700;
        color: #7c3aed;
        background: #f5f3ff;
        border: 1px solid #ede9fe;
        border-radius: 6px;
        padding: 3px 7px;
        flex-shrink: 0;
      }
    `}</style>
  );
}
