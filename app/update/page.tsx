import { Clock } from "lucide-react";
import { getRecentUpdates } from "@/lib/data";
import UpdateForm from "@/components/UpdateForm";

export const dynamic = "force-dynamic";

export default async function UpdatePage() {
  const recentUpdates = await getRecentUpdates();
  return (
    <div className="update-container" style={{ padding: "32px 40px", maxWidth: "900px" }}>
      {/* Header */}
      <div style={{ marginBottom: "36px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "800", color: "#111827", letterSpacing: "-0.5px", marginBottom: "8px" }}>
          Update Your Network
        </h1>
        <p style={{ fontSize: "14px", color: "#9ca3af" }}>
          Tell me what happened — I&apos;ll update your CRM automatically using AI
        </p>
      </div>

      {/* Interactive form (client component) */}
      <UpdateForm />

      {/* Recent Updates Feed — server-rendered, no JS needed */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <Clock size={16} style={{ color: "#9ca3af" }} />
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#111827" }}>Recent Updates</h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {recentUpdates.map((update) => (
            <div key={update.id} style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "16px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <p style={{ fontSize: "14px", color: "#111827", fontStyle: "italic", flex: 1, marginRight: "12px" }}>
                  &ldquo;{update.input}&rdquo;
                </p>
                <span style={{ fontSize: "12px", color: "#9ca3af", flexShrink: 0 }}>
                  {new Date(update.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {update.actions.map((action, idx) => (
                  <span key={idx} style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "4px", background: "rgba(79, 70, 229, 0.06)", color: "#4f46e5", border: "1px solid rgba(79, 70, 229, 0.1)" }}>
                    {action}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .update-container { padding: 20px 16px !important; }
        }
      `}</style>
    </div>
  );
}
