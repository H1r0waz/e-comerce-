import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../../apps/api/src/app.ts";
import { createApiRouteHandler } from "../../apps/api/src/routes/index.ts";
import type {
  ApiRouteDependencies,
  AuthRouteService,
  AuthenticatedSession,
  CatalogProductResponse,
  DashboardSnapshotResponse
} from "../../apps/api/src/routes/types.ts";

const dashboardOrigin = "https://dashboard.example";
const expiresAt = new Date("2030-01-01T12:00:00.000Z");

function sessionContext(): AuthenticatedSession {
  return {
    session: { id: "session-1", userId: "user-1", expiresAt },
    user: {
      id: "user-1",
      email: "owner@example.com",
      displayName: "Dueña",
      platformRoles: []
    }
  };
}

function emptyDashboard(): DashboardSnapshotResponse {
  return {
    generatedAt: "2030-01-01T12:00:00.000Z",
    metrics: {
      revenue: { label: "Ventas", value: "$0", detail: "Sin ventas" },
      ordersToPrepare: { label: "Pedidos", value: "0", detail: "Sin pedidos" },
      lowStock: { label: "Stock", value: "0", detail: "Sin alertas" },
      pendingPayments: { label: "Pagos", value: "0", detail: "Sin pendientes" }
    },
    alerts: [],
    orders: [],
    channelSales: { total: "$0", trend: "0%", values: [], distribution: [] }
  };
}

function catalogProduct(overrides: Partial<CatalogProductResponse> = {}): CatalogProductResponse {
  return {
    id: "product-1",
    variantId: "variant-1",
    name: "Sérum hidratante",
    variantName: "Única",
    categoryName: "Tratamientos",
    sku: "SER-001",
    retailPriceMinor: 2450000,
    onHandQuantity: 3,
    reservedQuantity: 0,
    availableQuantity: 3,
    lowStockThreshold: 1,
    ...overrides
  };
}

function dependencies(overrides: Partial<ApiRouteDependencies> = {}): ApiRouteDependencies {
  const auth: AuthRouteService = {
    async beginPasswordLogin() {
      return { sessionToken: "private-session-token", expiresAt, requiresMfa: false };
    },
    async acceptInvitation() {
      return { id: "user-1", email: "owner@example.com" };
    },
    async requireSession() {
      return sessionContext();
    },
    async verifyMfaForSession() {}
  };

  return {
    auth,
    authRepository: {
      async findDefaultMembershipForUser() {
        return { organizationId: "org-1", organizationName: "Comercio Uno", role: "OWNER" };
      },
      async findMembershipForUser() {
        return { organizationId: "org-1", organizationName: "Comercio Uno", role: "OWNER" };
      },
      async revokeSessionByTokenHash() {}
    },
    dashboardRepository: { async getDashboard() { return emptyDashboard(); } },
    nodeEnv: "test",
    corsOrigin: dashboardOrigin,
    ...overrides
  };
}

