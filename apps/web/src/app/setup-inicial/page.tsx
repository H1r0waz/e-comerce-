"use client";

import { FormEvent, useState } from "react";

type Enrollment = { secret: string; otpauthUri: string };

export default function InitialSetupPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const startEnrollment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(""); setSubmitting(true);
    try {
      const response = await request("/v1/bootstrap/super-admin/start", { bootstrapToken: token });
      setEnrollment(response as Enrollment);
    } catch {
      setError("No pudimos iniciar la activación. Revisá el código de acceso.");
    } finally { setSubmitting(false); }
  };

  const completeSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!enrollment) return;
    setError(""); setSubmitting(true);
    try {
      const response = await request("/v1/bootstrap/super-admin/complete", {
        bootstrapToken: token, email, displayName, organizationName, password,
        totpSecret: enrollment.secret, totpCode,
      });
      setPassword(""); setToken("");
      setRecoveryCodes((response as { recoveryCodes: string[] }).recoveryCodes);
    } catch {
      setError("No pudimos completar la activación. Revisá el código de tu autenticador.");
    } finally { setSubmitting(false); }
  };

  if (recoveryCodes) return <main className="auth-shell"><section className="auth-card" aria-labelledby="setup-complete-title">
    <div className="auth-brand"><span className="brand-mark">b</span><strong>bruma</strong></div>
    <div className="auth-copy"><span className="eyebrow">CUENTA ACTIVADA</span><h1 id="setup-complete-title">Guardá tus códigos de recuperación</h1><p>Usá cada código una sola vez si perdés el acceso a tu autenticador. No los compartas.</p></div>
    <code className="auth-notice" style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{recoveryCodes.join("\n")}</code>
    <a className="auth-submit" href="/">Ir a iniciar sesión</a>
  </section></main>;

  return <main className="auth-shell"><section className="auth-card" aria-labelledby="setup-title">
    <div className="auth-brand"><span className="brand-mark">b</span><strong>bruma</strong></div>
    <div className="auth-copy"><span className="eyebrow">ACTIVACIÓN INICIAL</span><h1 id="setup-title">Creá tu acceso seguro</h1><p>Este paso sólo funciona una vez. Tus datos y contraseña se envían cifrados y no se guardan en el navegador.</p></div>
    {!enrollment ? <form className="auth-form" onSubmit={startEnrollment}>
      <label>Código de activación<input value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required /></label>
      <button className="auth-submit" disabled={submitting}>{submitting ? "Preparando…" : "Configurar autenticador"}</button>
    </form> : <form className="auth-form" onSubmit={completeSetup}>
      <p className="auth-notice">En tu app autenticadora, agregá una cuenta manual con el nombre <strong>Comerciar</strong> y esta clave: <code>{enrollment.secret}</code>. Luego ingresá el código de seis dígitos.</p>
      <label>Correo electrónico<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></label>
      <label>Tu nombre<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required /></label>
      <label>Nombre del comercio<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required /></label>
      <label>Contraseña<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} required /><small>Usá una contraseña única de al menos 12 caracteres.</small></label>
      <label>Código del autenticador<input value={totpCode} onChange={(event) => setTotpCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label>
      <button className="auth-submit" disabled={submitting}>{submitting ? "Activando…" : "Activar superusuario"}</button>
    </form>}
    {error && <p className="auth-error" role="alert">{error}</p>}
  </section></main>;
}

async function request(path: string, body: Record<string, string>): Promise<unknown> {
  const response = await fetch(`/api/backend${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as { data?: unknown } | null;
  if (!response.ok) throw new Error("setup_failed");
  return payload?.data;
}
