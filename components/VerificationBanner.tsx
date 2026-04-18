"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, Trash2, X } from "lucide-react";
import type { Contact, VerificationCandidate } from "@/lib/types";

type Props = {
  contact: Contact;
};

function EvidenceLine({ contact }: { contact: Contact }) {
  const ev = contact.identityEvidence ?? {};
  const bits: string[] = [];
  if (ev.googleContactsName) {
    const label =
      ev.googleContactsSource === "savedContact"
        ? "your saved Google Contact"
        : "your Google other-contacts";
    bits.push(`${label} "${ev.googleContactsName}"`);
  }
  if (ev.displayName) bits.push(`display name "${ev.displayName}"`);
  if (ev.email) bits.push(`email ${ev.email}`);
  if (ev.workDomainCompany) bits.push(`work domain → ${ev.workDomainCompany}`);
  if (ev.titleHintName) bits.push(`event title hint "${ev.titleHintName}"`);
  if (ev.eventSummary) bits.push(`meeting: "${ev.eventSummary}"`);
  if (bits.length === 0) return null;
  return (
    <div style={{ fontSize: "12px", color: "#6b7280", lineHeight: 1.6 }}>
      Signals used: {bits.join(" · ")}
    </div>
  );
}

function CandidateCard({
  candidate,
  onPick,
  disabled,
}: {
  candidate: VerificationCandidate;
  onPick: () => void;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "10px",
        padding: "12px 14px",
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827", marginBottom: "3px" }}>
            {candidate.name || "(unnamed)"}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "#6b7280",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              lineHeight: 1.45,
            }}
          >
            {candidate.title || candidate.snippet || "No snippet"}
          </div>
        </div>
        {candidate.workDomainMatch ? (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              padding: "2px 7px",
              borderRadius: "999px",
              background: "rgba(5, 150, 105, 0.08)",
              color: "#059669",
              border: "1px solid rgba(5, 150, 105, 0.2)",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            Domain match
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        {candidate.linkedin ? (
          <a
            href={candidate.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "12px",
              color: "#0077b5",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              textDecoration: "none",
            }}
          >
            Open LinkedIn <ExternalLink size={11} />
          </a>
        ) : null}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          style={{
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 600,
            borderRadius: "999px",
            border: "1px solid #4f46e5",
            background: disabled ? "#e0e7ff" : "#4f46e5",
            color: "#ffffff",
            cursor: disabled ? "wait" : "pointer",
          }}
        >
          This is them
        </button>
      </div>
    </div>
  );
}