async function withServer<T>(routeDependencies: ApiRouteDependencies, action: (origin: string) => Promise<T>): Promise<T> {
  const app = createApp(
    {
      nodeEnv: "test",
      port: 0,
      host: "127.0.0.1",
      sessionSecret: "test-session-secret-that-is-not-used-in-production",
      corsOrigin: dashboardOrigin
    },
    { apiRouteHandler: createApiRouteHandler(routeDependencies) }
  );
  const server = app as Server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    return await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

test("session endpoint rejects a request without the HttpOnly session cookie", async () => {
  await withServer(dependencies(), async (origin) => {
    const response = await fetch(`${origin}/v1/auth/session`);
    const body = await json(response);

    assert.equal(response.status, 401);
    assert.equal((body.error as { code: string }).code, "unauthenticated");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("password login creates a cookie-backed session without returning the raw token", async () => {
  const loginInputs: Parameters<AuthRouteService["beginPasswordLogin"]>[0][] = [];
  const sessionCalls: Array<{ token: string; organizationId?: string }> = [];
  const deps = dependencies({
    auth: {
      async beginPasswordLogin(input) {
        loginInputs.push(input);
        return { sessionToken: "private-session-token", expiresAt, requiresMfa: false };
      },
      async acceptInvitation() {
        return { id: "user-1", email: "owner@example.com" };
      },
      async requireSession(token, organizationId) {
        sessionCalls.push({ token, organizationId });
        return sessionContext();
      },
      async verifyMfaForSession() {}
    }
  });

  await withServer(deps, async (origin) => {
    const response = await fetch(`${origin}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: dashboardOrigin, "user-agent": "Comerciar test" },
      body: JSON.stringify({ email: " OWNER@example.com ", password: "correct password" })
    });
    const body = await json(response);
    const cookie = response.headers.get("set-cookie") ?? "";

    assert.equal(response.status, 200);
    assert.deepEqual(loginInputs[0] && { email: loginInputs[0].email, password: loginInputs[0].password }, {
      email: "OWNER@example.com",
      password: "correct password"
    });
    assert.match(loginInputs[0]?.userAgentHash ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.equal(loginInputs[0]?.ipPrefix, "127.0.0");
    assert.equal(sessionCalls.length, 2);
    assert.match(cookie, /^commerce_session=private-session-token; Path=\/; HttpOnly; SameSite=Lax;/);
    assert.doesNotMatch(JSON.stringify(body), /private-session-token/);
    assert.equal((body.data as { user: { organizationId: string } }).user.organizationId, "org-1");
  });
});

test("state-changing auth routes reject an untrusted Origin before authenticating", async () => {
  let loginAttempts = 0;
  const deps = dependencies({
    auth: {
      async beginPasswordLogin() {
        loginAttempts += 1;
        return { sessionToken: "unused", expiresAt, requiresMfa: false };
      },
      async acceptInvitation() {
        return { id: "user-1", email: "owner@example.com" };
      },
      async requireSession() {
        return sessionContext();
      },
      async verifyMfaForSession() {}
    }
  });

  await withServer(deps, async (origin) => {
    const response = await fetch(`${origin}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ email: "owner@example.com", password: "correct password" })
    });
    const body = await json(response);

    assert.equal(response.status, 403);
    assert.equal((body.error as { code: string }).code, "origin_not_allowed");
    assert.equal(loginAttempts, 0);
  });
});

test("catalog and stock routes keep every operation scoped to the authenticated commerce", async () => {
  const listedOrganizations: string[] = [];
  const created: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];
  const deps = dependencies({
    catalogRepository: {
      async listProducts(organizationId) {
        listedOrganizations.push(organizationId);
        return [catalogProduct()];
      },
      async createProduct(input) {
        created.push(input);
        return catalogProduct({ name: input.name, categoryName: input.categoryName, sku: input.sku ?? "" });
      },
      async receiveStock(input) {
        receipts.push(input);
        return catalogProduct({ variantId: input.variantId, onHandQuantity: 8, availableQuantity: 8 });
      }
    }
  });

  await withServer(deps, async (origin) => {
    const headers = { cookie: "commerce_session=valid-session", origin: dashboardOrigin };

    const list = await fetch(`${origin}/v1/catalog/products`, { headers });
    assert.equal(list.status, 200);
    assert.deepEqual((await json(list)).data, [catalogProduct()]);
    assert.deepEqual(listedOrganizations, ["org-1"]);

    const create = await fetch(`${origin}/v1/catalog/products`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Sérum hidratante",
        categoryName: "Tratamientos",
        sku: "SER-001",
        retailPriceMinor: 2450000,
        lowStockThreshold: 1,
        initialQuantity: 3,
        unitCostMinor: 1200000,
        lotCode: "L-01",
        expiresAt: "2030-12-31"
      })
    });
    assert.equal(create.status, 201);
    assert.deepEqual(created, [{
      organizationId: "org-1",
      actorUserId: "user-1",
      name: "Sérum hidratante",
      categoryName: "Tratamientos",
      variantName: undefined,
      sku: "SER-001",
      retailPriceMinor: 2450000,
      lowStockThreshold: 1,
      initialQuantity: 3,
      unitCostMinor: 1200000,
      lotCode: "L-01",
      expiresAt: "2030-12-31"
    }]);

    const receipt = await fetch(`${origin}/v1/inventory/receipts`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ variantId: "variant-1", quantity: 5, unitCostMinor: 1000000, lotCode: "L-02" })
    });
    assert.equal(receipt.status, 201);
    assert.deepEqual(receipts, [{
      organizationId: "org-1",
      actorUserId: "user-1",
      variantId: "variant-1",
      quantity: 5,
      unitCostMinor: 1000000,
      lotCode: "L-02",
      expiresAt: undefined
    }]);
  });
});

