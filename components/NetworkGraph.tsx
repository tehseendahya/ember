"use client";

import { useMemo, useRef, useState } from "react";
import type { GraphCluster, UnifiedGraphViewModel } from "@/lib/network/graph-view-model";

const CLUSTER_COLORS: Record<GraphCluster, string> = {
  investors: "#4f46e5",
  builders: "#d97706",
  operators: "#059669",
  other: "#6b7280",
};

type Point = { x: number; y: number };

export default function NetworkGraph({
  model,
  selectedNodeId,
  onSelectNode,
  clusterFilter,
  onSelectCluster,
}: {
  model: UnifiedGraphViewModel;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  clusterFilter: GraphCluster | "all";
  onSelectCluster: (cluster: GraphCluster | "all") => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const dragOriginRef = useRef<Point | null>(null);
  const panOriginRef = useRef<Point | null>(null);
  const [dragging, setDragging] = useState(false);

  const contacts = useMemo(
    () => model.contacts.filter((c) => clusterFilter === "all" || c.cluster === clusterFilter),
    [model.contacts, clusterFilter],
  );
  const visibleIds = new Set(contacts.map((c) => c.id));
  const targets = model.targets.filter((t) => visibleIds.has(t.introducedByContactId));

  const scene = useMemo(() => {
    const clusters: GraphCluster[] = ["investors", "builders", "operators", "other"];
    const byCluster = new Map<GraphCluster, typeof contacts>();
    for (const c of clusters) byCluster.set(c, contacts.filter((x) => x.cluster === c));

    const contactPoints = new Map<string, Point>();
    const baseX: Record<GraphCluster, number> = {
      investors: 360,
      builders: 630,
      operators: 900,
      other: 1170,
    };

    for (const cluster of clusters) {
      const rows = byCluster.get(cluster) ?? [];
      const columns = Math.max(1, Math.ceil(rows.length / 6));
      rows.forEach((person, idx) => {
        const col = Math.floor(idx / 6);
        const row = idx % 6;
        contactPoints.set(person.id, {
          x: baseX[cluster] + col * 90,
          y: 130 + row * 86,
        });
      });
    }

    const targetPoints = new Map<string, Point>();
    const targetsByIntroducer = new Map<string, typeof targets>();
    for (const t of targets) {
      const list = targetsByIntroducer.get(t.introducedByContactId) ?? [];
      list.push(t);
      targetsByIntroducer.set(t.introducedByContactId, list);
    }
    for (const [introducerId, list] of targetsByIntroducer) {
      const source = contactPoints.get(introducerId);
      if (!source) continue;
      list.forEach((t, idx) => {
        targetPoints.set(t.id, {
          x: source.x + 300 + Math.floor(idx / 4) * 70,
          y: source.y - 42 + (idx % 4) * 28,
        });
      });
    }

    return { contactPoints, targetPoints };
  }, [contacts, targets]);

  const baseWidth = 1680;
  const baseHeight = 700;
  const centerY = baseHeight / 2;

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "14px", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: "8px", padding: "10px 12px", borderBottom: "1px solid #f3f4f6", flexWrap: "wrap", alignItems: "center" }}>
        {(["all", "investors", "builders", "operators", "other"] as const).map((cluster) => (
          <button
            key={cluster}
            type="button"
            onClick={() => onSelectCluster(cluster)}
            style={{
              padding: "6px 10px",
              borderRadius: "16px",
              border: "1px solid #e5e7eb",
              background: clusterFilter === cluster ? "rgba(79,70,229,0.08)" : "#fff",
              color: clusterFilter === cluster ? "#4f46e5" : "#6b7280",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            {cluster === "all" ? "All" : cluster}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "inline-flex", gap: "6px" }}>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.7, z - 0.15))} style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fff", fontSize: "12px", cursor: "pointer" }}>-</button>
          <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fff", fontSize: "12px", cursor: "pointer" }}>Reset</button>
          <button type="button" onClick={() => setZoom((z) => Math.min(2.2, z + 0.15))} style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fff", fontSize: "12px", cursor: "pointer" }}>+</button>
        </div>
      </div>

      <svg
        width="100%"
        height={540}
        viewBox={`0 0 ${baseWidth} ${baseHeight}`}
        style={{ display: "block", background: "#f8fafc", cursor: dragging ? "grabbing" : "grab" }}
        onMouseDown={(e) => {
          setDragging(true);
          dragOriginRef.current = { x: e.clientX, y: e.clientY };
          panOriginRef.current = pan;
        }}
        onMouseMove={(e) => {
          if (!dragging || !dragOriginRef.current || !panOriginRef.current) return;
          setPan({
            x: panOriginRef.current.x + (e.clientX - dragOriginRef.current.x),
            y: panOriginRef.current.y + (e.clientY - dragOriginRef.current.y),
          });
        }}
        onMouseUp={() => {
          setDragging(false);
          dragOriginRef.current = null;
          panOriginRef.current = null;
        }}
        onMouseLeave={() => {
          setDragging(false);
          dragOriginRef.current = null;
          panOriginRef.current = null;
        }}
        onWheel={(e) => {
          e.preventDefault();
          const dz = e.deltaY > 0 ? -0.08 : 0.08;
          setZoom((z) => Math.max(0.7, Math.min(2.2, z + dz)));
        }}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          <rect x={0} y={0} width={baseWidth} height={baseHeight} fill="#f8fafc" />

          <circle cx={120} cy={centerY} r={38} fill="#fff" stroke="#4f46e5" strokeWidth={3} />
          <text x={120} y={centerY + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#4f46e5">YOU</text>

          {(["investors", "builders", "operators", "other"] as const).map((cluster) => (
            <text
              key={cluster}
              x={{ investors: 360, builders: 630, operators: 900, other: 1170 }[cluster]}
              y={56}
              textAnchor="middle"
              fontSize={11}
              fill={CLUSTER_COLORS[cluster]}
              style={{ textTransform: "uppercase" }}
            >
              {cluster}
            </text>
          ))}

          {contacts.map((c) => {
            const p = scene.contactPoints.get(c.id);
            if (!p) return null;
            return (
              <line key={`you-${c.id}`} x1={120} y1={centerY} x2={p.x} y2={p.y} stroke={CLUSTER_COLORS[c.cluster]} strokeOpacity={0.25} strokeWidth={1.8 + (c.relationshipScore / 100) * 3} />
            );
          })}

          {model.contactLinks.map((link) => {
            if (!visibleIds.has(link.sourceContactId) || !visibleIds.has(link.targetContactId)) return null;
            const a = scene.contactPoints.get(link.sourceContactId);
            const b = scene.contactPoints.get(link.targetContactId);
            if (!a || !b) return null;
            return (
              <line
                key={`${link.sourceContactId}:${link.targetContactId}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={link.source === "real" ? "#9ca3af" : "#cbd5e1"}
                strokeWidth={1.1}
                strokeDasharray={link.source === "real" ? undefined : "4 4"}
              />
            );
          })}

          {targets.map((t) => {
            const source = scene.contactPoints.get(t.introducedByContactId);
            const target = scene.targetPoints.get(t.id);
            if (!source || !target) return null;
            return (
              <line key={`edge-${t.id}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="#7c3aed" strokeOpacity={0.28} strokeWidth={1 + (t.introScore / 100) * 2} />
            );
          })}

          {contacts.map((c) => {
            const p = scene.contactPoints.get(c.id);
            if (!p) return null;
            const selected = selectedNodeId === c.id;
            const r = 12 + Math.round((c.relationshipScore / 100) * 11);
            return (
              <g key={c.id}>
                {c.recentlyActive && <circle cx={p.x} cy={p.y} r={r + 7} fill={CLUSTER_COLORS[c.cluster]} opacity={0.12} />}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill="#fff"
                  stroke={selected ? "#111827" : CLUSTER_COLORS[c.cluster]}
                  strokeWidth={selected ? 3 : 2}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelectNode(c.id)}
                />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={Math.max(10, r * 0.8)} fontWeight={700} fill="#374151">
                  {c.avatar}
                </text>
                <text x={p.x} y={p.y + r + 14} textAnchor="middle" fontSize={10} fill="#6b7280">
                  {c.name.split(" ")[0]}
                </text>
              </g>
            );
          })}

          {targets.map((t) => {
            const p = scene.targetPoints.get(t.id);
            if (!p) return null;
            const selected = selectedNodeId === t.id;
            return (
              <g key={t.id}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={8 + (t.introScore / 100) * 8}
                  fill="#fff"
                  stroke={selected ? "#111827" : "#7c3aed"}
                  strokeWidth={selected ? 2.8 : 1.8}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelectNode(t.id)}
                />
                <text x={p.x + 14} y={p.y + 4} fontSize={11} fill="#374151">
                  {t.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

