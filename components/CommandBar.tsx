"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckCircle,
  Globe,
  Loader,
  Mic,
  MicOff,
  Plus,
  Save,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { CommandBarContext, type OpenCaptureOptions } from "./CommandBarProvider";

type ContactLite = {
  id: string;
  name: string;
  company: string;
  role: string;
  avatar: string;
  avatarColor: string;
  email?: string;
  tags: string[];
};

type Mode = "closed" | "search" | "capture";

type WebkitWindow = Window & {
  webkitSpeechRecognition?: new () => any;
};

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

const CAPTURE_PREFIX = "/";

/**
 * Global quick-capture + search palette. Wrap children with this to expose
 * `openCommand()` / `openCapture()` via `useCommandBar()`.
 */
export default function CommandBar({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("closed");
  const [capturePrefill, setCapturePrefill] = useState<OpenCaptureOptions>({});
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<ContactLite[] | null>(null);
  const [contactsLoading, setContactsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const captureRef = useRef<HTMLTextAreaElement | null>(null);

  // Loads the lightweight contact list into memory on first palette open.
  const ensureContactsLoaded = useCallback(() => {
    setContactsLoading((prevLoading) => {
      if (contacts || prevLoading) return prevLoading;
      fetch("/api/contacts/list")
        .then((r) => r.json())
        .then((body: { contacts?: ContactLite[] }) => {
          setContacts(body.contacts ?? []);
        })
        .catch(() => {
          setContacts([]);
        })
        .finally(() => setContactsLoading(false));
      return true;
    });
  }, [contacts]);

  const openCommand = useCallback(() => {
    setMode("search");
    setQuery("");
    ensureContactsLoaded();
  }, [ensureContactsLoaded]);

  const openCapture = useCallback(
    (options: OpenCaptureOptions = {}) => {
      setMode("capture");
      setCapturePrefill(options);
      ensureContactsLoaded();
    },
    [ensureContactsLoaded],
  );

  const close = useCallback(() => {
    setMode("closed");
    setQuery("");
    setCapturePrefill({});
  }, []);

  // Cmd/Ctrl + K opens the palette from anywhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (isCmdK) {
        e.preventDefault();
        if (mode === "closed") openCommand();
        return;
      }
      if (e.key === "Escape" && mode !== "closed") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, close, openCommand]);

  // Autofocus on open / mode switch.
  useEffect(() => {
    if (mode === "search") {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
    if (mode === "capture") {
      setTimeout(() => captureRef.current?.focus(), 10);
    }
  }, [mode]);

  const handleSearchQueryChange = useCallback(
    (next: string) => {
      if (next.startsWith(CAPTURE_PREFIX)) {
        openCapture({ prefillText: next.slice(CAPTURE_PREFIX.length) });
        setQuery("");
        return;
      }
      setQuery(next);
    },
    [openCapture],
  );

  const ctx = useMemo(() => ({ openCommand, openCapture }), [openCommand, openCapture]);

  return (
    <CommandBarContext.Provider value={ctx}>
      {children}
      <FloatingCaptureButton onClick={() => openCapture()} />
      {mode !== "closed" && (
        <CommandPalette
          mode={mode}
          query={query}
          setQuery={handleSearchQueryChange}
          contacts={contacts ?? []}
          contactsLoading={contactsLoading}
          close={close}
          inputRef={inputRef}
          captureRef={captureRef}
          capturePrefill={capturePrefill}
          onNavigate={(href) => {
            close();
            router.push(href);
          }}
          onCapture={() => {
            openCapture({ prefillText: query });
            setQuery("");
          }}
          onSaved={() => {
            close();
            router.refresh();
          }}
        />
      )}
    </CommandBarContext.Provider>
  );
}

function FloatingCaptureButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Quick capture"
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: 40,
        width: "52px",
        height: "52px",
        borderRadius: "50%",
        background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
        color: "#fff",
        border: "none",
        cursor: "pointer",
        boxShadow: "0 10px 30px rgba(79, 70, 229, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Plus size={22} />
    </button>
  );
}

