import { MockCommerceApi } from "./mock";
import type { AcceptInvitationInput, CommerceApi, CommerceSession, DashboardSnapshot, SignInInput } from "./types";

class HttpCommerceApi implements CommerceApi {
  constructor(private readonly baseUrl: string) {}

  async getSession(): Promise<CommerceSession | null> {
    try {
      return await this.request<CommerceSession | null>("/v1/auth/session");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  }

  signIn(input: SignInInput): Promise<CommerceSession> {
    return this.request("/v1/auth/login", { method: "POST", body: input });
  }

  acceptInvitation(input: AcceptInvitationInput): Promise<CommerceSession> {
    return this.request("/v1/auth/invitations/accept", { method: "POST", body: input });
  }

  async signOut(): Promise<void> {
    await this.request("/v1/auth/session", { method: "DELETE" });
  }

  getDashboard(): Promise<DashboardSnapshot> {
    return this.request("/v1/dashboard");
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | T | null;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload ? payload.error?.message : undefined;
      throw new ApiError(response.status, message ?? "No pudimos completar la solicitud.");
    }
    return payload && typeof payload === "object" && "data" in payload ? payload.data as T : payload as T;
  }
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

/** One adapter boundary for all browser-to-API traffic. No auth credentials live in localStorage. */
export const commerceApi: CommerceApi = apiUrl ? new HttpCommerceApi(apiUrl) : new MockCommerceApi();
export const usingMockApi = !apiUrl;
