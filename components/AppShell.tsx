"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import CommandBar from "@/components/CommandBar";

/** Auth (sign-in) routes: no sidebar — full-width centered content for logged-out users. */
function isAuthRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/auth") return true;
  if (pathname.startsWith("/auth/")) return true;
  return false;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideSidebar = isAuthRoute(pathname);

  const shell = (
    <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
      {!hideSidebar ? <Sidebar /> : null}
      <main
        style={{
          flex: 1,
          minHeight: "100vh",
          minWidth: 0,
          overflowY: "auto",
          width: hideSidebar ? "100%" : undefined,
        }}
      >
        {children}
      </main>
    </div>
  );

  if (hideSidebar) return shell;
  return <CommandBar>{shell}</CommandBar>;
}
