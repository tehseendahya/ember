"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  X,
  Copy,
  Mail,
  Loader2,
  CheckCircle,
  AlertCircle,
  User,
} from "lucide-react";
import type { Contact, IntroDraftTone, IntroRequestWorkflowStep, WorldSearchResult } from "@/lib/types";

function buildIntroDraft({
  introducer,
  target,
  searchQuery,
  tone,
}: {
  introducer: Contact;
  target: WorldSearchResult;
  searchQuery: string;
  tone: IntroDraftTone;
}): string {
  const first = introducer.name.split(/\s+/)[0] ?? introducer.name;
  const targetLine = target.company
    ? `${target.name} (${target.role} @ ${target.company})`
    : `${target.name} — ${target.role}`;
  const pathHint = target.connectionPath ? `\n\n(Context: ${target.connectionPath})` : "";

  if (tone === "short") {
    return `Hi ${first} — would you be comfortable introducing me to ${target.name}? Happy to send a short blurb.${pathHint}`;
  }
  if (tone === "double_opt_in") {
    return `Hi ${first},

I'm trying to connect with ${targetLine}. I found them while searching for "${searchQuery}" — ${target.reason}

If you know them well enough, would you be open to a double opt-in intro? I can draft something short for you to forward.${pathHint}

Thanks!`;
  }
  return `Hi ${first},

I'm trying to connect with ${targetLine}. I found them while searching for "${searchQuery}" — ${target.reason}

Would you be open to making an introduction? I can send a short blurb about what I'm looking for.${pathHint}

Thanks!`;
}

function buildLogPrompt({
  introducer,
  target,
  searchQuery,
}: {
  introducer: Contact;
  target: WorldSearchResult;
  searchQuery: string;
}): string {
  const path = target.connectionPath ? ` Connection path: ${target.connectionPath}.` : "";
  const score =
    target.pathScore != null && target.pathScoreBreakdown
      ? ` Suggested path score: ${target.pathScore}/100 (blend of your tie to ${introducer.name}, edge confidence, search intent match, recency).`
      : "";
  return `I want to ask ${introducer.name} for an introduction to ${target.name}${target.company ? ` at ${target.company}` : ""} (web search: "${searchQuery}").${path}${score} Please record an intro-type interaction for ${introducer.name} and set a follow-up reminder in one week to check whether I got a reply.`;
}

type LogState = "idle" | "loading" | "success" | "error";

