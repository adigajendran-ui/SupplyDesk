import { config as loadDotEnv } from "dotenv";
import { resolve } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration tests must use supplydesk_test, never the development database.
loadDotEnv({ path: resolve(process.cwd(), "../.env") });

const configuredDatabaseUrl = process.env.DATABASE_URL;

if (!configuredDatabaseUrl) {
  throw new Error(
    "DATABASE_URL is missing. Check the SupplyDesk root .env file.",
  );
}

const testDatabaseUrl = configuredDatabaseUrl.replace(
  /\/supplydesk(?:_test)?(?=\?|$)/,
  "/supplydesk_test",
);

let parsedTestDatabaseUrl: URL;

try {
  parsedTestDatabaseUrl = new URL(testDatabaseUrl);
} catch {
  throw new Error("DATABASE_URL is not a valid PostgreSQL URL.");
}

if (parsedTestDatabaseUrl.pathname.replace(/^\/+/, "") !== "supplydesk_test") {
  throw new Error(
    "Safety check failed: tests must use supplydesk_test.",
  );
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET ??=
  "test-only-session-secret-never-use-outside-automated-tests";
process.env.FRONTEND_ORIGIN ??= "http://127.0.0.1:5173";

const { app } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { hashPassword } = await import("../src/auth/password.js");

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const adminEmail = `admin-${suffix}@example.com`;
const adminPassword = `SupplyDesk-${suffix}-Strong!`;

type TestAgent = ReturnType<typeof request.agent>;

let adminAgent: TestAgent;
let adminCsrfToken = "";

function unwrap<T>(body: unknown): T {
  const envelope = body as { data?: T } | null;
  return (envelope?.data ?? body) as T;
}

async function signIn(
  agent: TestAgent,
  email: string,
  password: string,
): Promise<{
  csrfToken: string;
  user: { id: string; email: string; role: string };
}> {
  const csrfResponse = await agent.get("/api/auth/csrf");

  expect(csrfResponse.status).toBe(200);

  const csrfToken = String(
    csrfResponse.body?.data?.csrfToken ?? "",
  );

  expect(csrfToken.length).toBeGreaterThan(20);

  const loginResponse = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", csrfToken)
    .send({ email, password });

  expect(loginResponse.status).toBe(200);

  return loginResponse.body.data;
}

function adminPost(path: string, body: unknown) {
  return adminAgent
    .post(path)
    .set("X-CSRF-Token", adminCsrfToken)
    .send(body);
}

describe("SupplyDesk API integration tests", () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(adminPassword);

    await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')`,
      [adminEmail, passwordHash],
    );

    adminAgent = request.agent(app);

    const session = await signIn(
      adminAgent,
      adminEmail,
      adminPassword,
    );

    adminCsrfToken = session.csrfToken;

    expect(session.user.role).toBe("admin");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("serves the health check and protects business APIs", async () => {
    const health = await request(app).get("/api/health");

    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");

    const anonymousAgent = request.agent(app);
    const privateResponse = await anonymousAgent.get("/api/products");

    expect(privateResponse.status).toBe(401);
    expect(privateResponse.body.error.code).toBe(
      "AUTHENTICATION_REQUIRED",
    );
  });

  it("rejects invalid credentials without revealing whether an account exists", async () => {
    const anonymousAgent = request.agent(app);

    const csrfResponse = await anonymousAgent.get("/api/auth/csrf");
    const token = String(csrfResponse.body?.data?.csrfToken ?? "");

    const loginResponse = await anonymousAgent
      .post("/api/auth/login")
      .set("X-CSRF-Token", token)
      .send({
        email: adminEmail,
        password: "definitely-the-wrong-password",
      });

    expect(loginResponse.status).toBe(401);
    expect(loginResponse.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(loginResponse.body.error.message).toBe(
      "Email or password is incorrect.",
    );
  });

  it("allows administrators to provision additional accounts", async () => {
    const newEmail = `manager-${suffix}@example.com`;
    const newPassword = `SupplyDesk-${suffix}-Manager!`;

    const response = await adminPost("/api/auth/users", {
      email: newEmail,
      password: newPassword,
      role: "manager",
    });

    expect(response.status).toBe(201);
    expect(response.body.data.email).toBe(newEmail);
    expect(response.body.data.role).toBe("manager");

    const stored = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = $1",
      [newEmail],
    );

    expect(stored.rows[0].password_hash.startsWith("scrypt$")).toBe(true);
    expect(stored.rows[0].password_hash).not.toContain(newPassword);
  });

  it("requires CSRF tokens for mutations", async () => {
    const response = await adminAgent
      .post("/api/products")
      .send({
        sku: `CSRF-${suffix}`,
        name: "CSRF protection probe",
        category: "Testing",
        quantity: 0,
        reorderPoint: 0,
        unitCost: 1,
        location: "Test Shelf",
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("CSRF_TOKEN_REQUIRED");
  });

  it("creates products, rejects duplicate SKUs, and protects stock levels", async () => {
    const productInput = {
      sku: `TEST-${suffix}`,
      name: `Integration Test Product ${suffix}`,
      category: "Testing",
      quantity: 3,
      reorderPoint: 1,
      unitCost: 12.5,
      location: "Test Shelf",
    };

    const createdResponse = await adminPost(
      "/api/products",
      productInput,
    );

    expect(createdResponse.status).toBe(201);

    const product = unwrap<{
      id: string;
      quantity: number;
    }>(createdResponse.body);

    expect(product.id).toBeTruthy();

    const duplicateResponse = await adminPost(
      "/api/products",
      productInput,
    );

    expect(duplicateResponse.status).toBe(409);

    const negativeStockResponse = await adminPost(
      `/api/products/${product.id}/adjustments`,
      {
        delta: -4,
        reason: "Integration test: reject negative inventory",
      },
    );

    expect(negativeStockResponse.status).toBe(409);
    expect(negativeStockResponse.body.error.code).toBe(
      "INSUFFICIENT_STOCK",
    );

    const adjustmentResponse = await adminPost(
      `/api/products/${product.id}/adjustments`,
      {
        delta: -2,
        reason: "Integration test: valid stock adjustment",
      },
    );

    expect(adjustmentResponse.status).toBe(200);

    const detailResponse = await adminAgent.get(
      `/api/products/${product.id}`,
    );

    expect(detailResponse.status).toBe(200);

    expect(
      Number(
        unwrap<{ quantity: number }>(detailResponse.body).quantity,
      ),
    ).toBe(1);

    const movementsResponse = await adminAgent.get(
      `/api/products/${product.id}/movements?limit=100`,
    );

    expect(movementsResponse.status).toBe(200);

    const movements = unwrap<
      { quantityDelta: number; reason: string }[]
    >(movementsResponse.body);

    expect(
      movements.some(
        (movement) =>
          Number(movement.quantityDelta) === -2 &&
          movement.reason === "Integration test: valid stock adjustment",
      ),
    ).toBe(true);
  });

  it("allows viewers to read but rejects their write requests", async () => {
    const viewerEmail = `viewer-${suffix}@example.com`;
    const viewerPassword = `SupplyDesk-${suffix}-Viewer!`;

    await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'viewer')`,
      [viewerEmail, await hashPassword(viewerPassword)],
    );

    const viewerAgent = request.agent(app);

    const viewerSession = await signIn(
      viewerAgent,
      viewerEmail,
      viewerPassword,
    );

    const readResponse = await viewerAgent.get("/api/products");

    expect(readResponse.status).toBe(200);

    const writeResponse = await viewerAgent
      .post("/api/products")
      .set("X-CSRF-Token", viewerSession.csrfToken)
      .send({
        sku: `VIEWER-${suffix}`,
        name: "Viewer write must be rejected",
        category: "Testing",
        quantity: 0,
        reorderPoint: 0,
        unitCost: 1,
        location: "Test Shelf",
      });

    expect(writeResponse.status).toBe(403);
    expect(writeResponse.body.error.code).toBe(
      "INSUFFICIENT_PERMISSIONS",
    );
  });

  it("supports partial receipts and rejects receiving too many units", async () => {
    const supplierResponse = await adminPost("/api/suppliers", {
      name: `Integration Test Supplier ${suffix}`,
      contactName: "Test Contact",
      email: `supplier-${suffix}@example.com`,
      phone: null,
      address: null,
      notes: "Created by automated integration tests",
    });

    expect([200, 201]).toContain(supplierResponse.status);

    const supplier = unwrap<{ id: string }>(
      supplierResponse.body,
    );

    const productResponse = await adminPost("/api/products", {
      sku: `TEST-PO-${suffix}`,
      name: `Purchase Order Test Product ${suffix}`,
      category: "Testing",
      quantity: 0,
      reorderPoint: 2,
      unitCost: 7.5,
      location: "Test Receiving",
    });

    expect(productResponse.status).toBe(201);

    const product = unwrap<{ id: string }>(
      productResponse.body,
    );

    const orderResponse = await adminPost("/api/purchase-orders", {
      supplierId: supplier.id,
      expectedDate: null,
      notes: "Automated purchasing integration test",
      items: [
        {
          productId: product.id,
          quantityOrdered: 8,
          unitCost: 7.5,
        },
      ],
    });

    expect([200, 201]).toContain(orderResponse.status);

    const draft = unwrap<{
      id: string;
      status: string;
      items: { id: string }[];
    }>(orderResponse.body);

    expect(draft.status).toBe("draft");
    expect(draft.items).toHaveLength(1);

    const placeResponse = await adminPost(
      `/api/purchase-orders/${draft.id}/place`,
      {},
    );

    expect(placeResponse.status).toBe(200);

    expect(
      unwrap<{ status: string }>(placeResponse.body).status,
    ).toBe("ordered");

    const orderItemId = draft.items[0].id;

    const partialResponse = await adminPost(
      `/api/purchase-orders/${draft.id}/receipts`,
      {
        receiptReference: `TEST-PARTIAL-${suffix}`,
        notes: "Partial receipt test",
        items: [
          {
            purchaseOrderItemId: orderItemId,
            quantityReceived: 3,
          },
        ],
      },
    );

    expect([200, 201]).toContain(partialResponse.status);

    expect(
      unwrap<{ status: string }>(partialResponse.body).status,
    ).toBe("partially_received");

    const overReceiptResponse = await adminPost(
      `/api/purchase-orders/${draft.id}/receipts`,
      {
        receiptReference: `TEST-OVER-${suffix}`,
        notes: "This receipt must be rejected",
        items: [
          {
            purchaseOrderItemId: orderItemId,
            quantityReceived: 6,
          },
        ],
      },
    );

    expect(overReceiptResponse.status).toBe(409);

    const finalReceiptResponse = await adminPost(
      `/api/purchase-orders/${draft.id}/receipts`,
      {
        receiptReference: `TEST-FINAL-${suffix}`,
        notes: "Final receipt test",
        items: [
          {
            purchaseOrderItemId: orderItemId,
            quantityReceived: 5,
          },
        ],
      },
    );

    expect([200, 201]).toContain(finalReceiptResponse.status);

    expect(
      unwrap<{ status: string }>(finalReceiptResponse.body).status,
    ).toBe("received");

    const finalProductResponse = await adminAgent.get(
      `/api/products/${product.id}`,
    );

    expect(finalProductResponse.status).toBe(200);

    expect(
      Number(
        unwrap<{ quantity: number }>(finalProductResponse.body).quantity,
      ),
    ).toBe(8);

    const receiptsResponse = await adminAgent.get(
      `/api/purchase-orders/${draft.id}/receipts`,
    );

    expect(receiptsResponse.status).toBe(200);

    expect(
      unwrap<{ id: string }[]>(receiptsResponse.body),
    ).toHaveLength(2);
  });
});