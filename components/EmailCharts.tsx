"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { EmailStats } from "@/lib/types";

const chartTheme = {
  background: "transparent",
  text: "#6b7280",
  grid: "#f3f4f6",
  tooltip: {
    contentStyle: {
      background: "#ffffff",
      border: "1px solid #e5e7eb",
      borderRadius: "8px",
      color: "#111827",
      fontSize: "13px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    },
    labelStyle: { color: "#6b7280" },
  },
};

const heatmapDays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const heatmapHours = ["9am", "10am", "11am", "2pm", "3pm"];

function getHeatmapCell(emailStats: EmailStats, day: string, hour: string) {
  const found = emailStats.heatmapData.find((d) => d.day === day && d.hour === hour);
  return found?.rate || 0;
}

function getHeatColor(rate: number) {
  if (rate >= 65) return "#4f46e5";
  if (rate >= 55) return "#6366f1";
  if (rate >= 48) return "#a5b4fc";
  if (rate >= 40) return "#c7d2fe";
  return "#eef2ff";
}

export default function EmailCharts({ emailStats }: { emailStats: EmailStats }) {
  return (
    <>
      {/* Charts Row 1 */}
      <div className="chart-row-1" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "20px", marginBottom: "20px" }}>
        <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "24px" }}>
          <div style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#111827", marginBottom: "4px" }}>
              Email Activity
            </h3>
            <p style={{ fontSize: "13px", color: "#9ca3af" }}>Sent & received per week, last 12 weeks</p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={emailStats.weeklyData}>
              <defs>
                <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="recvGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="week" tick={{ fill: chartTheme.text, fontSize: 11 }} axisLine={{ stroke: chartTheme.grid }} tickLine={false} />
              <YAxis tick={{ fill: chartTheme.text, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={chartTheme.tooltip.contentStyle} labelStyle={chartTheme.tooltip.labelStyle} />
              <Legend wrapperStyle={{ fontSize: "12px", color: "#6b7280" }} />
              <Area type="monotone" dataKey="sent" stroke="#4f46e5" strokeWidth={2} fill="url(#sentGrad)" name="Sent" />
              <Area type="monotone" dataKey="received" stroke="#059669" strokeWidth={2} fill="url(#recvGrad)" name="Received" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "24px" }}>
          <div style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#111827", marginBottom: "4px" }}>
              Response Rates by Type
            </h3>
            <p style={{ fontSize: "13px", color: "#9ca3af" }}>How different email types perform</p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={emailStats.responseRateByType} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
              <XAxis type="number" tick={{ fill: chartTheme.text, fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="type" tick={{ fill: chartTheme.text, fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
              <Tooltip contentStyle={chartTheme.tooltip.contentStyle} labelStyle={chartTheme.tooltip.labelStyle} formatter={(val) => [`${val}%`, "Response Rate"]} />
              <Bar dataKey="rate" fill="#4f46e5" radius={[0, 4, 4, 0]} name="Response Rate" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="chart-row-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
        {/* Heatmap */}
        <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "24px" }}>
          <div style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#111827", marginBottom: "4px" }}>Best Time to Send</h3>
            <p style={{ fontSize: "13px", color: "#9ca3af" }}>Open rate by day and hour</p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: "300px" }}>
              <div style={{ display: "flex", marginLeft: "48px", marginBottom: "8px" }}>
                {heatmapHours.map((h) => (
                  <div key={h} style={{ flex: 1, textAlign: "center", fontSize: "11px", color: "#9ca3af", fontWeight: "500" }}>{h}</div>
                ))}
              </div>
              {heatmapDays.map((day) => (
                <div key={day} style={{ display: "flex", alignItems: "center", marginBottom: "6px" }}>
                  <div style={{ width: "40px", fontSize: "12px", color: "#9ca3af", fontWeight: "500", flexShrink: 0 }}>{day}</div>
                  {heatmapHours.map((hour) => {
                    const rate = getHeatmapCell(emailStats, day, hour);
                    return (
                      <div
                        key={hour}
                        title={`${day} ${hour}: ${rate}% open rate`}
                        style={{
                          flex: 1, height: "36px", margin: "0 2px", borderRadius: "6px",
                          background: getHeatColor(rate), display: "flex", alignItems: "center",
                          justifyContent: "center", fontSize: "11px", fontWeight: "600",
                          color: rate >= 55 ? "white" : "#4f46e5",
                          border: "1px solid rgba(0,0,0,0.04)",
                        }}
                      >
                        {rate}%
                      </div>
                    );
                  })}
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "14px", paddingLeft: "48px" }}>
                <span style={{ fontSize: "11px", color: "#9ca3af" }}>Low</span>
                {["#eef2ff", "#c7d2fe", "#a5b4fc", "#6366f1", "#4f46e5"].map((c) => (
                  <div key={c} style={{ width: "20px", height: "12px", borderRadius: "3px", background: c }} />
                ))}
                <span style={{ fontSize: "11px", color: "#9ca3af" }}>High</span>
              </div>
            </div>
          </div>
        </div>

        {/* Relationship Health */}
        <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "24px" }}>
          <div style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#111827", marginBottom: "4px" }}>Relationship Health</h3>
            <p style={{ fontSize: "13px", color: "#9ca3af" }}>Engagement score for top 5 contacts</p>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={emailStats.relationshipHealth}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="month" tick={{ fill: chartTheme.text, fontSize: 11 }} axisLine={{ stroke: chartTheme.grid }} tickLine={false} />
              <YAxis tick={{ fill: chartTheme.text, fontSize: 11 }} axisLine={false} tickLine={false} domain={[40, 100]} />
              <Tooltip contentStyle={chartTheme.tooltip.contentStyle} labelStyle={chartTheme.tooltip.labelStyle} />
              <Legend wrapperStyle={{ fontSize: "11px", color: "#6b7280" }} />
              <Line type="monotone" dataKey="Justin" stroke="#4f46e5" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Sarah" stroke="#059669" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Ben" stroke="#d97706" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="David" stroke="#ec4899" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Lisa" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .chart-row-1 { grid-template-columns: 1fr !important; }
          .chart-row-2 { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}
