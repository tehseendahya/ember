"use client";

import { useMemo, useState } from "react";
import { Users, TrendingUp, Calendar, GitBranch, Upload, List, Network } from "lucide-react";
import ContactCard from "@/components/ContactCard";
import NetworkGraph from "@/components/NetworkGraph";
import ImportPeopleModal from "@/components/ImportPeopleModal";
import type { Contact } from "@/lib/types";
import type { UnifiedGraphViewModel } from "@/lib/network/graph-view-model";

export default function PeopleClient({
  contacts,
  graphModel,
}: {
  contacts: Contact[];
  graphModel: UnifiedGraphViewModel;
}) {
  const [activeFilter, setActiveFilter] = useState("all");
  const [view, setView] = useState<"list" | "graph">("list");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const avgStrength = (contacts.reduce((sum, c) => sum + c.connectionStrength, 0) / Math.max(1, contacts.length)).toFixed(1);
  const warmContacts = graphModel.contacts.filter((c) => c.relationshipScore >= 70).length;
  const topIntroPaths = graphModel.introQueue.filter((i) => i.introScore >= 60).length;
  const needsReviewCount = contacts.filter((c) => c.needsVerification).length;

  const filterOptions = [
    { label: "All", value: "all" },
    { label: "Investors", value: "investor" },
    { label: "Founders", value: "founder" },
    { label: "Engineers", value: "engineer" },
    { label: "Warm", value: "warm" },
    ...(needsReviewCount > 0
      ? [{ label: `Needs verification (${needsReviewCount})`, value: "needs_verification" }]
      : []),
  ];

  const filteredContacts = useMemo(() => {
    if (activeFilter === "all") return contacts;
    if (activeFilter === "warm") return contacts.filter((c) => c.connectionStrength >= 4);
    if (activeFilter === "needs_verification") return contacts.filter((c) => c.needsVerification);
    return contacts.filter((c) => c.tags.includes(activeFilter));
  }, [activeFilter, contacts]);

  return (
    <div className="page-container" style={{ padding: "32px 40px", maxWidth: "1400px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#111827", marginBottom: "6px" }}>People</h1>
          <p style={{ fontSize: "14px", color: "#9ca3af" }}>
            Everyone you know. Toggle between a browsable list and the relationship graph.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", height: "fit-content", flexWrap: "wrap" }}>
          <div
            role="tablist"
            aria-label="People view"
            style={{
              display: "inline-flex",
              background: "#f3f4f6",
              borderRadius: "10px",
              padding: "3px",
              border: "1px solid #e5e7eb",
            }}
          >
            {([
              { id: "list", label: "List", icon: List },
              { id: "graph", label: "Graph", icon: Network },
            ] as const).map(({ id, label, icon: Icon }) => {
              const isActive = view === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setView(id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    border: "none",
                    background: isActive ? "#ffffff" : "transparent",
                    color: isActive ? "#111827" : "#6b7280",
                    fontWeight: isActive ? 600 : 500,
                    fontSize: "13px",
                    padding: "7px 14px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              padding: "9px 14px",
              color: "#fff",
              background: "#4f46e5",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
            }}
          >
            <Upload size={15} />
            Import CSV
          </button>
        </div>
      </div>

      {importOpen && <ImportPeopleModal open onClose={() => setImportOpen(false)} />}

      <div className="stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(140px, 1fr))", gap: "12px", marginBottom: "18px" }}>
        {[
          { icon: <Users size={16} style={{ color: "#4f46e5" }} />, label: "People", value: contacts.length },
          { icon: <TrendingUp size={16} style={{ color: "#059669" }} />, label: "Avg Strength", value: avgStrength },
          { icon: <Calendar size={16} style={{ color: "#d97706" }} />, label: "Warm Contacts", value: warmContacts },
          { icon: <GitBranch size={16} style={{ color: "#7c3aed" }} />, label: "Strong Intro Paths", value: topIntroPaths },
        ].map((s) => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              {s.icon}
              <span style={{ fontSize: "12px", color: "#9ca3af" }}>{s.label}</span>
            </div>
            <div style={{ fontSize: "22px", fontWeight: 800, color: "#111827" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {view === "graph" && (
        <div style={{ marginBottom: "20px" }}>
          <NetworkGraph
            model={graphModel}
            contacts={contacts}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        </div>
      )}

      {view === "list" && (
        <>
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
            {filterOptions.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setActiveFilter(f.value)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "20px",
                  border: activeFilter === f.value ? "1px solid #4f46e5" : "1px solid #e5e7eb",
                  background: activeFilter === f.value ? "rgba(79,70,229,0.08)" : "#fff",
                  color: activeFilter === f.value ? "#4f46e5" : "#6b7280",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="contacts-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))", gap: "14px" }}>
            {filteredContacts.map((contact) => (
              <ContactCard key={contact.id} contact={contact} />
            ))}
          </div>
        </>
      )}

      <style>{`
        .page-container {
          width: min(100%, 1400px);
          margin: 0 auto;
          box-sizing: border-box;
        }
        @media (max-width: 768px) {
          .page-container { padding: 20px 16px !important; }
          .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .contacts-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