test("catalog write routes reject a sales-only user", async () => {
  const deps = dependencies({
    authRepository: {
      async findDefaultMembershipForUser() {
        return { organizationId: "org-1", organizationName: "Comercio Uno", role: "SALES" };
      },
      async findMembershipForUser() {
        return { organizationId: "org-1", organizationName: "Comercio Uno", role: "SALES" };
      },
      async revokeSessionByTokenHash() {}
    },
    catalogRepository: {
      async listProducts() { return []; },
      async createProduct() { throw new Error("must not create product"); },
      async receiveStock() { throw new Error("must not receive stock"); }
    }
  });

  await withServer(deps, async (origin) => {
    const response = await fetch(`${origin}/v1/catalog/products`, {
      method: "POST",
      headers: {
        cookie: "commerce_session=valid-session",
        origin: dashboardOrigin,
        "content-type": "application/json"
      },
      body: JSON.stringify({ name: "Producto", categoryName: "Categoría", retailPriceMinor: 1 })
    });
    const body = await json(response);

    assert.equal(response.status, 403);
    assert.equal((body.error as { code: string }).code, "forbidden");
  });
});

test("order routes create pending-payment sales under the authenticated commerce", async () => {
  const created: Array<Record<string, unknown>> = [];
  const order = {
    id: "order-1", orderNumber: "000001", customerName: "Sofía", customerPhone: "+5491112345678",
    channel: "WHATSAPP" as const, status: "PENDING_PAYMENT" as const, totalMinor: 2450000,
    reservationExpiresAt: "2030-01-01T13:00:00.000Z", lineCount: 1, createdAt: "2030-01-01T12:00:00.000Z"
  };
  const deps = dependencies({
    ordersRepository: {
      async listOrders(organizationId) { assert.equal(organizationId, "org-1"); return [order]; },
      async createPendingPaymentOrder(input) { created.push(input); return order; }
    }
  });

  await withServer(deps, async (origin) => {
    const headers = { cookie: "commerce_session=valid-session", origin: dashboardOrigin, "content-type": "application/json" };
    const response = await fetch(`${origin}/v1/orders`, {
      method: "POST", headers,
      body: JSON.stringify({
        customerName: "Sofía", customerPhone: "+5491112345678", channel: "WHATSAPP",
        lines: [{ variantId: "variant-1", quantity: 1 }], shippingChargeMinor: 0
      })
    });
    assert.equal(response.status, 201);
    assert.deepEqual(created, [{
      organizationId: "org-1", actorUserId: "user-1", customerName: "Sofía", customerPhone: "+5491112345678",
      customerEmail: undefined, channel: "WHATSAPP", lines: [{ variantId: "variant-1", quantity: 1 }], shippingChargeMinor: 0
    }]);
    assert.deepEqual((await json(response)).data, order);

    const listed = await fetch(`${origin}/v1/orders`, { headers: { cookie: "commerce_session=valid-session" } });
    assert.equal(listed.status, 200);
    assert.deepEqual((await json(listed)).data, [order]);
  });
});
