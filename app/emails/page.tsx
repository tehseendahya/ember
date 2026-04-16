import { Mail, TrendingUp, Clock, MessageSquare, Zap, Bell, ExternalLink, CheckCircle, Eye, AlertCircle } from "lucide-react";
import { getEmailStats } from "@/lib/data";
import EmailCharts from "@/components/EmailCharts";

const COLORS = {
  accent: "#4f46e5",
  green: "#059669",
  yellow: "#d97706",
  red: "#dc2626",
  blue: "#3b82f6",
};

function StatCard({
  icon,
  label,
  value,
  sub,
  color,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  color: string;
  trend?: string;
}) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: `${color}0d`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
        {trend && (
          <span style={{ fontSize: "12px", fontWeight: "600", color: trend.startsWith("+") ? "#059669" : "#dc2626", background: trend.startsWith("+") ? "rgba(5, 150, 105, 0.06)" : "rgba(220, 38, 38, 0.06)", padding: "3px 8px", borderRadius: "20px" }}>
            {trend}
          </span>
        )}
      </div>
      <div>
        <div style={{ fontSize: "30px", fontWeight: "800", color: "#111827", lineHeight: 1, marginBottom: "4px", letterSpacing: "-1px" }}>{value}</div>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "#6b7280", marginBottom: "2px" }}>{label}</div>
        <div style={{ fontSize: "12px", color: "#9ca3af" }}>{sub}</div>
      </div>
    </div>
  );
}

