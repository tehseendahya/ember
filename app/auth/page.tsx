"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { GoogleGMark } from "./GoogleGMark";
import styles from "./auth.module.css";

function AuthForm() {
  const searchParams = useSearchParams();
  const next = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const urlMessage = useMemo(() => searchParams.get("message"), [searchParams]);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const feedback = status ?? urlMessage;
  const [oauthLoading, setOauthLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);

  const busy = oauthLoading || emailLoading;

  async function onGoogleSignIn() {
    setOauthLoading(true);
    setStatus(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        setStatus(error.message);
      }
    } finally {
      setOauthLoading(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setEmailLoading(true);
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
      setEmailLoading(false);
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.atmosphere} aria-hidden />
      <div className={styles.card}>
        <p className={styles.eyebrow}>Welcome back</p>
        <h1 className={styles.title}>Sign in to Ember</h1>
        <p className={styles.subtitle}>
          Use your Google account for instant access, or request a one-time link by email.
        </p>

        <button
          type="button"
          className={styles.googleButton}
          onClick={onGoogleSignIn}
          disabled={busy}
          aria-busy={oauthLoading}
        >
          {oauthLoading ? (
            <span className={styles.spinner} aria-hidden />
          ) : (
            <span className={styles.googleIcon}>
              <GoogleGMark />
            </span>
          )}
          <span className={styles.googleLabel}>{oauthLoading ? "Opening Google…" : "Continue with Google"}</span>
        </button>

        <div className={styles.divider}>
          <span>Or email</span>
        </div>

        <form className={styles.form} onSubmit={onSubmit}>
          <input
            className={styles.input}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <button className={styles.submit} type="submit" disabled={busy}>
            {emailLoading ? "Sending link…" : "Send magic link"}
          </button>
        </form>

        {feedback ? (
          <p className={styles.feedback} role="status">
            {feedback}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AuthLoading() {
  return (
    <div className={styles.shell}>
      <div className={styles.atmosphere} aria-hidden />
      <div className={styles.fallbackInner} aria-hidden />
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <AuthForm />
    </Suspense>
  );
}
