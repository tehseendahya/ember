"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Search,
  Globe,
  Users,
  ArrowRight,
  Star,
  GitBranch,
  Zap,
  ExternalLink,
  Loader2,
  Mic,
  MicOff,
} from "lucide-react";
import type { Contact, WorldSearchResult } from "@/lib/types";
import IntroRequestModal from "@/components/IntroRequestModal";

const exampleSearches = [
  "fundraising advice",
  "ML engineer for hire",
  "intro to Sequoia",
  "product manager at big tech",
  "climate tech founder",
  "design systems expert",
];

type NetworkHit = { contact: Contact; relevance: number; reason: string };
type WebkitWindow = Window & {
  webkitSpeechRecognition?: new () => any;
};

export default function DiscoverClient({ contacts }: { contacts: Contact[] }) {
  const [mode, setMode] = useState<"network" | "world">("network");
  const [query, setQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<any | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const shouldRestartRef = useRef(true);

  const [networkResults, setNetworkResults] = useState<NetworkHit[]>([]);
  const [worldResults, setWorldResults] = useState<WorldSearchResult[]>([]);
  const [introModalResult, setIntroModalResult] = useState<WorldSearchResult | null>(null);

  const getIntroducerNames = (ids: string[] | undefined) =>
    (ids ?? [])
      .map((id) => contacts.find((c) => c.id === id)?.name)
      .filter(Boolean)
      .join(", ");

  const canRequestIntro = (r: WorldSearchResult) =>
    !!(r.introducers?.length && r.introducers.some((id) => contacts.some((c) => c.id === id)));

  async function runSearch(searchQuery: string) {
    const q = searchQuery.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setNotice(null);
    setHasSearched(true);

    try {
      if (mode === "network") {
        const res = await fetch("/api/search/network", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Network search failed");
        }
        setNetworkResults(Array.isArray(data.results) ? data.results : []);
        if (data.degraded && data.warning) setNotice(data.warning);
        else if (data.degraded) setNotice("Showing keyword-ranked results (AI ranking unavailable).");
      } else {
        const res = await fetch("/api/search/world", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "World search failed");
        }
        setWorldResults(Array.isArray(data.results) ? data.results : []);
        if (data.degraded && data.warning) setNotice(data.warning);
        else if (data.degraded) setNotice("Results formatted without full AI pass.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      if (mode === "network") setNetworkResults([]);
      else setWorldResults([]);
    } finally {
      setLoading(false);
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query);
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
    void runSearch(example);
  };

  const worldWithIntros = worldResults.filter((r) => r.introducers && r.introducers.length > 0);

  const startVoiceTyping = () => {
    if (typeof window === "undefined") return;

    const SpeechRecognitionCtor = (window as WebkitWindow).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceError("Voice typing is not supported in this browser.");
      return;
    }

    shouldKeepListeningRef.current = true;
    shouldRestartRef.current = true;
    setVoiceError(null);

    const recognition = new SpeechRecognitionCtor();
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setIsListening(true);
    };
    recognition.onresult = (event: any) => {
      const text = Array.from(event.results as Array<{ isFinal: boolean; 0?: { transcript?: string } }>)
        .slice(event.resultIndex as number)
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (!text) return;
      setQuery((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
    };
    recognition.onerror = (event: any) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "audio-capture") {
        shouldKeepListeningRef.current = false;
        shouldRestartRef.current = false;
        setVoiceError("Mic permission or audio device issue. Check browser microphone access.");
        return;
      }
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setVoiceError("Voice typing hiccuped and will retry.");
      }
    };
    recognition.onend = () => {
      if (!shouldKeepListeningRef.current || !shouldRestartRef.current) {
        setIsListening(false);
        recognitionRef.current = null;
        return;
      }
      setTimeout(() => {
        if (!shouldKeepListeningRef.current || !recognitionRef.current) return;
        try {
          recognitionRef.current.start();
        } catch {
          setVoiceError("Voice typing stopped unexpectedly. Tap mic to restart.");
          shouldKeepListeningRef.current = false;
          setIsListening(false);
          recognitionRef.current = null;
        }
      }, 200);
    };
    recognition.start();
  };

  const stopVoiceTyping = () => {
    shouldKeepListeningRef.current = false;
    shouldRestartRef.current = false;
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  return (
    <div className="search-container" style={{ padding: "32px 40px", maxWidth: "1200px" }}>
      <div style={{ marginBottom: "32px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: "800",
            color: "#111827",
            letterSpacing: "-0.5px",
            marginBottom: "8px",
          }}
        >
          Search
        </h1>
        <p style={{ fontSize: "14px", color: "#9ca3af" }}>
          Find the right person in your network or across the web
        </p>
      </div>

      <div
        style={{
          display: "inline-flex",
          background: "#f3f4f6",
          border: "1px solid #e5e7eb",
          borderRadius: "10px",
          padding: "4px",
          marginBottom: "24px",
        }}
      >
        {(["network", "world"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setHasSearched(false);
              setError(null);
              setNotice(null);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "7px",
              border: "none",
              background: mode === m ? "#4f46e5" : "transparent",
              color: mode === m ? "white" : "#6b7280",
              fontSize: "13px",
              fontWeight: mode === m ? "600" : "400",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {m === "network" ? <Users size={14} /> : <Globe size={14} />}
            {m === "network" ? "My Network" : "Search the World"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSearch} style={{ marginBottom: "32px" }}>
        <div style={{ position: "relative", maxWidth: "700px" }}>
          <Search
            size={18}
            style={{
              position: "absolute",
              left: "16px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "#9ca3af",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === "network" ? "Find the best person for..." : "Search the web for people..."
            }
            style={{
              width: "100%",
              padding: "14px 120px 14px 46px",
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "12px",
              color: "#111827",
              fontSize: "15px",
              outline: "none",
              transition: "border-color 0.15s",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "#4f46e5";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(79, 70, 229, 0.1)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#e5e7eb";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (isListening) {
                stopVoiceTyping();
                return;
              }
              startVoiceTyping();
            }}
            title={isListening ? "Stop voice typing" : "Start voice typing"}
            style={{
              position: "absolute",
              right: "84px",
              top: "50%",
              transform: "translateY(-50%)",
              width: "30px",
              height: "30px",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
              background: isListening ? "rgba(79, 70, 229, 0.1)" : "#fff",
              color: isListening ? "#4f46e5" : "#6b7280",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            {isListening ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
          <button
            type="submit"
            disabled={loading}
            style={{
              position: "absolute",
              right: "8px",
              top: "50%",
              transform: "translateY(-50%)",
              padding: "7px 14px",
              background: loading ? "#a5b4fc" : "#4f46e5",
              border: "none",
              borderRadius: "8px",
              color: "white",
              fontSize: "13px",
              fontWeight: "600",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {loading ? "…" : "Search"}
          </button>
        </div>
        {voiceError && (
          <div style={{ marginTop: "8px", fontSize: "12px", color: "#dc2626" }}>
            {voiceError}
          </div>
        )}
      </form>

      {!hasSearched && (
        <div style={{ marginBottom: "32px" }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: "600",
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "12px",
            }}
          >
            Try searching for
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {exampleSearches.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleExampleClick(s)}
                style={{
                  padding: "8px 14px",
                  background: "rgba(79, 70, 229, 0.04)",
                  border: "1px solid rgba(79, 70, 229, 0.1)",
                  borderRadius: "20px",
                  color: "#4f46e5",
                  fontSize: "13px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(79, 70, 229, 0.08)";
                  e.currentTarget.style.borderColor = "rgba(79, 70, 229, 0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(79, 70, 229, 0.04)";
                  e.currentTarget.style.borderColor = "rgba(79, 70, 229, 0.1)";
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {notice && hasSearched && (
        <div
          style={{
            marginBottom: "16px",
            padding: "10px 14px",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "8px",
            fontSize: "13px",
            color: "#92400e",
          }}
        >
          {notice}
        </div>
      )}

      {error && hasSearched && (
        <div
          style={{
            marginBottom: "16px",
            padding: "12px 14px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            fontSize: "13px",
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}

      {hasSearched && loading && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#6b7280", marginBottom: "16px" }}>
          <Loader2 size={20} style={{ animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontSize: "14px" }}>Searching…</span>
        </div>
      )}

      {hasSearched && mode === "network" && !loading && (
        <div>
          <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "14px", color: "#9ca3af" }}>
              {networkResults.length > 0
                ? `${networkResults.length} results for "${query}"`
                : error
                  ? ""
                  : `No results for "${query}"`}
            </span>
          </div>

          {!error && networkResults.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "60px 20px",
                background: "#ffffff",
                borderRadius: "12px",
                border: "1px solid #e5e7eb",
              }}
            >
              <Search size={40} style={{ margin: "0 auto 12px", opacity: 0.3, display: "block" }} />
              <p style={{ color: "#9ca3af" }}>No contacts match your search</p>
              <p style={{ color: "#d1d5db", fontSize: "13px", marginTop: "4px" }}>
                Try a broader phrase or search the web to discover people
              </p>
            </div>
          )}

          {networkResults.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {networkResults.map(({ contact, relevance, reason }, idx) => (
                <Link
                  key={contact.id}
                  href={`/people/${contact.id}`}
                  style={{ textDecoration: "none" }}
                >
                  <div
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "12px",
                      padding: "18px 20px",
                      display: "flex",
                      alignItems: "center",
                      gap: "16px",
                      transition: "all 0.15s ease",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#f8f9fa";
                      e.currentTarget.style.borderColor = "#4f46e5";
                      e.currentTarget.style.transform = "translateX(4px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#ffffff";
                      e.currentTarget.style.borderColor = "#e5e7eb";
                      e.currentTarget.style.transform = "translateX(0)";
                    }}
                  >
                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        background: idx === 0 ? "rgba(79, 70, 229, 0.08)" : "#f3f4f6",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "12px",
                        fontWeight: "700",
                        color: idx === 0 ? "#4f46e5" : "#9ca3af",
                        flexShrink: 0,
                      }}
                    >
                      #{idx + 1}
                    </div>

                    <div
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "50%",
                        background: contact.avatarColor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "13px",
                        fontWeight: "700",
                        color: "white",
                        flexShrink: 0,
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
                        }}
                      >
                        {contact.name}
                      </div>
                      <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "6px" }}>
                        {contact.role} @ {contact.company}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "#9ca3af",
                          fontStyle: "italic",
                        }}
                      >
                        {reason}
                      </div>
                    </div>

                    <div className="search-score" style={{ textAlign: "right", flexShrink: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          justifyContent: "flex-end",
                          marginBottom: "4px",
                        }}
                      >
                        <Star size={12} style={{ color: "#d97706" }} />
                        <span
                          style={{
                            fontSize: "15px",
                            fontWeight: "700",
                            color: "#111827",
                          }}
                        >
                          {Math.min(99, relevance)}
                        </span>
                      </div>
                      <div style={{ fontSize: "11px", color: "#9ca3af" }}>relevance</div>
                    </div>

                    <ArrowRight size={16} style={{ color: "#d1d5db", flexShrink: 0 }} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {hasSearched && mode === "world" && !loading && (
        <div className="world-grid" style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "24px" }}>
          <div>
            <div style={{ marginBottom: "16px" }}>
              <span style={{ fontSize: "14px", color: "#9ca3af" }}>
                {error ? "" : `Web results for "${query}"`}
              </span>
            </div>
            {worldResults.length === 0 && !error && (
              <div
                style={{
                  textAlign: "center",
                  padding: "48px 20px",
                  background: "#ffffff",
                  borderRadius: "12px",
                  border: "1px solid #e5e7eb",
                  color: "#9ca3af",
                }}
              >
                No people found — try different keywords.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {worldResults.map((result, idx) => (
                <div
                  key={result.id}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "12px",
                    padding: "18px 20px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "14px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: "700",
                      color: idx === 0 ? "#4f46e5" : "#d1d5db",
                      width: "20px",
                      flexShrink: 0,
                      paddingTop: "2px",
                    }}
                  >
                    #{idx + 1}
                  </div>

                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "50%",
                      background: result.avatarColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "13px",
                      fontWeight: "700",
                      color: "white",
                      flexShrink: 0,
                    }}
                  >
                    {result.avatar}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "4px",
                        flexWrap: "wrap",
                        gap: "8px",
                      }}
                    >
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>
                        {result.name}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <Zap size={12} style={{ color: "#d97706" }} />
                        <span style={{ fontSize: "14px", fontWeight: "700", color: "#111827" }}>
                          {result.relevance}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "8px" }}>
                      {result.company ? `${result.role} @ ${result.company}` : result.role}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#9ca3af",
                        marginBottom: "12px",
                        fontStyle: "italic",
                      }}
                    >
                      {result.reason}
                    </div>

                    {result.sourceUrl && (
                      <a
                        href={result.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "12px",
                          color: "#4f46e5",
                          marginBottom: "10px",
                        }}
                      >
                        <ExternalLink size={12} />
                        Source
                      </a>
                    )}

                    {result.connectionPath && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          padding: "8px 10px",
                          background: "rgba(79, 70, 229, 0.04)",
                          borderRadius: "6px",
                          marginBottom: "10px",
                          marginTop: "4px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <GitBranch size={12} style={{ color: "#4f46e5", flexShrink: 0 }} />
                          <span style={{ fontSize: "12px", color: "#4f46e5" }}>{result.connectionPath}</span>
                        </div>
                        {result.pathScore != null && result.pathScoreBreakdown && (
                          <span style={{ fontSize: "11px", color: "#6b7280", paddingLeft: "18px" }}>
                            Score {result.pathScore}/100 · rel {Math.round(result.pathScoreBreakdown.connectionStrength * 100)}% · edge{" "}
                            {Math.round(result.pathScoreBreakdown.edgeConfidence * 100)}% · intent{" "}
                            {Math.round(result.pathScoreBreakdown.intentMatch * 100)}% · recency{" "}
                            {Math.round(result.pathScoreBreakdown.recency * 100)}%
                          </span>
                        )}
                      </div>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      {result.introducers && result.introducers.length > 0 && (
                        <span style={{ fontSize: "12px", color: "#9ca3af" }}>
                          Possible introducers:{" "}
                          <span style={{ color: "#111827", fontWeight: "500" }}>
                            {getIntroducerNames(result.introducers)}
                          </span>
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={!canRequestIntro(result)}
                        title={
                          !canRequestIntro(result)
                            ? "No one in your CRM can intro yet — add connections first"
                            : undefined
                        }
                        onClick={() => setIntroModalResult(result)}
                        style={{
                          padding: "5px 10px",
                          background: !canRequestIntro(result) ? "rgba(79, 70, 229, 0.35)" : "#4f46e5",
                          border: "none",
                          borderRadius: "5px",
                          color: "white",
                          fontSize: "11px",
                          fontWeight: "600",
                          cursor: !canRequestIntro(result) ? "not-allowed" : "pointer",
                          transition: "background 0.15s",
                          marginLeft: "auto",
                        }}
                        onMouseEnter={(e) => {
                          if (!canRequestIntro(result)) return;
                          e.currentTarget.style.background = "#4338ca";
                        }}
                        onMouseLeave={(e) => {
                          if (!canRequestIntro(result)) return;
                          e.currentTarget.style.background = "#4f46e5";
                        }}
                      >
                        Request Intro
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="world-sidebar">
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "20px",
                position: "sticky",
                top: "24px",
              }}
            >
              <h3
                style={{
                  fontSize: "14px",
                  fontWeight: "700",
                  color: "#111827",
                  marginBottom: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <GitBranch size={14} style={{ color: "#4f46e5" }} />
                Who Can Introduce Me?
              </h3>

              {worldWithIntros.length === 0 && worldResults.length > 0 && (
                <p style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.5 }}>
                  No overlap with your CRM yet — open a source link, then add promising people to your network.
                </p>
              )}

              {worldResults.length === 0 && !error && !loading && (
                <p style={{ fontSize: "12px", color: "#9ca3af" }}>Run a search to see intro ideas.</p>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {worldWithIntros.map((result) => {
                  const introducer = contacts.find((c) => c.id === result.introducers?.[0]);
                  if (!introducer) return null;
                  return (
                    <div
                      key={result.id}
                      style={{
                        padding: "12px",
                        background: "#f8f9fa",
                        borderRadius: "8px",
                        border: "1px solid #f3f4f6",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: "600",
                          color: "#111827",
                          marginBottom: "8px",
                        }}
                      >
                        → {result.name}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          flexWrap: "wrap",
                        }}
                      >
                        <div
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "10px",
                            fontWeight: "700",
                            color: "white",
                          }}
                        >
                          T
                        </div>
                        <div style={{ width: "16px", height: "1px", background: "#d1d5db" }} />

                        <div
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            background: introducer.avatarColor,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "10px",
                            fontWeight: "700",
                            color: "white",
                          }}
                        >
                          {introducer.avatar}
                        </div>
                        <div style={{ width: "16px", height: "1px", background: "#d1d5db" }} />

                        <div
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            background: result.avatarColor,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "10px",
                            fontWeight: "700",
                            color: "white",
                          }}
                        >
                          {result.avatar}
                        </div>
                      </div>

                      <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "6px" }}>
                        via {introducer.name} (heuristic match — verify before reaching out)
                      </div>
                      <button
                        type="button"
                        onClick={() => setIntroModalResult(result)}
                        style={{
                          marginTop: "10px",
                          padding: "6px 12px",
                          background: "#4f46e5",
                          border: "none",
                          borderRadius: "6px",
                          color: "white",
                          fontSize: "11px",
                          fontWeight: "600",
                          cursor: "pointer",
                          width: "100%",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#4338ca";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "#4f46e5";
                        }}
                      >
                        Request intro
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <IntroRequestModal
        open={introModalResult !== null}
        onClose={() => setIntroModalResult(null)}
        result={introModalResult}
        contacts={contacts}
        searchQuery={query}
      />

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (max-width: 768px) {
          .search-container { padding: 20px 16px !important; }
          .world-grid { grid-template-columns: 1fr !important; }
          .world-sidebar { display: none !important; }
          .search-score { display: none !important; }
        }
      `}</style>
    </div>
  );
}
