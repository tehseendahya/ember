"use client";

import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { Contact, ExtendedProfile, NetworkEdge } from "@/lib/types";
import { X, Users, GitBranch, Building2 } from "lucide-react";

// ─── Sector config ───────────────────────────────────────────────────────────
const SECTORS = [
  { id: "finance", label: "Finance & VC", color: "#4f46e5", angle: -55, distance: 210 },
  { id: "tech",    label: "Tech & Product", color: "#059669", angle: 25,  distance: 230 },
  { id: "founders",label: "Founders",       color: "#d97706", angle: 150, distance: 200 },
  { id: "business",label: "Business",       color: "#3b82f6", angle: 225, distance: 190 },
];

const SECTOR_MAP: Record<string, string> = {
  "1": "finance", "5": "finance", "12": "finance",
  "2": "tech",    "4": "tech",    "9": "tech", "13": "tech", "15": "tech", "10": "tech",
  "3": "founders","7": "founders","14": "founders",
  "6": "business","8": "business","11": "business",
};

const STRENGTH_COLORS: Record<number, string> = {
  5: "#4f46e5", 4: "#059669", 3: "#d97706", 2: "#dc2626", 1: "#9ca3af",
};

function edgeColor(label?: string): string {
  if (!label) return "#4b5563";
  const l = label.toLowerCase();
  if (l.includes("introduc")) return "#a78bfa";
  if (l.includes("alumni") || l.includes("colleague")) return "#34d399";
  if (l.includes("finance") || l.includes("portfolio")) return "#fbbf24";
  if (l.includes("tech") || l.includes("dev") || l.includes("product") || l.includes("design") || l.includes("community")) return "#60a5fa";
  return "#6b7280";
}

function hexAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return hex + a.toString(16).padStart(2, "0");
}

interface Node {
  id: string; x: number; y: number; vx: number; vy: number;
  name: string; avatar: string; avatarColor: string;
  connectionStrength: number; role: string; company: string; sector: string;
}

