"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SocialOsLoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/social-os/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
      });
      const payload = (await response.json()) as {
        error?: string;
        redirectPath?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to sign in.");
      }

      router.push(payload.redirectPath ?? "/social-os");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="social-os-login-form" onSubmit={handleSubmit}>
      <div className="social-os-auth-grid">
        <label className="field">
          <span>Username</span>
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Enter your workspace username"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
          />
        </label>
      </div>
      {error ? <p className="error-text social-os-inline-error">{error}</p> : null}
      <div className="social-os-auth-actions">
        <button className="sync-button" type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Enter Social OS"}
        </button>
        <p className="empty-state">
          Access is protected with Supabase auth, secure cookies, and client-specific workspace isolation.
        </p>
      </div>
    </form>
  );
}
