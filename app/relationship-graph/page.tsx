"use client";

import { useMemo, useState } from "react";
import { Calendar, GitBranch, Shield, Sparkles, UserRoundCheck, Users } from "lucide-react";

type WarmConnection = {
  id: string;
  name: string;
  role: string;
  company: string;
  lastTouchpoint: string;
  touchpoints90d: number;
  oneOnOneRatio: number;
  warmthScore: number;
  topContacts: string[];
};

const warmConnections: WarmConnection[] = [
  {
    id: "justin",
    name: "Justin Smith",
    role: "Partner",
    company: "Andreessen Horowitz",
    lastTouchpoint: "4 days ago",
    touchpoints90d: 7,
    oneOnOneRatio: 0.71,
    warmthScore: 90,
    topContacts: ["Nina Sharma", "David Park", "Maya Patel"],
  },
  {
    id: "sarah",
    name: "Sarah Chen",
    role: "Product Manager",
    company: "Google",
    lastTouchpoint: "9 days ago",
    touchpoints90d: 5,
    oneOnOneRatio: 0.6,
    warmthScore: 81,
    topContacts: ["Emily Rodriguez", "Alex Johnson", "Ben Taylor"],
  },
  {
    id: "ben",
    name: "Ben Taylor",
    role: "Chief Product Officer",
    company: "Notion",
    lastTouchpoint: "15 days ago",
    touchpoints90d: 4,
    oneOnOneRatio: 0.5,
    warmthScore: 73,
    topContacts: ["Rachel Kim", "Sarah Chen", "Jon Lee"],
  },
  {
    id: "lisa",
    name: "Lisa Wang",
    role: "CMO",
    company: "Stripe",
    lastTouchpoint: "28 days ago",
    touchpoints90d: 3,
    oneOnOneRatio: 0.4,
    warmthScore: 64,
    topContacts: ["Tom Wilson", "Justin Smith", "Kate Yu"],
  },
];

const warmIntroTargets = [
  {
    target: "Nina Sharma",
    company: "Sequoia Capital",
    bestPath: "You -> Justin Smith -> Nina Sharma",
    introScore: 86,
    rationale: "Strong recency with Justin + repeated direct interactions between Justin and Nina.",
  },
  {
    target: "Emily Rodriguez",
    company: "OpenAI",
    bestPath: "You -> Sarah Chen -> Emily Rodriguez",
    introScore: 78,
    rationale: "Sarah is warm and has frequent small-group/1:1 collaboration with Emily.",
  },
  {
    target: "Tom Wilson",
    company: "CloudCo",
    bestPath: "You -> Lisa Wang -> Tom Wilson",
    introScore: 69,
    rationale: "Lisa introduced Tom recently but edge confidence is moderate.",
  },
];

function scoreColor(score: number): string {
  if (score >= 80) return "#059669";
  if (score >= 60) return "#d97706";
  return "#6b7280";
}

export default function RelationshipGraphPage() {
  const [selectedConnectionId, setSelectedConnectionId] = useState(warmConnections[0]?.id ?? "");

  const selectedConnection = useMemo(
    () => warmConnections.find((person) => person.id === selectedConnectionId) ?? warmConnections[0],
    [selectedConnectionId]
  );

  return (
    <div className="relationship-graph-container" style={{ padding: "32px 40px", maxWidth: "1200px" }}>
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#111827", marginBottom: "6px", letterSpacing: "-0.5px" }}>
          Relationship Graph (Preview)
        </h1>
        <p style={{ fontSize: "14px", color: "#6b7280", maxWidth: "840px", lineHeight: 1.5 }}>
          Calendar-derived touchpoints estimate warmth across your network and rank second-degree introduction paths.
          Preview metrics are shown with representative data while calendar integrations and ranking models continue to roll out.
        </p>
      </div>

      <div
        className="overview-grid"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "14px", marginBottom: "24px" }}
      >
        {[
          { icon: <Calendar size={16} />, label: "Calendar Sources", value: "2", sub: "Google + Outlook" },
          { icon: <UserRoundCheck size={16} />, label: "Warm Contacts", value: "12", sub: "score >= 60" },
          { icon: <GitBranch size={16} />, label: "Intro Paths", value: "34", sub: "2nd degree candidates" },
          { icon: <Shield size={16} />, label: "Private Events", value: "Excluded", sub: "default setting" },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "12px",
              padding: "16px",
              display: "flex",
              gap: "10px",
              alignItems: "center",
            }}
          >
            <div style={{ width: "34px", height: "34px", borderRadius: "9px", background: "#eef2ff", color: "#4f46e5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {stat.icon}
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "#6b7280" }}>{stat.label}</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#111827", lineHeight: 1.1 }}>{stat.value}</div>
              <div style={{ fontSize: "11px", color: "#9ca3af" }}>{stat.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="content-grid" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "20px" }}>
        <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#111827" }}>Warmth From Calendar Touchpoints</h2>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>Score = recency + frequency + intimacy + consistency</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {warmConnections.map((person) => {
                const selected = person.id === selectedConnection?.id;
                return (
                  <button
                    key={person.id}
                    onClick={() => setSelectedConnectionId(person.id)}
                    style={{
                      textAlign: "left",
                      width: "100%",
                      border: `1px solid ${selected ? "#4f46e5" : "#e5e7eb"}`,
                      borderRadius: "10px",
                      background: selected ? "#eef2ff" : "#ffffff",
                      padding: "12px",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: "8px",
                      cursor: "pointer",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>
                        {person.name} · {person.role} @ {person.company}
                      </div>
                      <div style={{ marginTop: "3px", fontSize: "12px", color: "#6b7280" }}>
                        {person.touchpoints90d} touchpoints in 90d · {Math.round(person.oneOnOneRatio * 100)}% 1:1 · last contact {person.lastTouchpoint}
                      </div>
                    </div>
                    <div style={{ fontSize: "26px", fontWeight: 800, color: scoreColor(person.warmthScore), alignSelf: "center" }}>
                      {person.warmthScore}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "18px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#111827", marginBottom: "12px" }}>Second-Degree Intro Opportunities</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {warmIntroTargets.map((path) => (
                <div key={path.target} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>
                      {path.target} · {path.company}
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: scoreColor(path.introScore) }}>
                      Intro score {path.introScore}
                    </div>
                  </div>
                  <div style={{ marginTop: "5px", fontSize: "12px", color: "#4f46e5" }}>{path.bestPath}</div>
                  <div style={{ marginTop: "4px", fontSize: "12px", color: "#6b7280" }}>{path.rationale}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <Users size={14} style={{ color: "#4f46e5" }} />
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>Selected Connector</div>
            </div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827" }}>{selectedConnection?.name}</div>
            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "8px" }}>
              {selectedConnection?.role} @ {selectedConnection?.company}
            </div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>
              Most frequent co-attendees:
              <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                {selectedConnection?.topContacts.map((c) => (
                  <li key={c} style={{ marginBottom: "2px" }}>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <Sparkles size={14} style={{ color: "#4f46e5" }} />
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>Preview Notes</div>
            </div>
            <ul style={{ margin: "0 0 0 18px", padding: 0, fontSize: "12px", color: "#6b7280", lineHeight: 1.5 }}>
              <li>Calendar metadata only (no descriptions) powers scoring.</li>
              <li>Recurring 1:1 meetings are weighted higher than large meetings.</li>
              <li>Second-degree edges come from repeated co-attendance patterns.</li>
              <li>Names and suggested paths are representative examples for this preview.</li>
            </ul>
          </div>
        </aside>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .relationship-graph-container { padding: 20px 16px !important; }
          .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .content-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 520px) {
          .overview-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

