"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function AuthForm() {
  const searchParams = useSearchParams();
  const next = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        setStatus(error.message);
      } else {
        setStatus("Check your email for the sign-in link.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form onSubmit={onSubmit} style={{ width: "100%", maxWidth: 420, border: "1px solid #e5e7eb", borderRadius: 12, padding: 24 }}>
        <h1 style={{ marginBottom: 8 }}>Sign in to Ember</h1>
        <p style={{ marginBottom: 16, color: "#6b7280" }}>Use your email magic link to access your CRM.</p>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, marginBottom: 12 }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "none", background: "#4f46e5", color: "white" }}
        >
          {loading ? "Sending..." : "Send magic link"}
        </button>
        {status ? <p style={{ marginTop: 12, color: "#374151" }}>{status}</p> : null}
      </form>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>Loading...</div>}>
      <AuthForm />
    </Suspense>
  );
}
