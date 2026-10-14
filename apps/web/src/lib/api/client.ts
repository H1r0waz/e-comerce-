import { MockCommerceApi } from "./mock";
import type {
  AcceptInvitationInput,
  AuthenticationResult,
  CatalogProduct,
  CommerceApi,
  CommerceSession,
  CreateProductInput,
  CreateOrderInput,
  DashboardSnapshot,
  OrderListItem,
  ReceiveStockInput,
  SignInInput,
} from "./types";

class HttpCommerceApi implements CommerceApi {
  constructor(private readonly baseUrl: string) {}

  async getSession(): Promise<CommerceSession | null> {
    try {
      const payload = await this.request<unknown>("/v1/auth/session");
      if (payload === null) return null;
      return extractSession(payload);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  }

  async signIn(input: SignInInput): Promise<AuthenticationResult> {
    return normalizeAuthenticationResult(await this.request<unknown>("/v1/auth/login", { method: "POST", body: input }));
  }

  async acceptInvitation(input: AcceptInvitationInput): Promise<AuthenticationResult> {
    return normalizeAuthenticationResult(await this.request<unknown>("/v1/auth/invitations/accept", { method: "POST", body: input }), true);
  }

  async signOut(): Promise<void> {
    await this.request("/v1/auth/session", { method: "DELETE" });
  }

  getDashboard(): Promise<DashboardSnapshot> {
    return this.request("/v1/dashboard");
  }

  listProducts(): Promise<CatalogProduct[]> {
    return this.request("/v1/catalog/products");
  }

  createProduct(input: CreateProductInput): Promise<CatalogProduct> {
    return this.request("/v1/catalog/products", { method: "POST", body: input });
  }

  receiveStock(input: ReceiveStockInput): Promise<CatalogProduct> {
    return this.request("/v1/inventory/receipts", { method: "POST", body: input });
  }

  listOrders(): Promise<OrderListItem[]> {
    return this.request("/v1/orders");
  }

  createOrder(input: CreateOrderInput): Promise<OrderListItem> {
    return this.request("/v1/orders", { method: "POST", body: input });
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        credentials: "include",
        headers: options.body ? { "content-type": "application/json" } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      throw new ApiError(0, "network_error", "No pudimos comunicarnos con el servicio. Probá nuevamente.");
    }

    const payload = await response.json().catch(() => null) as ApiEnvelope<T> | T | null;
    if (!response.ok) {
      const code = getErrorCode(payload);
      throw new ApiError(response.status, code, safeErrorMessage(response.status, code));
    }
    return unwrapData(payload) as T;
  }
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConfigurationError";
  }
}

class UnconfiguredCommerceApi implements CommerceApi {
  constructor(private readonly message: string) {}

  getSession(): Promise<CommerceSession | null> { return Promise.reject(new ApiConfigurationError(this.message)); }
  signIn(): Promise<AuthenticationResult> { return Promise.reject(new ApiConfigurationError(this.message)); }
  acceptInvitation(): Promise<AuthenticationResult> { return Promise.reject(new ApiConfigurationError(this.message)); }
  signOut(): Promise<void> { return Promise.resolve(); }
  getDashboard(): Promise<DashboardSnapshot> { return Promise.reject(new ApiConfigurationError(this.message)); }
  listProducts(): Promise<CatalogProduct[]> { return Promise.reject(new ApiConfigurationError(this.message)); }
  createProduct(): Promise<CatalogProduct> { return Promise.reject(new ApiConfigurationError(this.message)); }
  receiveStock(): Promise<CatalogProduct> { return Promise.reject(new ApiConfigurationError(this.message)); }
  listOrders(): Promise<OrderListItem[]> { return Promise.reject(new ApiConfigurationError(this.message)); }
  createOrder(): Promise<OrderListItem> { return Promise.reject(new ApiConfigurationError(this.message)); }
}

type ApiEnvelope<T> = { data?: T; error?: { code?: unknown } };

function unwrapData<T>(payload: ApiEnvelope<T> | T | null): T | null {
  return payload && typeof payload === "object" && "data" in payload ? (payload as ApiEnvelope<T>).data ?? null : payload as T | null;
}

function getErrorCode(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "request_failed";
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object" || !("code" in error)) return "request_failed";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.toLowerCase() : "request_failed";
}

function safeErrorMessage(status: number, code: string): string {
  if (status === 400 || status === 422) return "Revisá los datos ingresados e intentá nuevamente.";
  if (status === 401) return "No pudimos verificar tus credenciales.";
  if (status === 403) return "No tenés permiso para realizar esta acción.";
  if (status === 429) return "Hiciste demasiados intentos. Esperá unos minutos antes de volver a probar.";
  return "No pudimos completar la solicitud. Probá nuevamente en unos minutos.";
}

function extractSession(payload: unknown): CommerceSession | null {
  const candidate = unwrapData(payload as ApiEnvelope<unknown> | unknown);
  const session = candidate && typeof candidate === "object" && "session" in candidate
    ? (candidate as { session?: unknown }).session
    : candidate;
  return isCommerceSession(session) ? session : null;
}

function normalizeAuthenticationResult(payload: unknown, acceptsInvitationOnly = false): AuthenticationResult {
  const candidate = unwrapData(payload as ApiEnvelope<unknown> | unknown);
  const session = extractSession(candidate);
  if (session) return { status: "authenticated", session };
  if (acceptsInvitationOnly && candidate && typeof candidate === "object" && "user" in candidate) return { status: "invitation_accepted" };
  throw new ApiError(500, "invalid_response", "No pudimos completar la solicitud. Probá nuevamente en unos minutos.");
}

function isCommerceSession(value: unknown): value is CommerceSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { user?: unknown };
  if (!candidate.user || typeof candidate.user !== "object") return false;
  const user = candidate.user as Record<string, unknown>;
  return ["id", "email", "displayName", "role", "organizationId", "organizationName"].every((key) => typeof user[key] === "string");
}

function resolveApi(): { api: CommerceApi; mode: "http" | "demo" | "unconfigured" } {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!configuredUrl) {
    if (process.env.NODE_ENV === "development") return { api: new MockCommerceApi(), mode: "demo" };
    return { api: new UnconfiguredCommerceApi("La aplicación no está configurada para conectarse al servicio seguro."), mode: "unconfigured" };
  }

  if (configuredUrl.startsWith("/") && !configuredUrl.startsWith("//")) {
    return { api: new HttpCommerceApi(configuredUrl.replace(/\/$/, "")), mode: "http" };
  }

  try {
    const url = new URL(configuredUrl);
    // Production authentication is intentionally same-origin. A relative path
    // (for example /api/backend) lets the browser send the secure session cookie
    // without relying on third-party cookie behavior.
    if (process.env.NODE_ENV !== "development" || (url.protocol !== "https:" && url.protocol !== "http:")) throw new Error("invalid origin");
    return { api: new HttpCommerceApi(url.toString().replace(/\/$/, "")), mode: "http" };
  } catch {
    return { api: new UnconfiguredCommerceApi("La conexión segura debe usar la ruta interna configurada por la persona administradora."), mode: "unconfigured" };
  }
}

const resolvedApi = resolveApi();

/** One adapter boundary for all browser-to-API traffic. No auth credentials live in localStorage. */
export const commerceApi = resolvedApi.api;
export const usingMockApi = resolvedApi.mode === "demo";
export const apiIsUnconfigured = resolvedApi.mode === "unconfigured";
