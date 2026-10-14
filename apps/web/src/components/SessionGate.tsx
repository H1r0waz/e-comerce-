"use client";

import { type FormEvent, createContext, useContext, useEffect, useMemo, useState } from "react";
import { ApiConfigurationError, ApiError, apiIsUnconfigured, commerceApi, usingMockApi } from "../lib/api/client";
import type { AuthenticationResult, CommerceApi, CommerceSession } from "../lib/api/types";

type AuthMode = "login" | "invitation";

type SessionContextValue = { api: CommerceApi; session: CommerceSession; signOut: () => Promise<void>; usingMockApi: boolean };

const SessionContext = createContext<SessionContextValue | null>(null);

export function useCommerceSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useCommerceSession debe usarse dentro de SessionGate.");
  return value;
}

export function SessionGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<CommerceSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (apiIsUnconfigured) { setLoading(false); return; }
    let cancelled = false;
    void commerceApi.getSession()
      .then((current) => { if (!cancelled) setSession(current); })
      .catch((reason: unknown) => { if (!cancelled) setError(safeClientMessage(reason, "No pudimos verificar tu sesión. Probá nuevamente.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const signOut = async () => {
    try {
      await commerceApi.signOut();
      setSession(null); setMode("login"); setError("");
    } catch (reason) {
      setError(safeClientMessage(reason, "No pudimos cerrar la sesión. Probá nuevamente."));
      throw reason;
    }
  };

  const completeAuthentication = async (result: AuthenticationResult) => {
    if (result.status === "invitation_accepted") {
      setMode("login");
      setNotice("Tu acceso fue activado. Iniciá sesión para continuar.");
      return;
    }
    if (result.status === "session_ready") {
      const current = await commerceApi.getSession();
      if (!current) throw new ApiError(401, "session_unavailable", "No pudimos verificar la sesión.");
      setSession(current);
      return;
    }
    setSession(result.session);
  };

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    setError(""); setNotice(""); setSubmitting(true);
    try {
      await completeAuthentication(await commerceApi.signIn({ email: String(values.get("email") ?? ""), password: String(values.get("password") ?? "") }));
    } catch (reason) { setError(safeClientMessage(reason, "No pudimos iniciar sesión.")); }
    finally { setSubmitting(false); }
  };

  const submitInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    setError(""); setNotice(""); setSubmitting(true);
    try {
      await completeAuthentication(await commerceApi.acceptInvitation({ invitationToken: String(values.get("token") ?? ""), displayName: String(values.get("displayName") ?? ""), password: String(values.get("password") ?? "") }));
    } catch (reason) { setError(safeClientMessage(reason, "No pudimos activar tu acceso.")); }
    finally { setSubmitting(false); }
  };

  const changeMode = (nextMode: AuthMode) => { setMode(nextMode); setError(""); setNotice(""); };
  const contextValue = useMemo(() => session ? { api: commerceApi, session, signOut, usingMockApi } : null, [session]);
  if (loading) return <main className="auth-shell"><p className="auth-loading" role="status">Verificando sesión segura…</p></main>;
  if (apiIsUnconfigured) return <ConfigurationScreen />;
  if (!contextValue) return <AuthScreen mode={mode} setMode={changeMode} error={error} notice={notice} submitting={submitting} onLogin={submitLogin} onInvitation={submitInvitation} />;
  return <SessionContext.Provider value={contextValue}>{children}</SessionContext.Provider>;
}

function safeClientMessage(reason: unknown, fallback: string): string {
  if (reason instanceof ApiError || reason instanceof ApiConfigurationError) return reason.message;
  if (usingMockApi && reason instanceof Error) return reason.message;
  return fallback;
}

function ConfigurationScreen() {
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="configuration-title">
    <div className="auth-brand"><span className="brand-mark">b</span><strong>bruma</strong></div>
    <div className="auth-copy"><span className="eyebrow">CONFIGURACIÓN REQUERIDA</span><h1 id="configuration-title">El acceso seguro todavía no está disponible</h1><p>Esta publicación no tiene un servicio de acceso configurado. Contactá a la persona administradora para continuar.</p></div>
    <p className="auth-footnote">No ingreses tus credenciales hasta que el acceso haya sido habilitado.</p>
  </section></main>;
}

function AuthScreen({ mode, setMode, error, notice, submitting, onLogin, onInvitation }: {
  mode: AuthMode;
  setMode: (value: AuthMode) => void;
  error: string;
  notice: string;
  submitting: boolean;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onInvitation: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="auth-title">
    <div className="auth-brand"><span className="brand-mark">b</span><strong>bruma</strong></div>
    {usingMockApi && <p className="demo-notice"><strong>Demostración local.</strong> Los datos no se guardan ni se envían a producción.</p>}
    <div className="auth-copy"><span className="eyebrow">ACCESO SEGURO</span><h1 id="auth-title">{mode === "login" ? "Ingresá a tu comercio" : "Activá tu invitación"}</h1><p>{mode === "login" ? "Usá el correo con el que fuiste invitado." : "Creá una contraseña personal para comenzar."}</p></div>
    <div className="auth-tabs" role="tablist" aria-label="Opciones de acceso"><button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Ingresar</button><button type="button" role="tab" aria-selected={mode === "invitation"} className={mode === "invitation" ? "active" : ""} onClick={() => setMode("invitation")}>Tengo invitación</button></div>
    {mode === "login" ? <form className="auth-form" onSubmit={onLogin}>
      <label>Correo electrónico<input name="email" type="email" autoComplete="email" required placeholder="vos@comercio.com" /></label>
      <label>Contraseña<input name="password" type="password" autoComplete="current-password" required minLength={12} placeholder="Tu contraseña" /></label>
      <button className="auth-submit" disabled={submitting}>{submitting ? "Ingresando…" : usingMockApi ? "Ingresar a la demostración" : "Ingresar"}</button>
    </form> : <form className="auth-form" onSubmit={onInvitation}>
      <label>Token de invitación<input name="token" autoComplete="one-time-code" required placeholder="Pegá el token de tu invitación" /></label>
      <label>Tu nombre<input name="displayName" autoComplete="name" required placeholder="Cómo querés que te llamemos" /></label>
      <label>Elegí una contraseña<input name="password" type="password" autoComplete="new-password" required minLength={12} placeholder="Mínimo 12 caracteres" /><small>Usá una contraseña única de al menos 12 caracteres.</small></label>
      <button className="auth-submit" disabled={submitting}>{submitting ? "Activando…" : "Activar acceso"}</button>
    </form>}
    {notice && <p className="auth-notice" role="status">{notice}</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <p className="auth-footnote">Por seguridad, no almacenamos tus credenciales, códigos ni sesiones en el almacenamiento del navegador.</p>
  </section></main>;
}