function CommandPalette({
  mode,
  query,
  setQuery,
  contacts,
  contactsLoading,
  close,
  inputRef,
  captureRef,
  capturePrefill,
  onNavigate,
  onCapture,
  onSaved,
}: {
  mode: Exclude<Mode, "closed">;
  query: string;
  setQuery: (q: string) => void;
  contacts: ContactLite[];
  contactsLoading: boolean;
  close: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  captureRef: React.RefObject<HTMLTextAreaElement | null>;
  capturePrefill: OpenCaptureOptions;
  onNavigate: (href: string) => void;
  onCapture: () => void;
  onSaved: () => void;
}) {
  const lowered = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!lowered) return contacts.slice(0, 8);
    return contacts
      .map((c) => {
        const haystack = `${c.name} ${c.role} ${c.company} ${(c.tags || []).join(" ")}`.toLowerCase();
        const matched = haystack.includes(lowered);
        return matched ? c : null;
      })
      .filter((c): c is ContactLite => !!c)
      .slice(0, 10);
  }, [contacts, lowered]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(17, 24, 39, 0.45)",
        zIndex: 50,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "10vh",
      }}
    >
      <div
        style={{
          background: "#fff",
          width: "min(640px, 92vw)",
          maxHeight: "80vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          borderRadius: "14px",
          boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 14px",
            borderBottom: "1px solid #f3f4f6",
          }}
        >
          {mode === "search" ? <Users size={16} style={{ color: "#6b7280" }} /> : <Sparkles size={16} style={{ color: "#7c3aed" }} />}
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {mode === "search" ? "Search" : "Capture"}
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "#9ca3af",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "6px",
            }}
          >
            <X size={14} />
          </button>
        </div>
        {mode === "search" ? (
          <SearchMode
            inputRef={inputRef}
            query={query}
            setQuery={setQuery}
            matches={matches}
            loading={contactsLoading}
            onNavigate={onNavigate}
            onCapture={onCapture}
          />
        ) : (
          <CaptureMode
            textareaRef={captureRef}
            prefill={capturePrefill}
            contacts={contacts}
            onSaved={onSaved}
            onCancel={close}
          />
        )}
      </div>
    </div>
  );
}

