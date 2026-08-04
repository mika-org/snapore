"use client";

import { Aperture, ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });
      const payload = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok) throw new Error(payload.error ?? "Login gagal.");
      router.replace(payload.redirectTo ?? "/admin");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login gagal.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="kiosk-brand"><span><Aperture size={20} strokeWidth={3} /></span> SNAPORE</div>
        <div><span className="eyebrow">Multi-tenant control plane</span><h1>Every booth.<br /><em>One view.</em></h1><p>Kelola tenant, perangkat, frame, pembayaran, dan laba bersih dari satu akun yang aman.</p></div>
        <small>Local-first photobooth operations</small>
      </section>
      <section className="login-form-panel">
        <form onSubmit={submit}>
          <div className="login-lock"><LockKeyhole size={22} /></div>
          <span className="eyebrow">Secure access</span>
          <h2>Masuk ke Snapore</h2>
          <p>Gunakan akun super admin atau akun tenant yang diberikan.</p>
          <label><span>Email</span><input name="email" type="email" autoComplete="username" required placeholder="admin@tenant.com" /></label>
          <label><span>Password</span><input name="password" type="password" autoComplete="current-password" required minLength={8} /></label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button type="submit" className="start-button" disabled={loading}>{loading ? <LoaderCircle className="spin" size={20} /> : <>Login <ArrowRight size={20} /></>}</button>
        </form>
      </section>
    </main>
  );
}
