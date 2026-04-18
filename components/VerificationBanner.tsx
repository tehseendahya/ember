"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Contact } from "@/lib/types";

type Props = {
  contact: Contact;
};

export default function VerificationBanner({ contact }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (!contact.needsVerification) return null;

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0;

  async function call(body: unknown, label: string) {
    setPending(label);
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
      setDraft("");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(null);
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: "7px 10px",
    border: "1px solid #e5e7eb",
    borderRadius: "7px",
    fontSize: "13px",
    background: "#ffffff",
    outline: "none",
    color: "#111827",
  };

  const textBtn: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 500,
    background: "transparent",
    border: "none",
    cursor: pending !== null ? "wait" : "pointer",
    borderRadius: "6px",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "10px 12px",
        marginBottom: "16px",
        background: "#fafafa",
        border: "1px solid #eeeeee",
        borderRadius: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: "12px", color: "#6b7280", flexShrink: 0 }}>
          Needs review
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Who is this? Name and any clues (title, company, how you know them)"
          disabled={pending !== null}
          style={inputStyle}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSave && pending === null) {
              void call({ action: "rename_and_reenrich", prompt: trimmed }, "save");
            }
          }}
        />
        <button
          type="button"
          disabled={!canSave || pending !== null}
          onClick={() => {
            void call({ action: "rename_and_reenrich", prompt: trimmed }, "save");
          }}
          style={{
            ...textBtn,
            color: canSave ? "#4f46e5" : "#9ca3af",
            fontWeight: 600,
            cursor: canSave && pending === null ? "pointer" : "default",
          }}
        >
          {pending === "save" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => void call({ action: "dismiss" }, "dismiss")}
          disabled={pending !== null}
          style={{ ...textBtn, color: "#6b7280" }}
        >
          {pending === "dismiss" ? "…" : "Dismiss"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm("Delete this contact? This cannot be undone.")) {
              void call({ action: "delete" }, "delete");
            }
          }}
          disabled={pending !== null}
          style={{ ...textBtn, color: "#b91c1c" }}
        >
          {pending === "delete" ? "…" : "Delete"}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: "12px", color: "#dc2626" }}>{error}</div>
      )}
    </div>
  );
}
