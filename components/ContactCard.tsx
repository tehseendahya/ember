"use client";

import Link from "next/link";
import { Mail, Linkedin, Calendar, Zap, AlertTriangle } from "lucide-react";
import type { Contact } from "@/lib/types";

const strengthColors: Record<number, string> = {
  5: "#4f46e5",
  4: "#059669",
  3: "#d97706",
  2: "#dc2626",
  1: "#9ca3af",
};

const typeIcons: Record<string, string> = {
  meeting: "\u{1F91D}",
  email: "\u{1F4E7}",
  zoom: "\u{1F4BB}",
  intro: "\u{1F517}",
  message: "\u{1F4AC}",
  event: "\u{1F3A4}",
};

function getDateColor(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date("2026-03-22");
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 14) return "#059669";
  if (diffDays <= 45) return "#d97706";
  return "#dc2626";
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface ContactCardProps {
  contact: Contact;
}

export default function ContactCard({ contact }: ContactCardProps) {
  const borderColor = strengthColors[contact.connectionStrength] || "#9ca3af";
  const dateColor = getDateColor(contact.lastContact.date);

  return (
    <Link href={`/people/${contact.id}`} style={{ textDecoration: "none" }}>
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: "12px",
          padding: "20px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          position: "relative",
          overflow: "hidden",
          width: "100%",
          boxSizing: "border-box",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          el.style.background = "#f8f9fa";
          el.style.borderColor = borderColor;
          el.style.transform = "translateY(-2px)";
          el.style.boxShadow = `0 8px 24px rgba(0,0,0,0.06), 0 0 0 1px ${borderColor}30`;
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.background = "#ffffff";
          el.style.borderColor = "#e5e7eb";
          el.style.borderLeftColor = borderColor;
          el.style.transform = "translateY(0)";
          el.style.boxShadow = "none";
        }}
      >
        {/* Header: Avatar + Name */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "14px", minWidth: 0 }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              background: contact.avatarColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              fontWeight: "700",
              color: "white",
              flexShrink: 0,
              boxShadow: `0 0 12px ${contact.avatarColor}30`,
            }}
          >
            {contact.avatar}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "15px",
                fontWeight: "600",
                color: "#111827",
                marginBottom: "2px",
                lineHeight: 1.35,
                overflowWrap: "anywhere",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                flexWrap: "wrap",
              }}
            >
              <span>{contact.name}</span>
              {contact.needsVerification ? (
                <span
                  title={contact.verificationReason || "Needs verification"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: "999px",
                    background: "rgba(217, 119, 6, 0.1)",
                    color: "#b45309",
                    border: "1px solid rgba(217, 119, 6, 0.25)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  <AlertTriangle size={10} /> Review
                </span>
              ) : null}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "#6b7280",
                lineHeight: 1.35,
                overflowWrap: "anywhere",
              }}
            >
              {contact.role || (contact.needsVerification ? "Role unknown" : "")}{contact.company ? ` @ ${contact.company}` : ""}
            </div>
          </div>
          {/* Actions */}
          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `mailto:${contact.email}`; }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", display: "flex", alignItems: "center", padding: "4px", borderRadius: "4px", transition: "color 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#4f46e5"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#9ca3af"; }}
            >
              <Mail size={14} />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(contact.linkedIn, "_blank", "noopener,noreferrer"); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", display: "flex", alignItems: "center", padding: "4px", borderRadius: "4px", transition: "color 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#0077b5"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#9ca3af"; }}
            >
              <Linkedin size={14} />
            </button>
          </div>
        </div>

        {/* Last Contact */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginBottom: "12px",
            padding: "8px 10px",
            background: "#f8f9fa",
            borderRadius: "6px",
          }}
        >
          <span style={{ fontSize: "14px" }}>
            {typeIcons[contact.lastContact.type] || "\u{1F4CC}"}
          </span>
          <span
            style={{
              fontSize: "12px",
              color: "#6b7280",
              flex: 1,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflowWrap: "anywhere",
            }}
          >
            {contact.lastContact.description}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: "600",
              color: dateColor,
              flexShrink: 0,
            }}
          >
            {formatDate(contact.lastContact.date)}
          </span>
        </div>

        {/* Tags */}
        {contact.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "12px" }}>
            {contact.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: "11px",
                  fontWeight: "500",
                  padding: "2px 8px",
                  borderRadius: "20px",
                  background: "rgba(79, 70, 229, 0.06)",
                  color: "#4f46e5",
                  border: "1px solid rgba(79, 70, 229, 0.12)",
                }}
              >
                {tag}
              </span>
            ))}
            {contact.tags.length > 3 && (
              <span
                style={{
                  fontSize: "11px",
                  color: "#9ca3af",
                  padding: "2px 4px",
                }}
              >
                +{contact.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Connection Strength */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Zap size={12} style={{ color: borderColor }} />
            <span style={{ fontSize: "11px", color: "#9ca3af" }}>Strength</span>
            <div style={{ display: "flex", gap: "3px" }}>
              {[1, 2, 3, 4, 5].map((dot) => (
                <div
                  key={dot}
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background:
                      dot <= contact.connectionStrength
                        ? borderColor
                        : "#e5e7eb",
                  }}
                />
              ))}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              color: "#9ca3af",
            }}
          >
            <Calendar size={11} />
            {contact.interactions.length} interactions
          </div>
        </div>
      </div>
    </Link>
  );
}
