"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Plus, Network, Users, TrendingUp, Calendar, AlertCircle } from "lucide-react";
import ContactCard from "@/components/ContactCard";
import type { Contact, ExtendedProfile, NetworkEdge } from "@/lib/types";

const NetworkGraph = dynamic(() => import("@/components/NetworkGraph"), { ssr: false });

export default function MyPeopleClient({
  contacts,
  networkEdges,
  extendedConnections,
}: {
  contacts: Contact[];
  networkEdges: NetworkEdge[];
  extendedConnections: Record<string, ExtendedProfile[]>;
}) {
  const filterOptions = [
    { label: "All", value: "all" },
    { label: "Investors", value: "investor" },
    { label: "Founders", value: "founder" },
    { label: "Engineers", value: "engineer" },
    { label: "Warm", value: "warm" },
    { label: "Need Follow-up", value: "follow-up" },
  ];

  function getFollowUpStatus(dateStr: string): boolean {
    const date = new Date(dateStr + "T12:00:00");
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays > 45;
  }

  const [activeFilter, setActiveFilter] = useState("all");
  const [showGraph, setShowGraph] = useState(false);

  const avgStrength = (
    contacts.reduce((sum, c) => sum + c.connectionStrength, 0) / contacts.length
  ).toFixed(1);

  const meetingsThisMonth = contacts.filter((c) => {
    const date = new Date(c.lastContact.date + "T12:00:00");
    const now = new Date();
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      (c.lastContact.type === "meeting" || c.lastContact.type === "zoom")
    );
  }).length;

  const followUpsDue = contacts.filter((c) =>
    getFollowUpStatus(c.lastContact.date)
  ).length;

  const filteredContacts = useMemo(() => {
    if (activeFilter === "all") return contacts;
    if (activeFilter === "follow-up") {
      return contacts.filter((c) => getFollowUpStatus(c.lastContact.date));
    }
    return contacts.filter((c) => c.tags.includes(activeFilter));
  }, [activeFilter, contacts]);

  return (
    <div className="page-container" style={{ padding: "32px 40px", maxWidth: "1400px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "32px",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: "800",
              color: "#111827",
              letterSpacing: "-0.5px",
              marginBottom: "4px",
            }}
          >
            My People
          </h1>
          <p style={{ fontSize: "14px", color: "#9ca3af" }}>
            {contacts.length} contacts in your network
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button
            onClick={() => setShowGraph(!showGraph)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 16px",
              background: showGraph ? "rgba(79, 70, 229, 0.08)" : "transparent",
              border: `1px solid ${showGraph ? "#4f46e5" : "#e5e7eb"}`,
              borderRadius: "8px",
              color: showGraph ? "#4f46e5" : "#6b7280",
              fontSize: "14px",
              fontWeight: "500",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (!showGraph) {
                e.currentTarget.style.borderColor = "#4f46e5";
                e.currentTarget.style.color = "#4f46e5";
              }
            }}
            onMouseLeave={(e) => {
              if (!showGraph) {
                e.currentTarget.style.borderColor = "#e5e7eb";
                e.currentTarget.style.color = "#6b7280";
              }
            }}
          >
            <Network size={16} />
            Visualize Network
          </button>
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 16px",
              background: "#4f46e5",
              border: "none",
              borderRadius: "8px",
              color: "white",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#4338ca";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#4f46e5";
            }}
          >
            <Plus size={16} />
            Add Contact
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div
        className="stats-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "16px",
          marginBottom: "28px",
        }}
      >
        {[
          {
            icon: <Users size={18} style={{ color: "#4f46e5" }} />,
            label: "Total Contacts",
            value: contacts.length,
            sub: "in your network",
            color: "#4f46e5",
          },
          {
            icon: <TrendingUp size={18} style={{ color: "#059669" }} />,
            label: "Avg Relationship",
            value: avgStrength,
            sub: "strength score",
            color: "#059669",
          },
          {
            icon: <Calendar size={18} style={{ color: "#d97706" }} />,
            label: "Meetings This Month",
            value: meetingsThisMonth,
            sub: "calls & meetings",
            color: "#d97706",
          },
          {
            icon: <AlertCircle size={18} style={{ color: "#dc2626" }} />,
            label: "Follow-ups Due",
            value: followUpsDue,
            sub: "need attention",
            color: "#dc2626",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "12px",
              padding: "18px 20px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
            }}
          >
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                background: `${stat.color}0d`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {stat.icon}
            </div>
            <div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "700",
                  color: "#111827",
                  lineHeight: 1,
                  marginBottom: "4px",
                }}
              >
                {stat.value}
              </div>
              <div style={{ fontSize: "12px", color: "#9ca3af" }}>{stat.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Network Graph */}
      {showGraph && (
        <div style={{ marginBottom: "32px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "12px",
            }}
          >
            <Network size={16} style={{ color: "#4f46e5" }} />
            <span style={{ fontSize: "14px", fontWeight: "600", color: "#111827" }}>
              Network Visualization
            </span>
            <span style={{ fontSize: "12px", color: "#9ca3af" }}>
              — Click a node to view profile
            </span>
          </div>
          <NetworkGraph
            contacts={contacts}
            networkEdges={networkEdges}
            extendedConnections={extendedConnections}
          />
        </div>
      )}

      {/* Filter Pills */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px", flexWrap: "wrap" }}>
        {filterOptions.map((filter) => {
          const isActive = activeFilter === filter.value;
          return (
            <button
              key={filter.value}
              onClick={() => setActiveFilter(filter.value)}
              style={{
                padding: "6px 14px",
                borderRadius: "20px",
                border: `1px solid ${isActive ? "#4f46e5" : "#e5e7eb"}`,
                background: isActive ? "rgba(79, 70, 229, 0.06)" : "transparent",
                color: isActive ? "#4f46e5" : "#9ca3af",
                fontSize: "13px",
                fontWeight: isActive ? "600" : "400",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = "#4f46e5";
                  e.currentTarget.style.color = "#4f46e5";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = "#e5e7eb";
                  e.currentTarget.style.color = "#9ca3af";
                }
              }}
            >
              {filter.label}
              {filter.value !== "all" && (
                <span
                  style={{
                    marginLeft: "6px",
                    fontSize: "11px",
                    color: isActive ? "#4f46e5" : "#d1d5db",
                  }}
                >
                  {filter.value === "follow-up"
                    ? followUpsDue
                    : contacts.filter((c) => c.tags.includes(filter.value)).length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Contacts Grid */}
      {filteredContacts.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "#9ca3af",
          }}
        >
          <Users size={40} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
          <p style={{ fontSize: "16px", fontWeight: "500" }}>No contacts found</p>
          <p style={{ fontSize: "14px", marginTop: "4px" }}>
            Try a different filter
          </p>
        </div>
      ) : (
        <div
          className="contacts-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "16px",
          }}
        >
          {filteredContacts.map((contact) => (
            <ContactCard key={contact.id} contact={contact} />
          ))}
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .page-container { padding: 20px 16px !important; }
          .stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .contacts-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 480px) {
          .stats-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
