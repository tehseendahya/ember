"use client";

import Link from "next/link";
import { useState } from "react";
import { Clock, Sparkles, ExternalLink, MessageSquare } from "lucide-react";
import type { MeetingBriefingItem } from "@/lib/briefings/types";

export default function MeetingBriefing({
  meeting,
  onLog,
}: {
  meeting: MeetingBriefingItem;
  onLog: (contactId: string) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [prepLine, setPrepLine] = useState<string | undefined>(meeting.prepLine);
  const [status, setStatus] = useState(meeting.briefingStatus);

  const primaryAttendee = meeting.attendees.find((a) => a.contactId === meeting.primaryContactId)
    ?? meeting.attendees[0];
  const otherCount = Math.max(0, meeting.attendees.length - 1);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/briefings/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: meeting.eventId }),
      });
      if (res.ok) {
        const body = (await res.json()) as { prepLine?: string };
        if (body.prepLine) {
          setPrepLine(body.prepLine);
          setStatus("ready");
        } else {
          setStatus("unavailable");
        }
      } else {
        setStatus("unavailable");
      }
    } catch {
      setStatus("unavailable");
    } finally {
      setGenerating(false);
    }
  }

  const showPostMeetingPrompt = meeting.hasEnded && meeting.primaryContactId;

  return (
    <div
      style={{
        padding: "16px",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", flex: 1, minWidth: "220px" }}>
          {primaryAttendee && (
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                background: `${primaryAttendee.avatarColor ?? "#6b7280"}22`,
                color: primaryAttendee.avatarColor ?? "#6b7280",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "13px",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {primaryAttendee.avatar || primaryAttendee.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
              {meeting.title}
            </div>
            <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              <Clock size={12} />
              {meeting.startLocal}
              {meeting.endLocal ? ` – ${meeting.endLocal}` : ""}
              {primaryAttendee && (
                <>
                  <span style={{ color: "#d1d5db" }}>|</span>
                  <span>
                    {primaryAttendee.name}
                    {primaryAttendee.role ? `, ${primaryAttendee.role}` : ""}
                    {primaryAttendee.company ? ` @ ${primaryAttendee.company}` : ""}
                    {otherCount > 0 ? ` + ${otherCount} more` : ""}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          {meeting.externalUrl && (
            <a
              href={meeting.externalUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "#6b7280",
                padding: "6px 10px",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <ExternalLink size={12} /> Event
            </a>
          )}
          {meeting.primaryContactId && (
            <Link
              href={`/people/${meeting.primaryContactId}`}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "#4f46e5",
                padding: "6px 10px",
                borderRadius: "8px",
                border: "1px solid rgba(79, 70, 229, 0.2)",
                textDecoration: "none",
              }}
            >
              Profile
            </Link>
          )}
        </div>
      </div>

      {(meeting.lastInteractionSummary || meeting.capturedContextSummary) && (
        <div
          style={{
            fontSize: "13px",
            color: "#374151",
            background: "#fafafa",
            borderRadius: "8px",
            padding: "10px 12px",
            lineHeight: 1.5,
          }}
        >
          {meeting.lastInteractionSummary && (
            <div>
              <strong style={{ color: "#111827" }}>Last touch:</strong> {meeting.lastInteractionSummary}
            </div>
          )}
          {meeting.capturedContextSummary && (
            <div style={{ marginTop: meeting.lastInteractionSummary ? "4px" : 0 }}>
              <strong style={{ color: "#111827" }}>Context:</strong> {meeting.capturedContextSummary}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
          padding: "10px 12px",
          background: "linear-gradient(135deg, rgba(124, 58, 237, 0.06) 0%, rgba(79, 70, 229, 0.06) 100%)",
          border: "1px solid rgba(124, 58, 237, 0.15)",
          borderRadius: "8px",
        }}
      >
        <Sparkles size={14} style={{ color: "#7c3aed", marginTop: "2px", flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: "13px", color: "#374151", lineHeight: 1.5 }}>
          {prepLine ? (
            prepLine
          ) : status === "pending" ? (
            <button
              type="button"
              onClick={() => void generate()}
              disabled={generating}
              style={{
                background: "transparent",
                border: "none",
                color: "#7c3aed",
                fontWeight: 600,
                fontSize: "13px",
                padding: 0,
                cursor: generating ? "wait" : "pointer",
              }}
            >
              {generating ? "Generating prep note..." : "Generate prep note"}
            </button>
          ) : (
            <span style={{ color: "#9ca3af" }}>No prep note available for this meeting.</span>
          )}
        </div>
      </div>

      {showPostMeetingPrompt && (
        <button
          type="button"
          onClick={() => meeting.primaryContactId && onLog(meeting.primaryContactId)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            alignSelf: "flex-start",
            fontSize: "12px",
            fontWeight: 600,
            color: "#059669",
            background: "rgba(5, 150, 105, 0.08)",
            border: "1px solid rgba(5, 150, 105, 0.2)",
            borderRadius: "8px",
            padding: "7px 12px",
            cursor: "pointer",
          }}
        >
          <MessageSquare size={12} /> How did it go{primaryAttendee ? ` with ${primaryAttendee.name.split(" ")[0]}` : ""}?
        </button>
      )}
    </div>
  );
}
