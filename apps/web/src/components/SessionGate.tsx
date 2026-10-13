"use client";

import { FormEvent, createContext, useContext, useEffect, useMemo, useState } from "react";
import { commerceApi, usingMockApi } from "../lib/api/client";
import type { CommerceApi, CommerceSession } from "../lib/api/types";

type SessionContextValue = {
  api: CommerceApi;
  session: CommerceSession;
  signOut: () => Promise<void>;
  usingMockApi: boolean;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useCommerceSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useCommerceSession debe usarse dentro de SessionGate.");
  return value;
}

export function SessionGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<CommerceSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"login" | "invitation">("login");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    commerceApi.getSession()
      .then((current) => { if (!cancelled) setSession(current); })
      .catch(() => { if (!cancelled) setError("No pudimos verificar tu sesión. Probá de nuevo."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const signOut = async () => {
    await commerceApi.signOut();
    setSession(null);
    setMode("login");
  };

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError(""); setSubmitting(true);
    try {
      const current = await commerceApi.signIn({ email: String(values.get("email") ?? ""), password: String(values.get("password") ?? "") });
      setSession(current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No pudimos iniciar sesión."); }
    finally { setSubmitting(false); }
  };

  const submitInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError(""); setSubmitting(true);
    try {
      const current = await commerceApi.acceptInvitation({
        invitationToken: String(values.get("token") ?? ""),
        displayName: String(values.get("displayName") ?? ""),
        password: String(values.get("password") ?? ""),
      });
      setSession(current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No pudimos activar tu acceso."); }
    finally { setSubmitting(false); }
  };

  const contextValue = useMemo(() => session ? { api: commerceApi, session, signOut, usingMockApi } : null, [session]);
  if (loading) return <main className="auth-shell"><p className="auth-loading" role="status">Verificando sesión segura…</p></main>;
  if (!contextValue) return <AuthScreen mode={mode} setMode={setMode} error={error} submitting={submitting} onLogin={submitLogin} onInvitation={submitInvitation} />;
  return <SessionContext.Provider value={contextValue}>{children}</SessionContext.Provider>;
}

function AuthScreen({
  mode, setMode, error, submitting, onLogin, onInvitation,
}: {
  mode: "login" | "invitation";
  setMode: (value: "login" | "invitation") => void;
  error: string;
  submitting: boolean;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onInvitation: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="auth-title">
    <div className="auth-brand"><span className="brand-mark">b</span><strong>bruma</strong></div>
    {usingMockApi && <p className="demo-notice"><strong>Demostración local.</strong> Los datos no se guardan ni se envían a producción.</p>}
    <div className="auth-copy"><span className="eyebrow">ACCESO SEGURO</span><h1 id="auth-title">{mode === "login" ? "Ingresá a tu comercio" : "Activá tu invitación"}</h1><p>{mode === "login" ? "Usá el correo con el que fuiste invitado." : "Creá una contraseña personal para comenzar."}</p></div>
    <div className="auth-tabs" role="tablist" aria-label="Opciones de acceso"><button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Ingresar</button><button role="tab" aria-selected={mode === "invitation"} className={mode === "invitation" ? "active" : ""} onClick={() => setMode("invitation")}>Tengo invitación</button></div>
    {mode === "login" ? <form className="auth-form" onSubmit={onLogin} noValidate>
      <label>Correo electrónico<input name="email" type="email" autoComplete="email" required placeholder="vos@comercio.com" /></label>
      <label>Contraseña<input name="password" type="password" autoComplete="current-password" required minLength={12} placeholder="Tu contraseña" /></label>
      <button className="auth-submit" disabled={submitting}>{submitting ? "Ingresando…" : usingMockApi ? "Ingresar a la demostración" : "Ingresar"}</button>
    </form> : <form className="auth-form" onSubmit={onInvitation} noValidate>
      <label>Token de invitación<input name="token" autoComplete="one-time-code" required placeholder="Pegá el token de tu invitación" /></label>
      <label>Tu nombre<input name="displayName" autoComplete="name" required placeholder="Cómo querés que te llamemos" /></label>
      <label>Elegí una contraseña<input name="password" type="password" autoComplete="new-password" required minLength={12} placeholder="Mínimo 12 caracteres" /><small>Usá una contraseña única de al menos 12 caracteres.</small></label>
      <button className="auth-submit" disabled={submitting}>{submitting ? "Activando…" : "Activar acceso"}</button>
    </form>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <p className="auth-footnote">Por seguridad, no almacenamos tus credenciales en este navegador.</p>
  </section></main>;
}