export default async function EmailsPage() {
  const emailStats = await getEmailStats();
  return (
    <div className="emails-container" style={{ padding: "32px 40px", maxWidth: "1400px" }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "800", color: "#111827", letterSpacing: "-0.5px", marginBottom: "8px" }}>
          Email Analytics
        </h1>
        <p style={{ fontSize: "14px", color: "#9ca3af" }}>
          Insights into your email performance and relationship health
        </p>
      </div>

      {/* Stats Row */}
      <div className="email-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "28px" }}>
        <StatCard icon={<Mail size={18} style={{ color: COLORS.accent }} />} label="Emails Sent" value={emailStats.totalSent} sub="this month" color={COLORS.accent} trend="+23%" />
        <StatCard icon={<Eye size={18} style={{ color: COLORS.green }} />} label="Open Rate" value={`${emailStats.openRate}%`} sub="industry avg: 21%" color={COLORS.green} trend="+12%" />
        <StatCard icon={<MessageSquare size={18} style={{ color: COLORS.yellow }} />} label="Response Rate" value={`${emailStats.responseRate}%`} sub="warm emails: 78%" color={COLORS.yellow} trend="+8%" />
        <StatCard icon={<Clock size={18} style={{ color: COLORS.blue }} />} label="Avg Response" value={`${emailStats.avgResponseTime}h`} sub="time to reply" color={COLORS.blue} trend="-0.8h" />
      </div>

      {/* Charts (lazy-loaded) */}
      <EmailCharts emailStats={emailStats} />

      {/* Insights + Recent Emails row */}
      <div className="email-two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
        {/* Insights */}
        <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "24px" }}>
          <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#111827", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <Zap size={15} style={{ color: "#d97706" }} />
            AI Insights
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              { icon: "\u{1F3AF}", title: "Your cold emails to founders have a 34% response rate \u2014 2x the industry average", color: COLORS.accent },
              { icon: "\u23F0", title: "Tuesday 9\u201311am is your golden window \u2014 67% open rate vs. 38% other times", color: COLORS.yellow },
              { icon: "\u26A0\uFE0F", title: "3 contacts haven't heard from you in 60+ days: Nina, James & Sofia", cta: "View contacts", color: COLORS.red },
              { icon: "\u26A1", title: "Sarah Chen responds fastest \u2014 usually within 2 hours of receiving your email", color: COLORS.green },
              { icon: "\u{1F4C8}", title: "Follow-ups sent 3 days after initial have 2.4x higher conversion rate", color: COLORS.blue },
            ].map(({ icon, title, cta, color }) => (
              <div key={title} style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", background: "#f8f9fa", borderRadius: "10px", border: `1px solid ${color}15` }}>
                <span style={{ fontSize: "20px", flexShrink: 0 }}>{icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: "13px", color: "#6b7280", lineHeight: "1.5" }}>{title}</p>
                  {cta && (
                    <span style={{ display: "inline-block", marginTop: "8px", padding: "4px 10px", background: `${color}0d`, border: `1px solid ${color}20`, borderRadius: "5px", color, fontSize: "11px", fontWeight: "600" }}>
                      {cta}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Email Feed */}
        <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "24px" }}>
          <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#111827", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <Mail size={15} style={{ color: "#4f46e5" }} />
            Recent Emails
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {emailStats.recentEmails.map((email) => (
              <div key={email.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px", background: "#f8f9fa", borderRadius: "8px" }}>
                <div style={{ width: "34px", height: "34px", borderRadius: "50%", background: email.avatarColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "white", flexShrink: 0 }}>
                  {email.avatar}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {email.subject}
                  </div>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                    {email.contact} \u00b7 {new Date(email.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <Eye size={12} style={{ color: email.opened ? "#059669" : "#d1d5db" }} />
                    {email.replied ? <CheckCircle size={12} style={{ color: "#4f46e5" }} /> : <MessageSquare size={12} style={{ color: "#d1d5db" }} />}
                  </div>
                  <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: email.type === "received" ? "rgba(5, 150, 105, 0.06)" : "rgba(79, 70, 229, 0.06)", color: email.type === "received" ? "#059669" : "#4f46e5" }}>
                    {email.type}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mail Tracker */}
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "24px" }}>
        <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#111827", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
          <Bell size={15} style={{ color: "#d97706" }} />
          Mail Tracker & Follow-up Suggestions
        </h3>
        <div className="tracker-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          {emailStats.trackerItems.map((item) => (
            <div key={item.id} style={{ padding: "16px", background: "#f8f9fa", borderRadius: "10px", border: `1px solid ${item.urgency === "high" ? "rgba(220, 38, 38, 0.15)" : item.urgency === "medium" ? "rgba(217, 119, 6, 0.15)" : "rgba(79, 70, 229, 0.1)"}` }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "12px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: item.avatarColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "white", flexShrink: 0 }}>
                  {item.avatar}
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", marginBottom: "2px" }}>{item.contact}</div>
                  <div style={{ fontSize: "12px", color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "160px" }}>{item.subject}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
                <Eye size={13} style={{ color: item.openCount > 0 ? "#059669" : "#d1d5db" }} />
                <span style={{ fontSize: "12px", color: "#6b7280" }}>{item.openCount > 0 ? `Opened ${item.openCount}x` : "Not opened yet"}</span>
                {item.lastOpened && <span style={{ fontSize: "11px", color: "#9ca3af", marginLeft: "auto" }}>{item.daysAgo}d ago</span>}
              </div>
              <div style={{ padding: "8px 10px", background: item.urgency === "high" ? "rgba(220, 38, 38, 0.04)" : item.urgency === "medium" ? "rgba(217, 119, 6, 0.04)" : "rgba(79, 70, 229, 0.04)", borderRadius: "6px", fontSize: "12px", color: item.urgency === "high" ? "#dc2626" : item.urgency === "medium" ? "#d97706" : "#4f46e5", display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
                {item.urgency === "high" ? <AlertCircle size={12} /> : item.urgency === "medium" ? <Bell size={12} /> : <TrendingUp size={12} />}
                {item.suggestion}
              </div>
              <div style={{ width: "100%", padding: "8px", background: "rgba(79, 70, 229, 0.06)", border: "1px solid rgba(79, 70, 229, 0.12)", borderRadius: "7px", color: "#4f46e5", fontSize: "12px", fontWeight: "600", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", cursor: "pointer" }}>
                <ExternalLink size={12} />
                Draft Follow-up
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .emails-container { padding: 20px 16px !important; }
          .email-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .email-two-col { grid-template-columns: 1fr !important; }
          .tracker-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 480px) {
          .email-stats-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
