"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellPlus } from "lucide-react";

type Preset = { label: string; days: number };

const PRESETS: Preset[] = [
  { label: "In 1 week", days: 7 },
  { label: "In 2 weeks", days: 14 },
  { label: "In 1 month", days: 30 },
  { label: "In 3 months", days: 90 },
  { label: "In 6 months", days: 180 },
  { label: "In 1 year", days: 365 },
];

export default function SchedulePingButton({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customDays, setCustomDays] = useState("");
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function schedule(days: number) {
    if (!days || days < 1) return;
    setPending(true);
    try {
      const res = await fetch("/api/crm/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "schedule_reminder",
          contactId,
          days,
          text: `Ping ${contactName}`,
        }),
      });
      if (res.ok) {
        setOpen(false);
        setCustomDays("");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "13px",
          fontWeight: 600,
          color: "#4f46e5",
          background: "rgba(79, 70, 229, 0.08)",
          border: "1px solid rgba(79, 70, 229, 0.2)",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
        }}
      >
        <BellPlus size={14} />
        Schedule ping
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            padding: "8px",
            minWidth: "220px",
            zIndex: 20,
          }}
        >
          {PRESETS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => void schedule(p.days)}
              disabled={pending}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: "8px 10px",
                borderRadius: "6px",
                cursor: pending ? "wait" : "pointer",
                fontSize: "13px",
                color: "#111827",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#f3f4f6";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {p.label}
            </button>
          ))}
          <div
            style={{
              display: "flex",
              gap: "6px",
              padding: "8px 8px 2px",
              borderTop: "1px solid #f3f4f6",
              marginTop: "4px",
            }}
          >
            <input
              type="number"
              min={1}
              placeholder="Days"
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              style={{
                width: "80px",
                fontSize: "13px",
                padding: "6px 8px",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => void schedule(Number(customDays))}
              disabled={pending || !customDays}
              style={{
                flex: 1,
                fontSize: "12px",
                fontWeight: 600,
                color: "#fff",
                background: pending || !customDays ? "#9ca3af" : "#4f46e5",
                border: "none",
                borderRadius: "6px",
                padding: "6px 10px",
                cursor: pending || !customDays ? "not-allowed" : "pointer",
              }}
            >
              Schedule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