function nodeRadius(strength: number, scale = 1) {
  return (16 + strength * 3.5) * scale;
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function NetworkGraph({
  contacts,
  networkEdges,
  extendedConnections,
}: {
  contacts: Contact[];
  networkEdges: NetworkEdge[];
  extendedConnections: Record<string, ExtendedProfile[]>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const youRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef(0);
  const hovRef = useRef<string | null>(null);
  const selRef = useRef<string | null>(null);
  const filterRef = useRef("all");

  const isRunningRef = useRef(false);
  const simulateRef = useRef<() => void>(() => {});

  const [selectedContact, setSelectedContact] = useState<typeof contacts[0] | null>(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const router = useRouter();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const sel = selRef.current;
    const hov = hovRef.current;
    const filter = filterRef.current;

    // Background
    ctx.fillStyle = "#f8f9fa";
    ctx.fillRect(0, 0, W, H);

    // Subtle dot grid
    ctx.fillStyle = "rgba(0,0,0,0.04)";
    for (let gx = 0; gx < W; gx += 32) for (let gy = 0; gy < H; gy += 32) {
      ctx.beginPath(); ctx.arc(gx, gy, 1, 0, Math.PI * 2); ctx.fill();
    }

    const you = youRef.current;

    // ── Sector halos ──────────────────────────────────────────────────────
    SECTORS.forEach(sector => {
      const members = nodesRef.current.filter(n => n.sector === sector.id);
      if (!members.length) return;
      const cx = members.reduce((s, n) => s + n.x, 0) / members.length;
      const cy = members.reduce((s, n) => s + n.y, 0) / members.length;
      const hr = 75 + members.length * 16;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, hr);
      grd.addColorStop(0, sector.color + "1e");
      grd.addColorStop(0.65, sector.color + "0a");
      grd.addColorStop(1, "transparent");
      ctx.beginPath(); ctx.arc(cx, cy, hr, 0, Math.PI * 2);
      ctx.fillStyle = grd; ctx.fill();
      // sector label
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = sector.color;
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(sector.label.toUpperCase(), cx, cy - hr + 15);
      ctx.globalAlpha = 1;
    });

    // helper: is a node connected to selected?
    const connected = (id: string) => {
      if (!sel) return true;
      if (id === sel) return true;
      return networkEdges.some(e => (e.source === sel && e.target === id) || (e.target === sel && e.source === id));
    };

    // helper: should dim (filter or selection)
    const dimNode = (id: string) => {
      if (filter !== "all" && SECTOR_MAP[id] !== filter) return true;
      if (sel && !connected(id)) return true;
      return false;
    };

    // ── YOU→contact edges ─────────────────────────────────────────────────
    nodesRef.current.forEach(node => {
      const c = contacts.find(x => x.id === node.id);
      if (!c) return;
      const dim = dimNode(node.id);
      const highlight = sel === node.id || hov === node.id;
      const sc = STRENGTH_COLORS[c.connectionStrength] || "#6b7280";
      const lw = dim ? 0.4 : (c.connectionStrength * 0.65 + 0.6);
      const alpha = dim ? 0.06 : (sel && !highlight ? 0.22 : 0.75);

      if (highlight) {
        ctx.beginPath(); ctx.moveTo(you.x, you.y); ctx.lineTo(node.x, node.y);
        ctx.strokeStyle = hexAlpha(sc, 0.35); ctx.lineWidth = lw * 4; ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(you.x, you.y); ctx.lineTo(node.x, node.y);
      ctx.strokeStyle = hexAlpha(sc, alpha); ctx.lineWidth = lw; ctx.stroke();
    });

    // ── contact→contact edges ─────────────────────────────────────────────
    networkEdges.forEach(edge => {
      const src = nodesRef.current.find(n => n.id === edge.source);
      const tgt = nodesRef.current.find(n => n.id === edge.target);
      if (!src || !tgt) return;
      const highlighted = sel && (edge.source === sel || edge.target === sel);
      const dimmed = dimNode(edge.source) || dimNode(edge.target);
      const ec = edgeColor(edge.label);
      const alpha = dimmed ? 0.04 : (highlighted ? 0.9 : 0.3);
      const lw = highlighted ? 2.5 : 1;

      if (highlighted) {
        ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = hexAlpha(ec, 0.28); ctx.lineWidth = lw * 4; ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = hexAlpha(ec, alpha); ctx.lineWidth = lw; ctx.stroke();

      // edge label when highlighted
      if (highlighted && edge.label) {
        const mx = (src.x + tgt.x) / 2;
        const my = (src.y + tgt.y) / 2;
        ctx.fillStyle = hexAlpha(ec, 0.85);
        ctx.font = "10px Inter, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(edge.label, mx, my - 9);
      }
    });

    // ── YOU node ──────────────────────────────────────────────────────────
    const yr = 28;
    const yGrd = ctx.createRadialGradient(you.x, you.y, 0, you.x, you.y, yr * 2.8);
    yGrd.addColorStop(0, "rgba(79,70,229,0.2)");
    yGrd.addColorStop(0.5, "rgba(79,70,229,0.06)");
    yGrd.addColorStop(1, "transparent");
    ctx.beginPath(); ctx.arc(you.x, you.y, yr * 2.8, 0, Math.PI * 2);
    ctx.fillStyle = yGrd; ctx.fill();
    ctx.beginPath(); ctx.arc(you.x, you.y, yr + 3, 0, Math.PI * 2);
    ctx.fillStyle = "#4f46e5"; ctx.fill();
    ctx.beginPath(); ctx.arc(you.x, you.y, yr, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.fillStyle = "#4f46e5";
    ctx.font = "bold 12px Inter, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("YOU", you.x, you.y);

    // ── Contact nodes ─────────────────────────────────────────────────────
    nodesRef.current.forEach(node => {
      const isHov = node.id === hov;
      const isSel = node.id === sel;
      const dim = dimNode(node.id);
      const scale = isHov || isSel ? 1.15 : 1;
      const r = nodeRadius(node.connectionStrength, scale);
      const bc = STRENGTH_COLORS[node.connectionStrength] || "#6b7280";

      ctx.globalAlpha = dim ? 0.18 : 1;

      // glow for selected
      if (isSel) {
        const grd = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r * 3);
        grd.addColorStop(0, hexAlpha(bc, 0.4));
        grd.addColorStop(1, "transparent");
        ctx.beginPath(); ctx.arc(node.x, node.y, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = grd; ctx.fill();
        // outer ring
        ctx.beginPath(); ctx.arc(node.x, node.y, r + 7, 0, Math.PI * 2);
        ctx.strokeStyle = hexAlpha(bc, 0.6); ctx.lineWidth = 1.5; ctx.stroke();
      }

      // border ring
      ctx.beginPath(); ctx.arc(node.x, node.y, r + 2.5, 0, Math.PI * 2);
      ctx.fillStyle = bc; ctx.fill();
      // body
      ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      // tint
      ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = node.avatarColor + "18"; ctx.fill();
      // initials
      ctx.fillStyle = isHov || isSel ? "#111827" : "#374151";
      ctx.font = `bold ${Math.max(9, r * 0.48)}px Inter, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(node.avatar, node.x, node.y);

      ctx.globalAlpha = 1;

      // name label
      const nameAlpha = dim ? 0.15 : (isHov || isSel ? 1 : 0.65);
      ctx.globalAlpha = nameAlpha;
      ctx.fillStyle = isHov || isSel ? "#111827" : "#6b7280";
      ctx.font = `${isSel ? "bold " : ""}10px Inter, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(node.name.split(" ")[0], node.x, node.y + r + 5);
      ctx.globalAlpha = 1;
    });

    // ── Hover tooltip (only when nothing selected) ────────────────────────
    if (hov && !sel) {
      const node = nodesRef.current.find(n => n.id === hov);
      const c = contacts.find(x => x.id === hov);
      if (node && c) {
        const r = nodeRadius(c.connectionStrength);
        const bw = 210, bh = 56;
        let bx = node.x + r + 14;
        let by = node.y - bh / 2;
        if (bx + bw > W - 8) bx = node.x - bw - 14;
        if (by < 8) by = 8;
        if (by + bh > H - 8) by = H - bh - 8;
        rrect(ctx, bx, by, bw, bh, 9);
        ctx.fillStyle = "rgba(255,255,255,0.97)"; ctx.fill();
        ctx.strokeStyle = "rgba(79,70,229,0.3)"; ctx.lineWidth = 1; ctx.stroke();
        ctx.shadowColor = "rgba(0,0,0,0.08)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
        ctx.fillStyle = "rgba(255,255,255,0.97)"; ctx.fill();
        ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.fillStyle = "#111827";
        ctx.font = "bold 12.5px Inter, sans-serif";
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(c.name, bx + 12, by + 10);
        ctx.fillStyle = "#6b7280";
        ctx.font = "11px Inter, sans-serif";
        ctx.fillText(`${c.role} @ ${c.company}`, bx + 12, by + 30);
      }
    }
  }, [contacts, networkEdges]);

  const simulate = useCallback(() => {
    const nodes = nodesRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    const you = youRef.current;

    // repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d > 320) continue;
        const f = 3800 / (d * d);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        nodes[i].vx -= fx; nodes[i].vy -= fy;
        nodes[j].vx += fx; nodes[j].vy += fy;
      }
    }

    // YOU→contact spring
    nodes.forEach(node => {
      const dx = you.x - node.x, dy = you.y - node.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = 175 + (5 - node.connectionStrength) * 25;
      const f = 0.022 * (d - rest);
      node.vx += (dx / d) * f; node.vy += (dy / d) * f;
    });

    // contact→contact spring
    networkEdges.forEach(edge => {
      const s = nodes.find(n => n.id === edge.source);
      const t = nodes.find(n => n.id === edge.target);
      if (!s || !t) return;
      const dx = t.x - s.x, dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = 0.013 * (d - 140);
      s.vx += (dx / d) * f; s.vy += (dy / d) * f;
      t.vx -= (dx / d) * f; t.vy -= (dy / d) * f;
    });

    // sector anchor
    SECTORS.forEach(sector => {
      const ar = (sector.angle * Math.PI) / 180;
      const ax = you.x + Math.cos(ar) * sector.distance;
      const ay = you.y + Math.sin(ar) * sector.distance;
      nodes.filter(n => n.sector === sector.id).forEach(node => {
        node.vx += (ax - node.x) * 0.014;
        node.vy += (ay - node.y) * 0.014;
      });
    });

    nodes.forEach(node => {
      node.vx += (W / 2 - node.x) * 0.004;
      node.vy += (H / 2 - node.y) * 0.004;
      node.vx *= 0.76; node.vy *= 0.76;
      node.x += node.vx; node.y += node.vy;
      const r = nodeRadius(node.connectionStrength) + 12;
      node.x = Math.max(r, Math.min(W - r, node.x));
      node.y = Math.max(r + 16, Math.min(H - r - 16, node.y));
    });

    draw();

    // Stop the loop once nodes have settled to avoid burning CPU indefinitely
    const totalKE = nodes.reduce((sum, n) => sum + n.vx * n.vx + n.vy * n.vy, 0);
    if (totalKE > 0.15) {
      rafRef.current = requestAnimationFrame(() => simulateRef.current());
    } else {
      isRunningRef.current = false;
    }
  }, [draw, networkEdges]);

  useLayoutEffect(() => {
    simulateRef.current = simulate;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement!;

    const resize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      youRef.current = { x: canvas.width / 2, y: canvas.height / 2 };
    };
    resize();

    const W = canvas.width, H = canvas.height;
    nodesRef.current = contacts.map(c => {
      const sector = SECTOR_MAP[c.id] || "tech";
      const s = SECTORS.find(x => x.id === sector)!;
      const ar = (s.angle * Math.PI) / 180;
      return {
        id: c.id, name: c.name, avatar: c.avatar, avatarColor: c.avatarColor,
        connectionStrength: c.connectionStrength, role: c.role, company: c.company, sector,
        x: W / 2 + Math.cos(ar) * (s.distance + (Math.random() - 0.5) * 70),
        y: H / 2 + Math.sin(ar) * (s.distance + (Math.random() - 0.5) * 70),
        vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
      };
    });

    const hitTest = (mx: number, my: number): Node | null => {
      const rect = canvas.getBoundingClientRect();
      const x = (mx - rect.left) * (canvas.width / rect.width);
      const y = (my - rect.top) * (canvas.height / rect.height);
      for (const n of nodesRef.current) {
        const r = nodeRadius(n.connectionStrength) + 8;
        if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
      }
      return null;
    };

    const startSim = () => {
      if (!isRunningRef.current) {
        isRunningRef.current = true;
        rafRef.current = requestAnimationFrame(simulate);
      }
    };

    const onMove = (e: MouseEvent) => {
      const n = hitTest(e.clientX, e.clientY);
      hovRef.current = n ? n.id : null;
      canvas.style.cursor = n ? "pointer" : "default";
      // When sim is idle, redraw directly so hover tooltips still update
      if (!isRunningRef.current) draw();
    };
    const onClick = (e: MouseEvent) => {
      const n = hitTest(e.clientX, e.clientY);
      if (n) {
        selRef.current = n.id;
        setSelectedContact(contacts.find(c => c.id === n.id) || null);
      } else {
        selRef.current = null;
        setSelectedContact(null);
      }
      if (!isRunningRef.current) draw();
    };

    const onResize = () => { resize(); startSim(); };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);
    window.addEventListener("resize", onResize);
    startSim();

    return () => {
      cancelAnimationFrame(rafRef.current);
      isRunningRef.current = false;
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
    };
  }, [simulate, contacts, draw]);

  const directConns = selectedContact
    ? networkEdges
        .filter(e => e.source === selectedContact.id || e.target === selectedContact.id)
        .map(e => {
          const otherId = e.source === selectedContact.id ? e.target : e.source;
          const other = contacts.find(c => c.id === otherId);
          return other ? { contact: other, label: e.label } : null;
        })
        .filter(Boolean)
        .filter((item, idx, arr) =>
          // deduplicate by contact id in case of bidirectional edges
          arr.findIndex(x => x!.contact.id === item!.contact.id) === idx
        ) as { contact: typeof contacts[0]; label?: string }[]
    : [];

  const secondDeg = selectedContact ? (extendedConnections[selectedContact.id] || []) : [];

  const setFilter = (f: string) => {
    filterRef.current = f;
    setActiveFilter(f);
    // Redraw immediately since draw reads from filterRef; sim may already be idle
    draw();
  };

  return (
    <div style={{ display: "flex", width: "100%", height: "700px", background: "#f8f9fa", borderRadius: "16px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
      {/* ── Canvas area ── */}
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

        {/* Filter pills */}
        <div style={{ position: "absolute", top: "14px", left: "14px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {[
            { id: "all", label: "All", color: "#4f46e5" },
            ...SECTORS.map(s => ({ id: s.id, label: s.label, color: s.color })),
          ].map(f => {
            const active = activeFilter === f.id;
            return (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                padding: "5px 11px", borderRadius: "20px", fontSize: "10.5px", fontWeight: "600",
                background: active ? f.color + "15" : "rgba(255,255,255,0.9)",
                border: `1px solid ${active ? f.color + "40" : "#e5e7eb"}`,
                color: active ? f.color : "#9ca3af", cursor: "pointer",
                backdropFilter: "blur(8px)", transition: "all 0.15s",
              }}>
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{
          position: "absolute", bottom: "14px", left: "14px",
          background: "rgba(255,255,255,0.92)", backdropFilter: "blur(10px)",
          border: "1px solid #e5e7eb", borderRadius: "10px",
          padding: "9px 14px", display: "flex", gap: "12px", alignItems: "center",
        }}>
          <span style={{ fontSize: "9.5px", color: "#9ca3af", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.06em" }}>Connection</span>
          {[{ l: "Strong", c: "#4f46e5" }, { l: "Good", c: "#059669" }, { l: "Moderate", c: "#d97706" }, { l: "Weak", c: "#dc2626" }].map(x => (
            <div key={x.l} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: x.c }} />
              <span style={{ fontSize: "10px", color: "#6b7280" }}>{x.l}</span>
            </div>
          ))}
        </div>

        {/* Edge legend */}
        <div style={{
          position: "absolute", bottom: "14px", right: selectedContact ? "14px" : "14px",
          background: "rgba(255,255,255,0.92)", backdropFilter: "blur(10px)",
          border: "1px solid #e5e7eb", borderRadius: "10px",
          padding: "9px 14px", display: "flex", gap: "12px", alignItems: "center",
        }}>
          <span style={{ fontSize: "9.5px", color: "#9ca3af", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.06em" }}>Relationship</span>
          {[
            { l: "Intro'd", c: "#7c3aed" }, { l: "Alumni/Colleagues", c: "#059669" },
            { l: "Finance", c: "#d97706" }, { l: "Tech/Product", c: "#3b82f6" },
          ].map(x => (
            <div key={x.l} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <div style={{ width: "18px", height: "2px", background: x.c, borderRadius: "1px" }} />
              <span style={{ fontSize: "10px", color: "#6b7280" }}>{x.l}</span>
            </div>
          ))}
        </div>

        {!selectedContact && (
          <div style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, 160px)",
            fontSize: "11px", color: "#9ca3af", pointerEvents: "none",
          }}>
            Click any contact to explore their connections
          </div>
        )}
      </div>

      {/* ── Side panel ── */}
      {selectedContact && (
        <div style={{
          width: "270px", flexShrink: 0,
          background: "#ffffff", borderLeft: "1px solid #e5e7eb",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ padding: "18px 18px 14px", borderBottom: "1px solid #f3f4f6" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
              <div style={{
                width: "46px", height: "46px", borderRadius: "50%",
                background: selectedContact.avatarColor + "20",
                border: `2px solid ${STRENGTH_COLORS[selectedContact.connectionStrength]}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "14px", fontWeight: "700", color: "#111827",
              }}>
                {selectedContact.avatar}
              </div>
              <button onClick={() => { selRef.current = null; setSelectedContact(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: "4px" }}>
                <X size={15} />
              </button>
            </div>
            <div style={{ fontSize: "14.5px", fontWeight: "700", color: "#111827", marginBottom: "2px" }}>{selectedContact.name}</div>
            <div style={{ fontSize: "11.5px", color: "#6b7280", marginBottom: "10px" }}>{selectedContact.role} @ {selectedContact.company}</div>
            <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" }}>
              {selectedContact.tags.slice(0, 3).map(tag => (
                <span key={tag} style={{
                  fontSize: "10px", padding: "2px 8px", borderRadius: "4px",
                  background: "rgba(79,70,229,0.06)", color: "#4f46e5",
                  border: "1px solid rgba(79,70,229,0.12)",
                }}>{tag}</span>
              ))}
            </div>
            <button onClick={() => router.push(`/my-people/${selectedContact.id}`)} style={{
              width: "100%", padding: "7px", background: "rgba(79,70,229,0.06)",
              border: "1px solid rgba(79,70,229,0.15)", borderRadius: "7px",
              color: "#4f46e5", fontSize: "11.5px", fontWeight: "600", cursor: "pointer",
            }}>
              View Full Profile \u2192
            </button>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>

            {/* Direct connections in network */}
            <div style={{ marginBottom: "18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                <Users size={11} style={{ color: "#4f46e5" }} />
                <span style={{ fontSize: "10px", fontWeight: "700", color: "#4f46e5", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Shared Network ({directConns.length})
                </span>
              </div>
              {directConns.length === 0 ? (
                <p style={{ fontSize: "11px", color: "#9ca3af" }}>No shared connections</p>
              ) : directConns.map(({ contact: c, label }) => (
                <div key={c.id} onClick={() => { selRef.current = c.id; setSelectedContact(c); }}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "7px 9px", marginBottom: "4px",
                    background: "rgba(79,70,229,0.04)", borderRadius: "7px",
                    border: "1px solid rgba(79,70,229,0.08)", cursor: "pointer",
                  }}>
                  <div style={{
                    width: "26px", height: "26px", borderRadius: "50%",
                    background: c.avatarColor + "20", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "9px", fontWeight: "700", color: "#374151",
                  }}>{c.avatar}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "11.5px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                    <div style={{ fontSize: "9.5px", color: "#9ca3af" }}>{label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* 2nd degree */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                <GitBranch size={11} style={{ color: "#059669" }} />
                <span style={{ fontSize: "10px", fontWeight: "700", color: "#059669", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  2\u00b0 via {selectedContact.name.split(" ")[0]} ({secondDeg.length})
                </span>
              </div>
              {secondDeg.length === 0
                ? <p style={{ fontSize: "11px", color: "#9ca3af" }}>No 2nd degree data</p>
                : secondDeg.map(p => (
                  <div key={p.edgeId ?? `${p.name}-${p.company}`} style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "7px 9px", marginBottom: "4px",
                    background: "rgba(5,150,105,0.04)", borderRadius: "7px",
                    border: "1px solid rgba(5,150,105,0.1)",
                  }}>
                    <div style={{
                      width: "26px", height: "26px", borderRadius: "50%", flexShrink: 0,
                      background: "rgba(5,150,105,0.08)", border: "1px solid rgba(5,150,105,0.15)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "9px", fontWeight: "700", color: "#059669",
                    }}>{p.name.split(" ").map((w: string) => w[0]).join("")}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "11.5px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                      <div style={{ fontSize: "9.5px", color: "#6b7280" }}>{p.role} @ {p.company}</div>
                    </div>
                    <button
                      type="button"
                      disabled
                      title="Intro request actions in this panel are in preview and not yet interactive."
                      style={{
                      padding: "3px 7px", background: "rgba(5,150,105,0.06)",
                      border: "1px solid rgba(5,150,105,0.15)", borderRadius: "5px",
                      color: "#059669", fontSize: "9.5px", fontWeight: "600", cursor: "not-allowed", flexShrink: 0, opacity: 0.8,
                    }}
                    >
                      Intro (Preview)
                    </button>
                  </div>
                ))
              }
            </div>

            {/* Company context */}
            <div style={{ padding: "11px 12px", background: "#f8f9fa", borderRadius: "8px", border: "1px solid #f3f4f6" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "5px" }}>
                <Building2 size={10} style={{ color: "#9ca3af" }} />
                <span style={{ fontSize: "9.5px", color: "#9ca3af", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em" }}>Company</span>
              </div>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "#111827" }}>{selectedContact.company}</div>
              <div style={{ fontSize: "10.5px", color: "#6b7280", marginTop: "3px" }}>
                {contacts.filter(c => c.company === selectedContact.company).length > 1
                  ? `${contacts.filter(c => c.company === selectedContact.company).length} people you know here`
                  : "Only contact at this company"}
              </div>
              <div style={{ fontSize: "10.5px", color: "#6b7280", marginTop: "2px" }}>
                Sector: {SECTORS.find(s => s.id === SECTOR_MAP[selectedContact.id])?.label ?? "\u2014"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