function SearchMode({
  inputRef,
  query,
  setQuery,
  matches,
  loading,
  onNavigate,
  onCapture,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: (q: string) => void;
  matches: ContactLite[];
  loading: boolean;
  onNavigate: (href: string) => void;
  onCapture: () => void;
}) {
  const [highlightState, setHighlight] = useState<{ index: number; queryKey: string }>({
    index: 0,
    queryKey: query,
  });
  const highlight = highlightState.queryKey === query ? highlightState.index : 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight({ index: Math.min(highlight + 1, matches.length - 1), queryKey: query });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight({ index: Math.max(highlight - 1, 0), queryKey: query });
    } else if (e.key === "Enter") {
      const pick = matches[highlight];
      if (pick) {
        e.preventDefault();
        onNavigate(`/people/${pick.id}`);
      }
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search your network, or type / to capture..."
        style={{
          border: "none",
          outline: "none",
          fontSize: "15px",
          padding: "14px 16px",
          width: "100%",
          color: "#111827",
          background: "transparent",
        }}
      />
      <div style={{ borderTop: "1px solid #f3f4f6", overflowY: "auto", padding: "8px" }}>
        {loading && matches.length === 0 && (
          <div style={{ padding: "20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>Loading...</div>
        )}
        {!loading && matches.length === 0 && (
          <div
            style={{
              padding: "16px",
              textAlign: "center",
              color: "#9ca3af",
              fontSize: "13px",
            }}
          >
            {query.trim() ? (
              <>
                No matches in your network.{" "}
                <button
                  type="button"
                  onClick={() => onNavigate(`/discover?q=${encodeURIComponent(query.trim())}`)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#4f46e5",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Search the world →
                </button>
              </>
            ) : (
              "Start typing to find people, or press / to capture a note."
            )}
          </div>
        )}
        {matches.map((c, idx) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onNavigate(`/people/${c.id}`)}
            onMouseEnter={() => setHighlight({ index: idx, queryKey: query })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              width: "100%",
              padding: "10px 10px",
              border: "none",
              borderRadius: "8px",
              background: idx === highlight ? "#f3f4f6" : "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div
              style={{
                width: "30px",
                height: "30px",
                borderRadius: "8px",
                background: `${c.avatarColor}22`,
                color: c.avatarColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {c.avatar || c.name.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>{c.name}</div>
              <div style={{ fontSize: "11px", color: "#6b7280" }}>
                {c.role}{c.company ? ` @ ${c.company}` : ""}
              </div>
            </div>
          </button>
        ))}
      </div>
      <div
        style={{
          borderTop: "1px solid #f3f4f6",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "11px",
          color: "#9ca3af",
          flexWrap: "wrap",
        }}
      >
        <span>
          <kbd style={kbdStyle}>↑</kbd>
          <kbd style={kbdStyle}>↓</kbd> navigate
        </span>
        <span>
          <kbd style={kbdStyle}>↵</kbd> open profile
        </span>
        <button
          type="button"
          onClick={onCapture}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#4f46e5",
            background: "rgba(79, 70, 229, 0.08)",
            border: "1px solid rgba(79, 70, 229, 0.2)",
            borderRadius: "8px",
            padding: "6px 10px",
            cursor: "pointer",
          }}
        >
          <Sparkles size={12} />
          Capture
        </button>
        <button
          type="button"
          onClick={() => query.trim() && onNavigate(`/discover?q=${encodeURIComponent(query.trim())}`)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#6b7280",
            background: "transparent",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            padding: "6px 10px",
            cursor: "pointer",
          }}
        >
          <Globe size={12} /> World
        </button>
      </div>
    </div>
  );
}

function CaptureMode({
  textareaRef,
  prefill,
  contacts,
  onSaved,
  onCancel,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  prefill: OpenCaptureOptions;
  contacts: ContactLite[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const contact = prefill.contactId ? contacts.find((c) => c.id === prefill.contactId) : null;
  const [inputText, setInputText] = useState(prefill.prefillText ?? "");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<any | null>(null);
  const shouldKeepListeningRef = useRef(false);

  async function analyze() {
    if (!inputText.trim()) return;
    setIsAnalyzing(true);
    setError(null);
    setDraft(null);
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
      });
      const data = (await res.json()) as GPTResult;
      if (data.error) {
        setError(data.error);
      } else {
        const matched = data.matched_contact
          ? data.matched_contact
          : contact
            ? { id: contact.id, name: contact.name }
            : null;
        setDraft({
          matched_contact: matched,
          new_contact: data.new_contact ?? null,
          interaction: data.interaction ?? null,
          reminder: data.reminder ?? null,
          tags: data.tags ?? [],
          summary: data.summary ?? "",
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function save() {
    if (!draft) return;
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        matched_contact: draft.matched_contact ?? null,
        new_contact: draft.new_contact && draft.new_contact.name.trim() ? draft.new_contact : null,
        interaction: draft.interaction && draft.interaction.title.trim() ? draft.interaction : null,
        reminder: draft.reminder && draft.reminder.text.trim() ? draft.reminder : null,
        tags: draft.tags ?? [],
        summary: draft.summary ?? "",
        sourceInput: inputText.trim(),
      };
      const hasTarget =
        payload.matched_contact ||
        (payload.new_contact?.name?.trim().length ?? 0) > 0 ||
        payload.interaction ||
        payload.reminder;
      if (!hasTarget) {
        setError("Nothing to save. Describe an interaction, contact, or follow-up.");
        return;
      }
      const res = await fetch("/api/crm/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "Save failed");
        return;
      }
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSaving(false);
    }
  }

  function startVoice() {
    if (typeof window === "undefined") return;
    const Ctor = (window as WebkitWindow).webkitSpeechRecognition;
    if (!Ctor) {
      setVoiceError("Voice typing is not supported in this browser.");
      return;
    }
    shouldKeepListeningRef.current = true;
    setVoiceError(null);
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => setIsListening(true);
    rec.onresult = (event: any) => {
      const text = Array.from(event.results as Array<{ isFinal: boolean; 0?: { transcript?: string } }>)
        .slice(event.resultIndex as number)
        .filter((r) => r.isFinal)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (!text) return;
      setInputText((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
    };
    rec.onend = () => {
      if (!shouldKeepListeningRef.current) {
        setIsListening(false);
        recognitionRef.current = null;
        return;
      }
      try {
        rec.start();
      } catch {
        setIsListening(false);
        recognitionRef.current = null;
      }
    };
    rec.onerror = () => {
      setVoiceError("Voice typing hiccuped.");
    };
    rec.start();
  }

  function stopVoice() {
    shouldKeepListeningRef.current = false;
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", overflowY: "auto" }}>
      {contact && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 14px",
            background: "rgba(79, 70, 229, 0.05)",
            fontSize: "12px",
            color: "#4f46e5",
            fontWeight: 600,
            borderBottom: "1px solid #f3f4f6",
          }}
        >
          <CheckCircle size={13} />
          Capturing about {contact.name}
        </div>
      )}
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              setDraft(null);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void analyze();
            }}
            placeholder={contact
              ? `How did it go with ${contact.name}?`
              : "What happened? e.g. 'Coffee with Sarah at Google, follow up in 2 weeks'"}
            rows={4}
            style={{
              flex: 1,
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              padding: "10px 12px",
              fontSize: "14px",
              lineHeight: 1.5,
              resize: "vertical",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          <button
            type="button"
            onClick={() => (isListening ? stopVoice() : startVoice())}
            title={isListening ? "Stop voice typing" : "Start voice typing"}
            style={{
              border: "1px solid #e5e7eb",
              background: isListening ? "rgba(79, 70, 229, 0.1)" : "#fff",
              color: isListening ? "#4f46e5" : "#6b7280",
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {isListening ? <MicOff size={15} /> : <Mic size={15} />}
          </button>
        </div>
        {voiceError && <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "6px" }}>{voiceError}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", flexWrap: "wrap", gap: "8px" }}>
          <div style={{ fontSize: "11px", color: "#9ca3af" }}>
            <kbd style={kbdStyle}>⌘</kbd>
            <kbd style={kbdStyle}>↵</kbd> to analyze
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#6b7280",
                background: "transparent",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                padding: "8px 12px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={!inputText.trim() || isAnalyzing}
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#fff",
                background: !inputText.trim() || isAnalyzing ? "#9ca3af" : "#4f46e5",
                border: "none",
                borderRadius: "8px",
                padding: "8px 14px",
                cursor: !inputText.trim() || isAnalyzing ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {isAnalyzing ? <Loader size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={13} />}
              Analyze
            </button>
          </div>
        </div>
        {error && <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "8px" }}>{error}</div>}
      </div>

      {draft && (
        <div style={{ borderTop: "1px solid #f3f4f6", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.05em", color: "#059669", textTransform: "uppercase" }}>
            Review
          </div>
          {draft.summary && <div style={{ fontSize: "13px", color: "#111827" }}>{draft.summary}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {draft.matched_contact && (
              <RowBadge color="#7c3aed" label={`Match: ${draft.matched_contact.name}`} />
            )}
            {draft.new_contact?.name && (
              <RowBadge color="#3b82f6" label={`New contact: ${draft.new_contact.name}${draft.new_contact.company ? ` @ ${draft.new_contact.company}` : ""}`} />
            )}
            {draft.interaction?.title && (
              <RowBadge color="#059669" label={`Interaction: ${draft.interaction.type} — ${draft.interaction.title}`} />
            )}
            {draft.reminder?.text && (
              <RowBadge color="#d97706" label={`Reminder: ${draft.reminder.text} (${draft.reminder.date})`} />
            )}
            {draft.tags && draft.tags.length > 0 && (
              <RowBadge color="#6366f1" label={`Tags: ${draft.tags.join(", ")}`} />
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
            <button
              type="button"
              onClick={() => setDraft(null)}
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#6b7280",
                background: "transparent",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                padding: "8px 12px",
                cursor: "pointer",
              }}
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={isSaving}
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#fff",
                background: isSaving ? "#9ca3af" : "#059669",
                border: "none",
                borderRadius: "8px",
                padding: "8px 14px",
                cursor: isSaving ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {isSaving ? <Loader size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={13} />}
              Save
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function RowBadge({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "7px 10px",
        background: "#f8f9fa",
        borderRadius: "8px",
      }}
    >
      <CheckCircle size={12} style={{ color, flexShrink: 0 }} />
      <span style={{ fontSize: "12px", color }}>{label}</span>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 5px",
  margin: "0 2px",
  border: "1px solid #e5e7eb",
  borderRadius: "4px",
  background: "#fafafa",
  fontFamily: "inherit",
  fontSize: "10px",
  color: "#6b7280",
};
