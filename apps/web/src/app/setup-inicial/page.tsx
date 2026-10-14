"use client";

import { FormEvent, useState } from "react";

class SetupRequestError extends Error {
  constructor(readonly code: string, readonly requestId?: string) {
    super(code);
  }
}

export default function InitialSetupPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const completeSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(""); setSubmitting(true);
    try {
      const response = await request("/v1/bootstrap/super-admin/complete", {
        bootstrapToken: token, email, displayName, organizationName, password
      });
      setPassword(""); setToken("");
      window.location.assign("/");
    } catch (error) {
      setError(messageForSetupError(error, "complete"));
    } finally { setSubmitting(false); }
  };

  return <main className="auth-shell"><section className="auth-card" aria-labelledby="setup-title">
    <div className="auth-brand"><span className="brand-mark">b</span><strong>bruma</strong></div>
    <div className="auth-copy"><span className="eyebrow">ACTIVACIÓN INICIAL</span><h1 id="setup-title">Creá tu acceso</h1><p>Este paso sólo funciona una vez. Tus datos y contraseña se envían cifrados y no se guardan en el navegador.</p></div>
    <form className="auth-form" onSubmit={completeSetup}>
      <label>Código de activación<input value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required /></label>
      <label>Correo electrónico<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></label>
      <label>Tu nombre<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required /></label>
      <label>Nombre del comercio<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required /></label>
      <label>Contraseña<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} required /><small>Usá una contraseña única de al menos 12 caracteres.</small></label>
      <button className="auth-submit" disabled={submitting}>{submitting ? "Activando…" : "Activar superusuario"}</button>
    </form>
    {error && <p className="auth-error" role="alert">{error}</p>}
  </section></main>;
}

async function request(path: string, body: Record<string, string>): Promise<unknown> {
  const response = await fetch(`/api/backend${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as { data?: unknown; error?: { code?: string }; requestId?: string } | null;
  if (!response.ok) throw new SetupRequestError(payload?.error?.code ?? "request_failed", payload?.requestId);
  return payload?.data;
}

function messageForSetupError(error: unknown, step: "start" | "complete"): string {
  if (!(error instanceof SetupRequestError)) return "No pudimos conectarnos con el servicio. Intentá nuevamente en unos instantes.";
  if (error.code === "unauthenticated" && step === "complete") {
    return "No pudimos validar los datos de activación.";
  }
  if (error.code === "not_found") return "El código de activación ya no está disponible. Verificá que sea el correcto.";
  if (error.code === "service_unavailable") return "El servicio no está disponible en este momento. Intentá nuevamente en unos instantes.";
  const reference = error.requestId ? ` Referencia: ${error.requestId}.` : "";
  return `No pudimos completar la activación.${reference}`;
}
