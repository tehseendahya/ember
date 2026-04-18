"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import {
  buildImportRows,
  IMPORT_FIELD_OPTIONS,
  inferColumnMapping,
  parseCsv,
  type ImportField,
  type ImportRow,
  type ParsedCsv,
} from "@/lib/csv/parse";

type AiMode = "auto" | "always" | "never";

type Step = "upload" | "map" | "importing" | "done";

interface BatchResult {
  name: string;
  status: "created" | "skipped_duplicate" | "failed";
  contactId?: string;
  enriched?: boolean;
  reason?: string;
}

interface Summary {
  created: number;
  skipped: number;
  failed: number;
  enriched: number;
}

const BATCH_SIZE = 8;

export default function ImportPeopleModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ImportField[]>([]);
  const [aiMode, setAiMode] = useState<AiMode>("auto");
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [allResults, setAllResults] = useState<BatchResult[]>([]);
  const [summary, setSummary] = useState<Summary>({ created: 0, skipped: 0, failed: 0, enriched: 0 });
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "importing") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, step]);

  const importRows: ImportRow[] = useMemo(() => {
    if (!parsed) return [];
    return buildImportRows(parsed, mapping);
  }, [parsed, mapping]);

  const sparseCount = importRows.filter((r) => r.looksSparse).length;
  const hasNameMapping = mapping.includes("name") || (mapping.includes("firstName") && mapping.includes("lastName"));

  async function handleFile(file: File) {
    setParseError(null);
    setFileName(file.name);
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setParseError("Please upload a .csv file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setParseError("File is larger than 5 MB — please split it into smaller batches");
      return;
    }
    const text = await file.text();
    const result = parseCsv(text);
    if (result.headers.length === 0) {
      setParseError("We couldn't detect any columns. Make sure the first row is a header.");
      return;
    }
    if (result.rows.length === 0) {
      setParseError("No data rows found below the header");
      return;
    }
    setParsed(result);
    setMapping(inferColumnMapping(result.headers));
    setStep("map");
  }

  function setMappingAt(index: number, value: ImportField) {
    setMapping((prev) => {
      const next = [...prev];
      // Enforce uniqueness for all fields except "ignore" — you can't have two "email" columns.
      if (value !== "ignore") {
        for (let i = 0; i < next.length; i++) {
          if (i !== index && next[i] === value) next[i] = "ignore";
        }
      }
      next[index] = value;
      return next;
    });
  }

  async function runImport() {
    if (importRows.length === 0) return;
    setStep("importing");
    setProgressDone(0);
    setProgressTotal(importRows.length);
    setAllResults([]);
    setSummary({ created: 0, skipped: 0, failed: 0, enriched: 0 });
    setFatalError(null);

    const chunks: ImportRow[][] = [];
    for (let i = 0; i < importRows.length; i += BATCH_SIZE) {
      chunks.push(importRows.slice(i, i + BATCH_SIZE));
    }

    const accumulated: BatchResult[] = [];
    let cumulative: Summary = { created: 0, skipped: 0, failed: 0, enriched: 0 };

    for (const chunk of chunks) {
      try {
        const res = await fetch("/api/contacts/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: chunk, aiMode }),
        });
        const data = (await res.json()) as
          | { ok: true; results: BatchResult[]; summary: Summary }
          | { ok: false; error: string };
        if (!data.ok) {
          setFatalError(data.error);
          setStep("done");
          return;
        }
        accumulated.push(...data.results);
        cumulative = {
          created: cumulative.created + data.summary.created,
          skipped: cumulative.skipped + data.summary.skipped,
          failed: cumulative.failed + data.summary.failed,
          enriched: cumulative.enriched + data.summary.enriched,
        };
        setAllResults([...accumulated]);
        setSummary({ ...cumulative });
        setProgressDone((d) => d + chunk.length);
      } catch (err) {
        setFatalError(err instanceof Error ? err.message : String(err));
        setStep("done");
        return;
      }
    }

    router.refresh();
    setStep("done");
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && step !== "importing") onClose();
      }}
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
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "780px",
          maxHeight: "92vh",
          overflow: "hidden",
          background: "#fff",
          borderRadius: "14px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            padding: "18px 22px",
            borderBottom: "1px solid #f3f4f6",
          }}
        >
          <div>
            <h2
              id="import-modal-title"
              style={{ fontSize: "16px", fontWeight: 700, color: "#111827", marginBottom: "4px" }}
            >
              Import people from CSV
            </h2>
            <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
              We&apos;ll auto-detect columns and fill in missing details with AI when rows are sparse.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={step === "importing"}
            aria-label="Close"
            style={{
              padding: "6px",
              border: "none",
              background: "transparent",
              borderRadius: "8px",
              cursor: step === "importing" ? "not-allowed" : "pointer",
              color: "#9ca3af",
              opacity: step === "importing" ? 0.4 : 1,
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1 }}>
          {step === "upload" && (
            <UploadStep
              fileInputRef={fileInputRef}
              fileName={fileName}
              parseError={parseError}
              dragOver={dragOver}
              setDragOver={setDragOver}
              onFile={handleFile}
            />
          )}

          {step === "map" && parsed && (
            <MapStep
              parsed={parsed}
              mapping={mapping}
              setMappingAt={setMappingAt}
              importRows={importRows}
              sparseCount={sparseCount}
              aiMode={aiMode}
              setAiMode={setAiMode}
              hasNameMapping={hasNameMapping}
              fileName={fileName}
              onReset={() => {
                setStep("upload");
                setParsed(null);
                setFileName("");
              }}
            />
          )}

          {step === "importing" && (
            <ImportingStep
              done={progressDone}
              total={progressTotal}
              summary={summary}
              aiMode={aiMode}
            />
          )}

          {step === "done" && (
            <DoneStep
              summary={summary}
              results={allResults}
              fatalError={fatalError}
              onImportAnother={() => {
                setStep("upload");
                setParsed(null);
                setFileName("");
                setAllResults([]);
                setSummary({ created: 0, skipped: 0, failed: 0, enriched: 0 });
                setProgressDone(0);
                setProgressTotal(0);
                setFatalError(null);
              }}
            />
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            padding: "14px 22px",
            borderTop: "1px solid #f3f4f6",
            background: "#fafafa",
          }}
        >
          {step === "upload" && (
            <button type="button" onClick={onClose} style={secondaryBtnStyle}>
              Cancel
            </button>
          )}
          {step === "map" && (
            <>
              <button type="button" onClick={onClose} style={secondaryBtnStyle}>
                Cancel
              </button>
              <button
                type="button"
                onClick={runImport}
                disabled={!hasNameMapping || importRows.length === 0}
                style={{
                  ...primaryBtnStyle,
                  opacity: !hasNameMapping || importRows.length === 0 ? 0.5 : 1,
                  cursor: !hasNameMapping || importRows.length === 0 ? "not-allowed" : "pointer",
                }}
              >
                <Upload size={14} />
                Import {importRows.length} {importRows.length === 1 ? "person" : "people"}
              </button>
            </>
          )}
          {step === "importing" && (
            <div style={{ fontSize: "12px", color: "#6b7280" }}>
              Please keep this window open until import finishes.
            </div>
          )}
          {step === "done" && (
            <button type="button" onClick={onClose} style={primaryBtnStyle}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function UploadStep({
  fileInputRef,
  fileName,
  parseError,
  dragOver,
  setDragOver,
  onFile,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  fileName: string;
  parseError: string | null;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onFile: (file: File) => void;
}) {
  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#4f46e5" : "#d1d5db"}`,
          background: dragOver ? "rgba(79,70,229,0.05)" : "#fafafa",
          borderRadius: "12px",
          padding: "36px 24px",
          textAlign: "center",
          cursor: "pointer",
          transition: "all 120ms ease",
        }}
      >
        <Upload size={28} style={{ color: "#4f46e5", marginBottom: "10px" }} />
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827", marginBottom: "4px" }}>
          {fileName || "Drop a CSV here, or click to browse"}
        </div>
        <div style={{ fontSize: "12px", color: "#6b7280" }}>
          Up to 5 MB · expects a header row · columns are auto-detected
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
          style={{ display: "none" }}
        />
      </div>
      {parseError && (
        <div
          style={{
            marginTop: "12px",
            padding: "10px 12px",
            borderRadius: "8px",
            background: "rgba(220,38,38,0.06)",
            color: "#b91c1c",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <AlertCircle size={14} />
          {parseError}
        </div>
      )}
      <div
        style={{
          marginTop: "18px",
          padding: "12px 14px",
          background: "#f8f9fa",
          borderRadius: "10px",
          border: "1px solid #eef0f3",
          fontSize: "12px",
          color: "#4b5563",
          lineHeight: 1.55,
        }}
      >
        <div style={{ fontWeight: 600, color: "#111827", marginBottom: "4px" }}>
          Recognized column headers
        </div>
        Name, First name, Last name, Email, Company, Role / Title, LinkedIn, Notes, Tags. Anything
        else is ignored unless you map it manually in the next step.
      </div>
    </div>
  );
}

function MapStep({
  parsed,
  mapping,
  setMappingAt,
  importRows,
  sparseCount,
  aiMode,
  setAiMode,
  hasNameMapping,
  fileName,
  onReset,
}: {
  parsed: ParsedCsv;
  mapping: ImportField[];
  setMappingAt: (index: number, value: ImportField) => void;
  importRows: ImportRow[];
  sparseCount: number;
  aiMode: AiMode;
  setAiMode: (v: AiMode) => void;
  hasNameMapping: boolean;
  fileName: string;
  onReset: () => void;
}) {
  const preview = importRows.slice(0, 5);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "10px 12px",
          borderRadius: "10px",
          background: "#f8f9fa",
          border: "1px solid #eef0f3",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <FileText size={16} style={{ color: "#4f46e5" }} />
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>{fileName}</div>
            <div style={{ fontSize: "11px", color: "#6b7280" }}>
              {parsed.rows.length} data rows · {importRows.length} will import
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: "12px" }}
        >
          <RefreshCw size={12} />
          Change file
        </button>
      </div>

      <section>
        <div style={sectionLabelStyle}>Column mapping</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 180px minmax(0,1fr)",
            gap: "10px 12px",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase" }}>
            CSV column
          </div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase" }}>
            Map to
          </div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase" }}>
            First row sample
          </div>
          {parsed.headers.map((header, idx) => (
            <RowMapping
              key={`${header}-${idx}`}
              header={header || `Column ${idx + 1}`}
              sample={parsed.rows[0]?.[idx] ?? ""}
              value={mapping[idx] ?? "ignore"}
              onChange={(v) => setMappingAt(idx, v)}
            />
          ))}
        </div>
        {!hasNameMapping && (
          <div
            style={{
              marginTop: "10px",
              padding: "8px 10px",
              borderRadius: "8px",
              background: "rgba(217,119,6,0.08)",
              color: "#b45309",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <AlertCircle size={14} />
            Map a <strong>Full name</strong> column (or both First + Last name) to continue.
          </div>
        )}
      </section>

      <section>
        <div style={sectionLabelStyle}>AI enrichment</div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {(
            [
              { id: "auto", label: "Smart (only sparse rows)", hint: `${sparseCount} sparse` },
              { id: "always", label: "Always", hint: "slow · best quality" },
              { id: "never", label: "Never", hint: "fastest" },
            ] as const
          ).map((opt) => {
            const active = aiMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAiMode(opt.id)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "10px",
                  border: `1px solid ${active ? "#4f46e5" : "#e5e7eb"}`,
                  background: active ? "rgba(79,70,229,0.08)" : "#fff",
                  color: active ? "#4f46e5" : "#374151",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  minWidth: "160px",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600 }}>
                  <Sparkles size={12} />
                  {opt.label}
                </div>
                <div style={{ fontSize: "11px", color: active ? "#4f46e5" : "#9ca3af", marginTop: "2px" }}>
                  {opt.hint}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280", lineHeight: 1.55 }}>
          Rows with just a name (missing role/company/LinkedIn) get searched against the web to fill
          in role, company, LinkedIn, and a short bio. Anything you provide in the CSV wins over
          the enriched version.
        </div>
      </section>

      <section>
        <div style={sectionLabelStyle}>Preview (first 5 rows)</div>
        <div style={{ overflowX: "auto", border: "1px solid #eef0f3", borderRadius: "10px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr style={{ background: "#f8f9fa" }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Company</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>AI?</th>
              </tr>
            </thead>
            <tbody>
              {preview.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, color: "#9ca3af", textAlign: "center" }}>
                    No valid rows yet — map a name column above.
                  </td>
                </tr>
              ) : (
                preview.map((r, i) => {
                  const willEnrich =
                    aiMode === "always" || (aiMode === "auto" && r.looksSparse);
                  return (
                    <tr key={i} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: "#111827" }}>{r.name}</td>
                      <td style={tdStyle}>{r.company || <span style={{ color: "#d1d5db" }}>—</span>}</td>
                      <td style={tdStyle}>{r.role || <span style={{ color: "#d1d5db" }}>—</span>}</td>
                      <td style={tdStyle}>{r.email || <span style={{ color: "#d1d5db" }}>—</span>}</td>
                      <td style={tdStyle}>
                        {willEnrich ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "11px",
                              color: "#4f46e5",
                            }}
                          >
                            <Sparkles size={11} />
                            yes
                          </span>
                        ) : (
                          <span style={{ color: "#9ca3af", fontSize: "11px" }}>no</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RowMapping({
  header,
  sample,
  value,
  onChange,
}: {
  header: string;
  sample: string;
  value: ImportField;
  onChange: (v: ImportField) => void;
}) {
  return (
    <>
      <div style={{ fontSize: "13px", color: "#111827", fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {header}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ImportField)}
        style={{
          padding: "6px 8px",
          borderRadius: "6px",
          border: "1px solid #e5e7eb",
          fontSize: "12px",
          background: "#fff",
          color: value === "ignore" ? "#9ca3af" : "#111827",
        }}
      >
        {IMPORT_FIELD_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div style={{ fontSize: "12px", color: "#6b7280", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {sample || <span style={{ color: "#d1d5db" }}>(empty)</span>}
      </div>
    </>
  );
}

function ImportingStep({
  done,
  total,
  summary,
  aiMode,
}: {
  done: number;
  total: number;
  summary: Summary;
  aiMode: AiMode;
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "stretch" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <Loader2 size={16} className="spin" style={{ color: "#4f46e5" }} />
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>
          Importing {done} / {total}
        </div>
      </div>
      <div
        style={{
          height: "8px",
          borderRadius: "999px",
          background: "#eef0f3",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "linear-gradient(90deg, #4f46e5, #7c3aed)",
            transition: "width 200ms ease",
          }}
        />
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <StatPill label="Created" value={summary.created} color="#059669" />
        <StatPill label="Skipped" value={summary.skipped} color="#d97706" />
        <StatPill label="Failed" value={summary.failed} color="#b91c1c" />
        <StatPill label="AI enriched" value={summary.enriched} color="#4f46e5" />
      </div>
      <div style={{ fontSize: "12px", color: "#6b7280", lineHeight: 1.55 }}>
        {aiMode !== "never"
          ? "Web enrichment runs on sparse rows, which adds a few seconds per contact."
          : "AI enrichment is disabled, so this should fly through."}
      </div>
      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function DoneStep({
  summary,
  results,
  fatalError,
  onImportAnother,
}: {
  summary: Summary;
  results: BatchResult[];
  fatalError: string | null;
  onImportAnother: () => void;
}) {
  const failed = results.filter((r) => r.status === "failed");
  const skipped = results.filter((r) => r.status === "skipped_duplicate");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {fatalError ? (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "10px",
            background: "rgba(220,38,38,0.08)",
            color: "#b91c1c",
            fontSize: "13px",
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
          <div>
            <div style={{ fontWeight: 600 }}>Import was interrupted</div>
            <div style={{ fontSize: "12px", marginTop: "2px" }}>{fatalError}</div>
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "10px",
            background: "rgba(5,150,105,0.08)",
            color: "#047857",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <CheckCircle2 size={16} />
          <div>
            <strong>{summary.created}</strong> people added to your CRM
            {summary.enriched > 0 ? ` · ${summary.enriched} enriched via web search` : ""}.
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <StatPill label="Created" value={summary.created} color="#059669" />
        <StatPill label="Skipped" value={summary.skipped} color="#d97706" />
        <StatPill label="Failed" value={summary.failed} color="#b91c1c" />
        <StatPill label="AI enriched" value={summary.enriched} color="#4f46e5" />
      </div>

      {(failed.length > 0 || skipped.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {failed.length > 0 && (
            <details style={detailsStyle}>
              <summary style={summaryStyle}>
                <AlertCircle size={14} style={{ color: "#b91c1c" }} /> {failed.length} failed
              </summary>
              <ul style={listStyle}>
                {failed.map((r, i) => (
                  <li key={i}>
                    <span style={{ fontWeight: 600 }}>{r.name || "(no name)"}</span>
                    {r.reason ? ` — ${r.reason}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {skipped.length > 0 && (
            <details style={detailsStyle}>
              <summary style={summaryStyle}>
                <AlertCircle size={14} style={{ color: "#d97706" }} /> {skipped.length} skipped as duplicates
              </summary>
              <ul style={listStyle}>
                {skipped.map((r, i) => (
                  <li key={i}>
                    <span style={{ fontWeight: 600 }}>{r.name}</span>
                    {r.reason ? ` — ${r.reason}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <button type="button" onClick={onImportAnother} style={{ ...secondaryBtnStyle, alignSelf: "flex-start" }}>
        <Upload size={14} />
        Import another CSV
      </button>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: "10px",
        background: `${color}14`,
        color,
        minWidth: "110px",
      }}
    >
      <div style={{ fontSize: "11px", fontWeight: 600, opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 800, marginTop: "2px" }}>{value}</div>
    </div>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "9px 14px",
  background: "#4f46e5",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "9px 14px",
  background: "#fff",
  color: "#374151",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#9ca3af",
  fontWeight: 600,
  marginBottom: "10px",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: "11px",
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  color: "#4b5563",
  verticalAlign: "top",
};

const detailsStyle: React.CSSProperties = {
  border: "1px solid #eef0f3",
  borderRadius: "8px",
  padding: "8px 12px",
  background: "#fafafa",
};

const summaryStyle: React.CSSProperties = {
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  fontSize: "12px",
  color: "#374151",
  fontWeight: 600,
};

const listStyle: React.CSSProperties = {
  margin: "8px 0 0",
  paddingLeft: "18px",
  fontSize: "12px",
  color: "#4b5563",
  lineHeight: 1.6,
};
