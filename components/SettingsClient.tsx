"use client";

import { useMemo, useState } from "react";

const PROFILE_EXTRACTION_PROMPT = `Help me create a complete "personal networking profile" for my CRM assistant.

Output JSON with these fields:
- professional_summary
- current_focus
- industries_of_interest (array)
- ideal_people_to_meet (array)
- priority_companies (array)
- target_roles (array)
- goals_next_6_months (array)
- strengths_i_offer (array)
- topics_i_like_to_discuss (array)
- do_not_target (array)
- recent_wins (array)
- geography_preferences (array)
- notes

Use only information from our chat. If anything is unknown, use an empty value.`;

export default function SettingsClient({ initialProfileContext }: { initialProfileContext: string }) {
  const [profileContext, setProfileContext] = useState(initialProfileContext);
  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const characters = useMemo(() => profileContext.length, [profileContext]);

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch("/api/settings/profile-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileContext }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus(body.error || "Unable to save context.");
        return;
      }
      setStatus("Saved. Today recommendations will use this context.");
    } finally {
      setSaving(false);
    }
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(PROFILE_EXTRACTION_PROMPT);
    setStatus("Prompt copied. Paste it into chat, then paste the output here.");
  }

  return (
    <div style={{ padding: "32px 40px", maxWidth: "960px" }}>
      <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#111827", letterSpacing: "-0.5px", marginBottom: "8px" }}>
        Settings
      </h1>
      <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "20px" }}>
        Add your personal context so Ember can tailor reach-out suggestions, Discover search (your network and the web),
        quick capture parsing, verification flows, and calendar-based contact enrichment — people you meet often fit the
        same professional mold as you.
      </p>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "16px", marginBottom: "16px", background: "#fff" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#111827", marginBottom: "8px" }}>Profile Context Source</h2>
        <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "12px" }}>
          Quick workflow: copy this prompt, run it in chat, then paste the JSON output below.
        </p>
        <button
          type="button"
          onClick={() => { void copyPrompt(); }}
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "#fff",
            background: "#4f46e5",
            border: "none",
            borderRadius: "8px",
            padding: "8px 12px",
            cursor: "pointer",
          }}
        >
          Copy profile extraction prompt
        </button>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "16px", background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#111827" }}>Your Profile Context</h2>
          <span style={{ fontSize: "12px", color: "#9ca3af" }}>{characters} chars</span>
        </div>
        <textarea
          value={profileContext}
          onChange={(e) => setProfileContext(e.target.value)}
          placeholder="Paste your profile JSON or context notes here."
          style={{
            width: "100%",
            minHeight: "260px",
            border: "1px solid #d1d5db",
            borderRadius: "10px",
            padding: "12px",
            fontSize: "13px",
            color: "#111827",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            resize: "vertical",
            marginBottom: "12px",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => { void save(); }}
            disabled={saving}
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "#fff",
              background: saving ? "#9ca3af" : "#059669",
              border: "none",
              borderRadius: "8px",
              padding: "8px 14px",
              cursor: saving ? "wait" : "pointer",
            }}
          >
            Save context
          </button>
          {status && <span style={{ fontSize: "12px", color: "#6b7280" }}>{status}</span>}
        </div>
      </section>
    </div>
  );
}
