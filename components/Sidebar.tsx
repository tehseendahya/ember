"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Settings, Circle, Menu, X, Sun, Compass } from "lucide-react";
import { useState, useEffect } from "react";

const navItems = [
  { href: "/", icon: Sun, label: "Home" },
  { href: "/people", icon: Users, label: "People" },
  { href: "/discover", icon: Compass, label: "Discover" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // Close the mobile drawer after navigation; defer so we do not synchronously
    // cascade renders in the effect body (see react-hooks/set-state-in-effect).
    const id = requestAnimationFrame(() => setMobileOpen(false));
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div
        style={{
          padding: "24px 20px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            <Circle
              size={10}
              style={{
                position: "absolute",
                top: "4px",
                right: "2px",
                color: "#fff",
                fill: "white",
              }}
            />
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "white",
              }}
            />
          </div>
          <span
            style={{
              fontSize: "20px",
              fontWeight: "700",
              background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              letterSpacing: "-0.5px",
            }}
          >
            Ember
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: "16px 12px" }}>
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href}>
                <Link
                  href={href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    textDecoration: "none",
                    fontSize: "14px",
                    fontWeight: isActive ? "600" : "400",
                    color: isActive ? "#111827" : "#6b7280",
                    background: isActive
                      ? "rgba(79, 70, 229, 0.08)"
                      : "transparent",
                    borderLeft: isActive
                      ? "2px solid #4f46e5"
                      : "2px solid transparent",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "rgba(0,0,0,0.04)";
                      e.currentTarget.style.color = "#111827";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "#6b7280";
                    }
                  }}
                >
                  <Icon
                    size={18}
                    style={{
                      color: isActive ? "#4f46e5" : "currentColor",
                      flexShrink: 0,
                    }}
                  />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User section */}
      <div
        style={{
          padding: "16px 12px",
          borderTop: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "13px",
              fontWeight: "700",
              color: "white",
              flexShrink: 0,
            }}
          >

          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
              Tehseen
            </div>
            <div style={{ fontSize: "11px", color: "#9ca3af" }}>Personal CRM</div>
          </div>
        </div>
        <Link
          href="/settings"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#9ca3af",
            padding: "4px",
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#111827";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#9ca3af";
          }}
        >
          <Settings size={16} />
        </Link>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        style={{
          position: "fixed",
          top: "16px",
          left: "16px",
          zIndex: 50,
          width: "40px",
          height: "40px",
          borderRadius: "10px",
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          display: "none",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#111827",
        }}
        className="mobile-menu-btn"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            zIndex: 55,
            display: "none",
          }}
          className="mobile-overlay"
        />
      )}

      {/* Desktop sidebar */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "240px",
          height: "100vh",
          background: "#ffffff",
          borderRight: "1px solid #e5e7eb",
          display: "flex",
          flexDirection: "column",
          zIndex: 60,
        }}
        className="sidebar-desktop"
      >
        {sidebarContent}
      </aside>

      {/* Mobile sidebar drawer */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          left: mobileOpen ? "0" : "-280px",
          width: "280px",
          height: "100vh",
          background: "#ffffff",
          borderRight: "1px solid #e5e7eb",
          display: "none",
          flexDirection: "column",
          zIndex: 60,
          transition: "left 0.25s ease",
          boxShadow: mobileOpen ? "4px 0 16px rgba(0,0,0,0.1)" : "none",
        }}
        className="sidebar-mobile"
      >
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#6b7280",
            zIndex: 61,
          }}
        >
          <X size={20} />
        </button>
        {sidebarContent}
      </aside>

      {/* Responsive styles */}
      <style>{`
        .sidebar-desktop { display: flex !important; }
        .sidebar-mobile { display: none !important; }
        .mobile-menu-btn { display: none !important; }
        .mobile-overlay { display: none !important; }
        main { margin-left: 240px; }

        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .sidebar-mobile { display: flex !important; }
          .mobile-menu-btn { display: flex !important; }
          .mobile-overlay { display: ${mobileOpen ? "block" : "none"} !important; }
          main { margin-left: 0 !important; padding-top: 60px; }
        }
      `}</style>
    </>
  );
}
