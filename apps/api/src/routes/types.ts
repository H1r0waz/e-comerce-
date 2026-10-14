import type { IncomingMessage, ServerResponse } from "node:http";

export type CommerceRole = "OWNER" | "SALES" | "INVENTORY_FULFILLMENT" | "VIEWER" | "SUPER_ADMIN";

export interface SessionUserResponse {
  id: string;
  email: string;
  displayName: string;
  role: CommerceRole;
  organizationId: string;
  organizationName: string;
}

export interface CommerceSessionResponse {
  user: SessionUserResponse;
  expiresAt?: string;
}

export interface MfaChallengeResponse {
  requiresMfa: true;
}

export interface AuthenticatedSession {
  session: {
    id: string;
    userId: string;
    organizationId?: string;
    expiresAt: Date;
  };
  user: {
    id: string;
    email: string;
    displayName: string;
    platformRoles: readonly string[];
  };
}

/**
 * Boundary used by HTTP handlers. The concrete implementation lives in the
 * auth module and is backed by PostgreSQL; routes never retain credentials.
 */
export interface AuthRouteService {
  beginPasswordLogin(input: {
    email: string;
    password: string;
    organizationId?: string;
    userAgentHash?: string;
    ipPrefix?: string;
  }): Promise<{ sessionToken: string; expiresAt: Date; requiresMfa: boolean }>;
  acceptInvitation(input: {
    token: string;
    displayName: string;
    password: string;
  }): Promise<{ id: string; email: string }>;
  requireSession(token: string, organizationId?: string): Promise<AuthenticatedSession>;
  verifyMfaForSession(input: { sessionToken: string; code: string; recoveryCode?: boolean }): Promise<void>;
  completeInitialSuperAdminBootstrap(input: {
    bootstrapToken: string;
    email: string;
    displayName: string;
    organizationName: string;
    password: string;
  }): Promise<void>;
}

/** Query-only auth projection required to resolve the current commerce. */
export interface AuthSessionRepository {
  findDefaultMembershipForUser(userId: string): Promise<{
    organizationId: string;
    organizationName: string;
    role: Exclude<CommerceRole, "SUPER_ADMIN">;
  } | null>;
  findMembershipForUser(input: { userId: string; organizationId: string }): Promise<{
    organizationId: string;
    organizationName: string;
    role: Exclude<CommerceRole, "SUPER_ADMIN">;
  } | null>;
  revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>;
}

export interface DashboardSnapshotResponse {
  generatedAt: string;
  metrics: {
    revenue: { label: string; value: string; detail: string; trend?: string };
    ordersToPrepare: { label: string; value: string; detail: string; trend?: string };
    lowStock: { label: string; value: string; detail: string; trend?: string };
    pendingPayments: { label: string; value: string; detail: string; trend?: string };
  };
  alerts: Array<{
    id: string;
    kind: "payment" | "reservation" | "stock" | "expiration";
    title: string;
    detail: string;
  }>;
  orders: Array<{
    id: string;
    customer: string;
    items: string;
    amount: string;
    channel: string;
    state: string;
    tone: "violet" | "amber" | "blue" | "green";
    initials: string;
  }>;
  channelSales: {
    total: string;
    trend: string;
    values: number[];
    distribution: Array<{ label: string; value: string; color: "purple" | "pink" }>;
  };
}

/** Tenant-scoped read model. Implementations must enforce organization_id. */
export interface DashboardRepository {
  getDashboard(input: { organizationId: string; actorUserId: string; now: Date }): Promise<DashboardSnapshotResponse>;
}

export interface ApiRouteDependencies {
  auth: AuthRouteService;
  authRepository: AuthSessionRepository;
  dashboardRepository: DashboardRepository;
  nodeEnv: "development" | "test" | "production";
  corsOrigin: string;
}

export type ApiRouteHandler = (request: IncomingMessage, response: ServerResponse, requestId: string) => Promise<boolean>;