export default function IntroRequestModal({
  open,
  onClose,
  result,
  contacts,
  searchQuery,
}: {
  open: boolean;
  onClose: () => void;
  result: WorldSearchResult | null;
  contacts: Contact[];
  searchQuery: string;
}) {
  const [selectedIntroducerId, setSelectedIntroducerId] = useState("");
  const [draft, setDraft] = useState("");
  const [tone, setTone] = useState<IntroDraftTone>("default");
  const [workflowStep, setWorkflowStep] = useState<IntroRequestWorkflowStep>("compose");
  const [copyDone, setCopyDone] = useState(false);
  const [logState, setLogState] = useState<LogState>("idle");
  const [logError, setLogError] = useState<string | null>(null);
  const [logSummary, setLogSummary] = useState<string | null>(null);

  const introducerIds = result?.introducers ?? [];
  const validIntroducerIds = introducerIds.filter((id) => contacts.some((c) => c.id === id));
  const selectedIntroducer = contacts.find((c) => c.id === selectedIntroducerId);

  useEffect(() => {
    if (!open || !result) return;
    const ids = (result.introducers ?? []).filter((id) =>
      contacts.some((c) => c.id === id)
    );
    if (ids.length === 0) return;
    setSelectedIntroducerId(ids[0] ?? "");
    setCopyDone(false);
    setLogState("idle");
    setLogError(null);
    setLogSummary(null);
    setWorkflowStep("compose");
    setTone("default");
  }, [open, result, contacts]);

  useEffect(() => {
    if (!open || !result || !selectedIntroducerId) return;
    const intro = contacts.find((c) => c.id === selectedIntroducerId);
    if (!intro) return;
    setDraft(
      buildIntroDraft({
        introducer: intro,
        target: result,
        searchQuery,
        tone,
      })
    );
  }, [open, result, selectedIntroducerId, searchQuery, contacts, tone]);

  if (!open || !result || validIntroducerIds.length === 0) return null;

  const contactHref =
    selectedIntroducer &&
    `/my-people/${selectedIntroducer.id}?${new URLSearchParams({
      introTarget: result.name,
      introCompany: result.company ?? "",
      introQuery: searchQuery,
    }).toString()}`;

  const mailtoHref =
    selectedIntroducer?.email &&
    `mailto:${encodeURIComponent(selectedIntroducer.email)}?subject=${encodeURIComponent(`Intro to ${result.name}`)}&body=${encodeURIComponent(draft)}`;

  async function handleLogCrm() {
    if (!selectedIntroducer || !result) return;
    setLogState("loading");
    setLogError(null);
    setLogSummary(null);
    try {
      const text = buildLogPrompt({
        introducer: selectedIntroducer,
        target: result,
        searchQuery,
      });
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not process update");
      }
      if (data.error) {
        throw new Error(data.error);
      }
      setLogSummary(typeof data.summary === "string" ? data.summary : "Update processed.");
      setLogState("success");
    } catch (e) {
      setLogState("error");
      setLogError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    } catch {
      setCopyDone(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="intro-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        background: "rgba(15, 23, 42, 0.45)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          maxHeight: "90vh",
          overflow: "auto",
          background: "#ffffff",
          borderRadius: "14px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            padding: "18px 20px",
            borderBottom: "1px solid #f3f4f6",
          }}
        >
          <div>
            <h2
              id="intro-modal-title"
              style={{
                fontSize: "16px",
                fontWeight: "700",
                color: "#111827",
                marginBottom: "4px",
              }}
            >
              Request introduction
            </h2>
            <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
              To <strong style={{ color: "#111827" }}>{result.name}</strong>
              {result.company ? ` @ ${result.company}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              padding: "6px",
              border: "none",
              background: "transparent",
              borderRadius: "8px",
              cursor: "pointer",
              color: "#9ca3af",
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div
            style={{
              display: "flex",
              gap: "6px",
              flexWrap: "wrap",
              padding: "4px 0 2px",
            }}
          >
            {(
              [
                { id: "compose" as const, label: "Compose" },
                { id: "outreach" as const, label: "Outreach" },
                { id: "track" as const, label: "Track" },
              ] as const
            ).map((s) => {
              const active = workflowStep === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setWorkflowStep(s.id)}
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: "600",
                    borderRadius: "20px",
                    border: `1px solid ${active ? "#4f46e5" : "#e5e7eb"}`,
                    background: active ? "rgba(79, 70, 229, 0.08)" : "#fff",
                    color: active ? "#4f46e5" : "#6b7280",
                    cursor: "pointer",
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          <div>
            <label
              htmlFor="intro-introducer"
              style={{ fontSize: "12px", fontWeight: "600", color: "#6b7280", display: "block", marginBottom: "6px" }}
            >
              Ask for intro via
            </label>
            <select
              id="intro-introducer"
              value={selectedIntroducerId}
              onChange={(e) => setSelectedIntroducerId(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "14px",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                background: "#fff",
                color: "#111827",
              }}
            >
              {validIntroducerIds.map((id) => {
                const c = contacts.find((x) => x.id === id)!;
                return (
                  <option key={id} value={id}>
                    {c.name} — {c.role} @ {c.company}
                  </option>
                );
              })}
            </select>
          </div>

          {(workflowStep === "compose" || workflowStep === "outreach") && (
            <div>
              <label
                htmlFor="intro-tone"
                style={{ fontSize: "12px", fontWeight: "600", color: "#6b7280", display: "block", marginBottom: "6px" }}
              >
                Draft tone
              </label>
              <select
                id="intro-tone"
                value={tone}
                onChange={(e) => setTone(e.target.value as IntroDraftTone)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: "13px",
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  color: "#111827",
                  marginBottom: "10px",
                }}
              >
                <option value="default">Standard ask + blurb offer</option>
                <option value="double_opt_in">Double opt-in friendly</option>
                <option value="short">Short / low friction</option>
              </select>
              <label
                htmlFor="intro-draft"
                style={{ fontSize: "12px", fontWeight: "600", color: "#6b7280", display: "block", marginBottom: "6px" }}
              >
                Message draft
              </label>
              <textarea
                id="intro-draft"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "13px",
                  lineHeight: 1.5,
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  resize: "vertical",
                  fontFamily: "inherit",
                  color: "#111827",
                }}
              />
            </div>
          )}

          {result.pathScore != null && result.pathScoreBreakdown && (
            <div
              style={{
                fontSize: "11px",
                color: "#6b7280",
                lineHeight: 1.5,
                padding: "10px 12px",
                background: "#f9fafb",
                borderRadius: "8px",
                border: "1px solid #f3f4f6",
              }}
            >
              Path score <strong style={{ color: "#111827" }}>{result.pathScore}</strong>/100 · components: relationship{" "}
              {Math.round(result.pathScoreBreakdown.connectionStrength * 100)}%, edge{" "}
              {Math.round(result.pathScoreBreakdown.edgeConfidence * 100)}%, intent{" "}
              {Math.round(result.pathScoreBreakdown.intentMatch * 100)}%, recency{" "}
              {Math.round(result.pathScoreBreakdown.recency * 100)}%
            </div>
          )}

          {(workflowStep === "outreach" || workflowStep === "compose") && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button
              type="button"
              onClick={() => void handleCopy()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                background: "#f3f4f6",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: "600",
                color: "#374151",
                cursor: "pointer",
              }}
            >
              <Copy size={14} />
              {copyDone ? "Copied" : "Copy"}
            </button>
            {mailtoHref && (
              <a
                href={mailtoHref}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  background: "#f3f4f6",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#374151",
                  textDecoration: "none",
                }}
              >
                <Mail size={14} />
                Open in email
              </a>
            )}
            {contactHref && selectedIntroducer && (
              <Link
                href={contactHref}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  background: "rgba(79, 70, 229, 0.06)",
                  border: "1px solid rgba(79, 70, 229, 0.2)",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#4f46e5",
                  textDecoration: "none",
                }}
              >
                <User size={14} />
                Open {selectedIntroducer.name.split(/\s+/)[0]}&rsquo;s profile
              </Link>
            )}
          </div>
          )}

          {(workflowStep === "track" || workflowStep === "compose") && (
          <div
            style={{
              padding: "12px",
              background: "#f8f9fa",
              borderRadius: "8px",
              border: "1px solid #f3f4f6",
            }}
          >
            <div style={{ fontSize: "12px", fontWeight: "600", color: "#6b7280", marginBottom: "8px" }}>
              Log with AI assistant (same as Update CRM)
            </div>
            <button
              type="button"
              onClick={() => void handleLogCrm()}
              disabled={logState === "loading"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 16px",
                background: logState === "loading" ? "rgba(79, 70, 229, 0.5)" : "#4f46e5",
                border: "none",
                borderRadius: "8px",
                color: "white",
                fontSize: "13px",
                fontWeight: "600",
                cursor: logState === "loading" ? "wait" : "pointer",
              }}
            >
              {logState === "loading" ? (
                <>
                  <Loader2 size={14} style={{ animation: "spin 0.8s linear infinite" }} />
                  Processing…
                </>
              ) : (
                "Log to CRM"
              )}
            </button>
            {logState === "success" && logSummary && (
              <div
                style={{
                  marginTop: "10px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  fontSize: "13px",
                  color: "#059669",
                }}
              >
                <CheckCircle size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
                <span>{logSummary}</span>
              </div>
            )}
            {logState === "error" && logError && (
              <div
                style={{
                  marginTop: "10px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  fontSize: "13px",
                  color: "#dc2626",
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
                <span>{logError}</span>
              </div>
            )}
          </div>
          )}

          <p style={{ fontSize: "11px", color: "#9ca3af", margin: 0, lineHeight: 1.5 }}>
            Intro paths use your second-degree edges when available; otherwise a weaker heuristic — confirm before
            sending. The CRM update uses your OpenAI key when configured; it does not send messages for you.
          </p>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
