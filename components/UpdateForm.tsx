"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { Send, Sparkles, CheckCircle, Loader, AlertCircle, Save } from "lucide-react";

const examplePrompts = [
  "I just had coffee with Sarah Chen and she mentioned a new role opening at Google",
  "Met Alex at a conference, works at Vercel, super smart engineer",
  "Remind me to follow up with Justin next week about the funding intro",
  "Had a great dinner with David Park in SF, talked about M&A landscape",
  "Emily Rodriguez shared her new alignment paper, really impressive work",
];

const interactionTypes = ["meeting", "email", "zoom", "intro", "message", "event"] as const;

interface GPTResult {
  matched_contact?: { id: string; name: string } | null;
  new_contact?: { name: string; company: string; role: string } | null;
  interaction?: { type: string; title: string; notes: string } | null;
  reminder?: { date: string; text: string } | null;
  tags?: string[];
  summary?: string;
  error?: string;
}

type Draft = Omit<GPTResult, "error">;

function ResultRow({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", background: "#f8f9fa", borderRadius: "8px" }}>
      <CheckCircle size={14} style={{ color, flexShrink: 0 }} />
      <span style={{ fontSize: "13px", color }}>{label}</span>
    </div>
  );
}

export default function UpdateForm() {
  const router = useRouter();
  const [inputText, setInputText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [gptResult, setGptResult] = useState<GPTResult | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tagsInput, setTagsInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!inputText.trim()) return;
    setIsProcessing(true);
    setGptResult(null);
    setDraft(null);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
      });
      const data: GPTResult = await res.json();
      setGptResult(data);
      if (!data.error) {
        const d: Draft = {
          matched_contact: data.matched_contact ?? null,
          new_contact: data.new_contact
            ? {
                name: data.new_contact.name ?? "",
                company: data.new_contact.company ?? "",
                role: data.new_contact.role ?? "",
              }
            : null,
          interaction: data.interaction
            ? {
                type: data.interaction.type ?? "message",
                title: data.interaction.title ?? "",
                notes: data.interaction.notes ?? "",
              }
            : null,
          reminder: data.reminder
            ? { date: data.reminder.date ?? "", text: data.reminder.text ?? "" }
            : null,
          tags: data.tags ?? [],
          summary: data.summary ?? "",
        };
        setDraft(d);
        setTagsInput((data.tags ?? []).join(", "));
      }
    } catch (err) {
      setGptResult({ error: String(err) });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveToCrm = async () => {
    if (!draft) return;
    setIsSaving(true);
    setSaveMessage(null);
    const tags =
      tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean) ?? [];
    const payload = {
      matched_contact: draft.matched_contact?.id ? draft.matched_contact : null,
      new_contact:
        draft.new_contact?.name?.trim() !== undefined && draft.new_contact.name.trim() !== ""
          ? {
              name: draft.new_contact.name.trim(),
              company: draft.new_contact.company?.trim() ?? "",
              role: draft.new_contact.role?.trim() ?? "",
            }
          : null,
      interaction:
        draft.interaction?.title?.trim() !== undefined && draft.interaction.title.trim() !== ""
          ? {
              type: draft.interaction.type || "message",
              title: draft.interaction.title.trim(),
              notes: draft.interaction.notes?.trim() ?? "",
            }
          : null,
      reminder:
        draft.reminder?.text?.trim() !== undefined && draft.reminder.text.trim() !== ""
          ? {
              date: draft.reminder.date.trim(),
              text: draft.reminder.text.trim(),
            }
          : null,
      tags,
      summary: draft.summary?.trim() ?? "",
      sourceInput: inputText.trim(),
    };

    const hasTarget =
      payload.matched_contact ||
      (payload.new_contact?.name ?? "").length > 0 ||
      payload.interaction ||
      payload.reminder;
    if (!hasTarget) {
      setSaveMessage("Add a matched contact, new contact, interaction, or reminder before saving.");
      setIsSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/crm/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setSaveMessage(data.error ?? "Save failed");
        return;
      }
      setSaveMessage("Saved to your CRM.");
      router.refresh();
    } catch (e) {
      setSaveMessage(String(e));
    } finally {
      setIsSaving(false);
    }
  };

  const fieldStyle: CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    fontSize: "13px",
    marginTop: "4px",
    fontFamily: "inherit",
  };

  return (
    <>
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "16px", padding: "24px", marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(79, 70, 229, 0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Sparkles size={18} style={{ color: "#4f46e5" }} />
          </div>
          <div style={{ flex: 1 }}>
            <textarea
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                setGptResult(null);
                setDraft(null);
                setSaveMessage(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
              }}
              placeholder="What happened? Tell me about a recent interaction, new connection, or reminder..."
              rows={5}
              style={{ width: "100%", background: "transparent", border: "none", color: "#111827", fontSize: "16px", lineHeight: "1.6", resize: "none", outline: "none", fontFamily: "inherit" }}
            />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "#d1d5db" }}>{"Press \u2318+Enter to submit"}</span>
          <button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={!inputText.trim() || isProcessing}
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 20px", background: !inputText.trim() || isProcessing ? "rgba(79, 70, 229, 0.4)" : "#4f46e5", border: "none", borderRadius: "8px", color: "white", fontSize: "14px", fontWeight: "600", cursor: !inputText.trim() || isProcessing ? "not-allowed" : "pointer", opacity: !inputText.trim() ? 0.6 : 1 }}
          >
            {isProcessing ? <><Loader size={14} style={{ animation: "spin 1s linear infinite" }} />Processing...</> : <><Send size={14} />Analyze</>}
          </button>
        </div>
      </div>

      {isProcessing && (
        <div style={{ background: "#ffffff", border: "1px solid rgba(79, 70, 229, 0.2)", borderRadius: "12px", padding: "24px", marginBottom: "24px", textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "48px", height: "48px", borderRadius: "50%", border: "3px solid rgba(79, 70, 229, 0.15)", borderTopColor: "#4f46e5", animation: "spin 1s linear infinite" }} />
            <div style={{ fontSize: "16px", fontWeight: "600", color: "#111827" }}>Analyzing update...</div>
            <div style={{ fontSize: "13px", color: "#9ca3af" }}>Matching contacts, extracting interactions, creating reminders</div>
          </div>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {gptResult && !isProcessing && (
        <div style={{ background: "#ffffff", border: `1px solid ${gptResult.error ? "rgba(220,38,38,0.2)" : "rgba(5, 150, 105, 0.2)"}`, borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
          {gptResult.error ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#dc2626" }}>
              <AlertCircle size={16} />
              <span style={{ fontSize: "14px" }}>{gptResult.error}</span>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#059669" }} />
                <span style={{ fontSize: "14px", fontWeight: "600", color: "#059669" }}>Review and save</span>
              </div>
              <p style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "16px" }}>
                Edit anything below, then save to your CRM. Nothing is stored until you save.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                {gptResult.matched_contact && <ResultRow color="#7c3aed" label={`\u2192 Matched: ${gptResult.matched_contact.name}`} />}
                {gptResult.new_contact && <ResultRow color="#3b82f6" label={`+ New contact suggested: ${gptResult.new_contact.name}`} />}
                {gptResult.interaction && <ResultRow color="#059669" label={`+ Interaction: ${gptResult.interaction.type}: ${gptResult.interaction.title}`} />}
                {gptResult.reminder && <ResultRow color="#d97706" label={`\u23F0 Reminder: ${gptResult.reminder.text} (${gptResult.reminder.date})`} />}
                {gptResult.tags && gptResult.tags.length > 0 && <ResultRow color="#6366f1" label={`\u2713 Tags: ${gptResult.tags.join(", ")}`} />}
              </div>

              {draft && (
                <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <label style={{ fontSize: "12px", fontWeight: "600", color: "#6b7280" }}>
                    Summary
                    <input
                      style={fieldStyle}
                      value={draft.summary ?? ""}
                      onChange={(e) => { setDraft({ ...draft, summary: e.target.value }); }}
                    />
                  </label>

                  {draft.matched_contact && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "13px", color: "#7c3aed" }}>
                        Network match: <strong>{draft.matched_contact.name}</strong> ({draft.matched_contact.id})
                      </span>
                      <button
                        type="button"
                        onClick={() => { setDraft({ ...draft, matched_contact: null }); }}
                        style={{ fontSize: "12px", color: "#6b7280", background: "#f3f4f6", border: "none", padding: "6px 10px", borderRadius: "6px", cursor: "pointer" }}
                      >
                        Clear match
                      </button>
                    </div>
                  )}

                  <div style={{ fontSize: "12px", fontWeight: "700", color: "#111827" }}>New contact (if not matching someone above)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280" }}>
                      Name
                      <input
                        style={fieldStyle}
                        value={draft.new_contact?.name ?? ""}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            new_contact: { name: e.target.value, company: draft.new_contact?.company ?? "", role: draft.new_contact?.role ?? "" },
                          });
                        }}
                      />
                    </label>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280" }}>
                      Company
                      <input
                        style={fieldStyle}
                        value={draft.new_contact?.company ?? ""}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            new_contact: { name: draft.new_contact?.name ?? "", company: e.target.value, role: draft.new_contact?.role ?? "" },
                          });
                        }}
                      />
                    </label>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280", gridColumn: "1 / -1" }}>
                      Role
                      <input
                        style={fieldStyle}
                        value={draft.new_contact?.role ?? ""}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            new_contact: { name: draft.new_contact?.name ?? "", company: draft.new_contact?.company ?? "", role: e.target.value },
                          });
                        }}
                      />
                    </label>
                  </div>

                  <div style={{ fontSize: "12px", fontWeight: "700", color: "#111827" }}>Interaction</div>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280" }}>
                      Type
                      <select
                        style={{ ...fieldStyle, marginTop: "4px" }}
                        value={draft.interaction?.type ?? "message"}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            interaction: {
                              type: e.target.value,
                              title: draft.interaction?.title ?? "",
                              notes: draft.interaction?.notes ?? "",
                            },
                          });
                        }}
                      >
                        {interactionTypes.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280" }}>
                      Title
                      <input
                        style={fieldStyle}
                        value={draft.interaction?.title ?? ""}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            interaction: {
                              type: draft.interaction?.type ?? "message",
                              title: e.target.value,
                              notes: draft.interaction?.notes ?? "",
                            },
                          });
                        }}
                      />
                    </label>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280" }}>
                      Notes
                      <textarea
                        style={{ ...fieldStyle, minHeight: "72px", resize: "vertical" }}
                        value={draft.interaction?.notes ?? ""}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            interaction: {
                              type: draft.interaction?.type ?? "message",
                              title: draft.interaction?.title ?? "",
                              notes: e.target.value,
                            },
                          });
                        }}
                      />
                    </label>
                  </div>

                  <div style={{ fontSize: "12px", fontWeight: "700", color: "#111827" }}>Reminder</div>
                  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px" }}>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280" }}>
                      Date
                      <input
                        type="date"
                        style={fieldStyle}
                        value={draft.reminder?.date ?? ""}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            reminder: { date: e.target.value, text: draft.reminder?.text ?? "" },
                          });
                        }}
                      />
                    </label>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280" }}>
                      Text
                      <input
                        style={fieldStyle}
                        value={draft.reminder?.text ?? ""}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            reminder: { date: draft.reminder?.date ?? "", text: e.target.value },
                          });
                        }}
                      />
                    </label>
                  </div>

                  <label style={{ fontSize: "12px", fontWeight: "600", color: "#6b7280" }}>
                    Tags (comma-separated)
                    <input style={fieldStyle} value={tagsInput} onChange={(e) => { setTagsInput(e.target.value); }} />
                  </label>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => { void handleSaveToCrm(); }}
                      disabled={isSaving}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 20px",
                        background: isSaving ? "#9ca3af" : "#059669",
                        border: "none",
                        borderRadius: "8px",
                        color: "white",
                        fontSize: "14px",
                        fontWeight: "600",
                        cursor: isSaving ? "wait" : "pointer",
                      }}
                    >
                      {isSaving ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} />}
                      Save to CRM
                    </button>
                    {saveMessage && (
                      <span style={{ fontSize: "13px", color: saveMessage.startsWith("Saved") ? "#059669" : "#dc2626" }}>{saveMessage}</span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ marginBottom: "40px" }}>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
          Try an example
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {examplePrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => {
                setInputText(prompt);
                setGptResult(null);
                setDraft(null);
                setSaveMessage(null);
              }}
              style={{ textAlign: "left", padding: "12px 16px", background: "rgba(79, 70, 229, 0.03)", border: "1px solid rgba(79, 70, 229, 0.08)", borderRadius: "8px", color: "#6b7280", fontSize: "13px", cursor: "pointer", lineHeight: "1.4" }}
            >
              &ldquo;{prompt}&rdquo;
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