export default function VerificationBanner({ contact }: Props) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newNameDraft, setNewNameDraft] = useState("");
  const [contextDraft, setContextDraft] = useState("");
  const [clarifyMode, setClarifyMode] = useState(false);

  if (!contact.needsVerification) return null;

  const candidates = contact.verificationCandidates ?? [];
  const trimmedName = newNameDraft.trim();
  const trimmedContext = contextDraft.trim();
  const canSubmitClarify = Boolean(trimmedName || trimmedContext);

  async function call(body: unknown, label: string) {
    setPendingAction(label);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contact.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; deleted?: boolean };
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "Could not complete action");
        return;
      }
      if (data.deleted) {
        router.push("/people");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div
      style={{
        border: "1px solid rgba(217, 119, 6, 0.25)",
        background:
          "linear-gradient(165deg, rgba(253, 230, 138, 0.18) 0%, rgba(255, 251, 235, 0.95) 55%, #ffffff 100%)",
        borderRadius: "14px",
        padding: "16px 18px",
        marginBottom: "20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <AlertTriangle size={18} style={{ color: "#d97706", flexShrink: 0, marginTop: "2px" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#92400e", marginBottom: "4px" }}>
            Needs verification
          </div>
          <div style={{ fontSize: "13px", color: "#78350f", lineHeight: 1.5, marginBottom: "8px" }}>
            We weren&apos;t confident about this person&apos;s identity when we synced the calendar event.
            {contact.verificationReason ? ` Reason: ${contact.verificationReason}.` : ""}
          </div>
          <EvidenceLine contact={contact} />
        </div>
      </div>

      {candidates.length > 0 && (
        <div style={{ marginTop: "14px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "8px",
            }}
          >
            Candidate LinkedIn profiles
          </div>
          <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "1fr" }}>
            {candidates.map((c, idx) => (
              <CandidateCard
                key={`${c.linkedin}-${idx}`}
                candidate={c}
                disabled={pendingAction !== null}
                onPick={() => void call({ action: "apply_candidate", candidateIndex: idx }, `candidate-${idx}`)}
              />
            ))}
          </div>
        </div>
      )}

      {clarifyMode ? (
        <div
          style={{
            marginTop: "14px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            padding: "12px 14px",
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "10px",
          }}
        >
          <div style={{ fontSize: "12px", color: "#374151", lineHeight: 1.5 }}>
            Tell us who they really are. You can correct the name, add a
            one-line clarification (e.g. <em>&ldquo;founder of Majente&rdquo;</em>,
            <em> &ldquo;MBA at Duke Fuqua&rdquo;</em>), or both. We&apos;ll re-search and use
            your clarification as authoritative disambiguation context.
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Full name (optional)
            </span>
            <input
              autoFocus
              value={newNameDraft}
              onChange={(e) => setNewNameDraft(e.target.value)}
              placeholder={contact.name || "e.g. Ryan Johnson"}
              style={{
                padding: "8px 10px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                fontSize: "13px",
                outline: "none",
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Clarification (optional)
            </span>
            <textarea
              value={contextDraft}
              onChange={(e) => setContextDraft(e.target.value)}
              rows={2}
              placeholder='e.g. "founder of Majente, ex-Stripe" or "Karan Gupta, MBA at Duke Fuqua"'
              style={{
                padding: "8px 10px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                fontSize: "13px",
                outline: "none",
                resize: "vertical",
                lineHeight: 1.45,
                fontFamily: "inherit",
              }}
            />
          </label>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={!canSubmitClarify || pendingAction !== null}
              onClick={() =>
                void call(
                  {
                    action: "rename_and_reenrich",
                    name: trimmedName || undefined,
                    context: trimmedContext || undefined,
                  },
                  "clarify",
                )
              }
              style={{
                padding: "8px 14px",
                fontSize: "12px",
                fontWeight: 600,
                background: canSubmitClarify ? "#4f46e5" : "#e0e7ff",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                cursor: canSubmitClarify && pendingAction === null ? "pointer" : "default",
              }}
            >
              {pendingAction === "clarify" ? "Re-enriching…" : "Re-enrich with this info"}
            </button>
            <button
              type="button"
              onClick={() => {
                setClarifyMode(false);
                setNewNameDraft("");
                setContextDraft("");
              }}
              style={{
                padding: "8px 10px",
                fontSize: "12px",
                color: "#6b7280",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: "14px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setClarifyMode(true)}
            disabled={pendingAction !== null}
            style={{
              padding: "8px 12px",
              fontSize: "12px",
              fontWeight: 600,
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              background: "#ffffff",
              color: "#111827",
              cursor: "pointer",
            }}
          >
            Tell us who they are (name &amp; context)
          </button>
          <button
            type="button"
            onClick={() => void call({ action: "confirm" }, "confirm")}
            disabled={pendingAction !== null}
            style={{
              padding: "8px 12px",
              fontSize: "12px",
              fontWeight: 600,
              borderRadius: "8px",
              border: "1px solid rgba(5, 150, 105, 0.3)",
              background: "rgba(5, 150, 105, 0.08)",
              color: "#059669",
              cursor: pendingAction !== null ? "wait" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <CheckCircle2 size={13} />
            Current profile is correct
          </button>
          <button
            type="button"
            onClick={() => void call({ action: "dismiss" }, "dismiss")}
            disabled={pendingAction !== null}
            style={{
              padding: "8px 12px",
              fontSize: "12px",
              fontWeight: 600,
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              background: "#ffffff",
              color: "#6b7280",
              cursor: pendingAction !== null ? "wait" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <X size={13} />
            Dismiss flag
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm("Delete this contact? This cannot be undone.")) {
                void call({ action: "delete" }, "delete");
              }
            }}
            disabled={pendingAction !== null}
            style={{
              padding: "8px 12px",
              fontSize: "12px",
              fontWeight: 600,
              borderRadius: "8px",
              border: "1px solid rgba(220, 38, 38, 0.3)",
              background: "rgba(220, 38, 38, 0.06)",
              color: "#dc2626",
              cursor: pendingAction !== null ? "wait" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Trash2 size={13} />
            Not a real contact — delete
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: "10px", fontSize: "12px", color: "#dc2626" }}>
          {error}
        </div>
      )}
    </div>
  );
}
