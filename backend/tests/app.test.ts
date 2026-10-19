
import { config as loadDotEnv } from "dotenv";
import { resolve } from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";

// Load the project's environment before importing the app or database pool.
loadDotEnv({ path: resolve(process.cwd(), "../.env") });

const configuredDatabaseUrl = process.env.DATABASE_URL;

if (!configuredDatabaseUrl) {
  throw new Error(
    "DATABASE_URL is missing. Check the SupplyDesk root .env file.",
  );
}

// Always direct this suite to supplydesk_test, never supplydesk.
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

const testDatabaseName = parsedTestDatabaseUrl.pathname.replace(/^\/+/, "");

if (
  testDatabaseName !== "supplydesk_test" ||
  !testDatabaseUrl.includes("supplydesk_test")
) {
  throw new Error(
    "Safety check failed: automated tests must use the supplydesk_test database.",
  );
}

process.env.DATABASE_URL = testDatabaseUrl;

// Dynamic imports ensure the database pool receives the test URL above.
const { app } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function unwrap<T>(body: unknown): T {
  const envelope = body as { data?: T } | null;
  return (envelope?.data ?? body) as T;
}

function expectCreated(status: number): void {
  expect([200, 201]).toContain(status);
}

type TestProduct = {
  id: string;
  sku: string;
  quantity: number;
};

type TestSupplier = {
  id: string;
};

type TestPurchaseOrder = {
  id: string;
  status: string;
  items: {
    id: string;
    productId: string;
    quantityReceived: number;
  }[];
};

describe("SupplyDesk API integration tests", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("serves the API health check", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.service).toBe("supplydesk-api");
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

    const createdResponse = await request(app)
      .post("/api/products")
      .send(productInput);

    expectCreated(createdResponse.status);

    const product = unwrap<TestProduct>(createdResponse.body);
    expect(product.id).toBeTruthy();

    // SKU uniqueness should be enforced by the API/database.
    const duplicateResponse = await request(app)
      .post("/api/products")
      .send(productInput);

    expect([400, 409, 422]).toContain(duplicateResponse.status);

    // A stock reduction that would make inventory negative must be rejected.
    const negativeStockResponse = await request(app)
      .post(`/api/products/${product.id}/adjustments`)
      .send({
        delta: -4,
        reason: "Integration test: reject negative inventory",
        });

    expect(negativeStockResponse.status).toBe(409);

    // A valid stock adjustment should succeed.
    const adjustmentResponse = await request(app)
      .post(`/api/products/${product.id}/adjustments`)
      .send({
        delta: -2,
        reason: "Integration test: valid stock adjustment",
        });

    expectCreated(adjustmentResponse.status);

    const detailResponse = await request(app).get(
      `/api/products/${product.id}`,
    );

    expect(detailResponse.status).toBe(200);

    const updatedProduct = unwrap<TestProduct>(detailResponse.body);
    expect(Number(updatedProduct.quantity)).toBe(1);

    // The adjustment should appear in the product's stock movement history.
    const movementsResponse = await request(app).get(
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

  it("supports partial receipts and rejects receiving too many units", async () => {
    const supplierResponse = await request(app)
      .post("/api/suppliers")
      .send({
        name: `Integration Test Supplier ${suffix}`,
        contactName: "Test Contact",
        email: `supplier-${suffix}@example.com`,
        phone: null,
        address: null,
        notes: "Created by automated integration tests",
      });

    expectCreated(supplierResponse.status);

    const supplier = unwrap<TestSupplier>(supplierResponse.body);
    expect(supplier.id).toBeTruthy();

    const productResponse = await request(app)
      .post("/api/products")
      .send({
        sku: `TEST-PO-${suffix}`,
        name: `Purchase Order Test Product ${suffix}`,
        category: "Testing",
        quantity: 0,
        reorderPoint: 2,
        unitCost: 7.5,
        location: "Test Receiving",
      });

    expectCreated(productResponse.status);

    const product = unwrap<TestProduct>(productResponse.body);

    const orderResponse = await request(app)
      .post("/api/purchase-orders")
      .send({
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

    expectCreated(orderResponse.status);

    const draft = unwrap<TestPurchaseOrder>(orderResponse.body);
    expect(draft.id).toBeTruthy();
    expect(draft.status).toBe("draft");
    expect(draft.items).toHaveLength(1);

    const placeResponse = await request(app).post(
      `/api/purchase-orders/${draft.id}/place`,
    );

    expect(placeResponse.status).toBe(200);

    const placedOrder = unwrap<TestPurchaseOrder>(placeResponse.body);
    expect(placedOrder.status).toBe("ordered");

    const orderItemId = draft.items[0].id;

    // Receive 3 of the 8 ordered units.
    const partialReceiptResponse = await request(app)
      .post(`/api/purchase-orders/${draft.id}/receipts`)
      .send({
        receiptReference: `TEST-PARTIAL-${suffix}`,
        notes: "Partial receipt test",
        items: [
          {
            purchaseOrderItemId: orderItemId,
            quantityReceived: 3,
          },
        ],
      });

    expectCreated(partialReceiptResponse.status);

    const partialReceipt = unwrap<{ status: string }>(
      partialReceiptResponse.body,
    );
    expect(partialReceipt.status).toBe("partially_received");

    // Five units remain. Receiving six more must be rejected.
    const overReceiptResponse = await request(app)
      .post(`/api/purchase-orders/${draft.id}/receipts`)
      .send({
        receiptReference: `TEST-OVER-${suffix}`,
        notes: "This receipt must be rejected",
        items: [
          {
            purchaseOrderItemId: orderItemId,
            quantityReceived: 6,
          },
        ],
      });

    expect(overReceiptResponse.status).toBe(409);

    // Receive the remaining five units.
    const finalReceiptResponse = await request(app)
      .post(`/api/purchase-orders/${draft.id}/receipts`)
      .send({
        receiptReference: `TEST-FINAL-${suffix}`,
        notes: "Final receipt test",
        items: [
          {
            purchaseOrderItemId: orderItemId,
            quantityReceived: 5,
          },
        ],
      });

    expectCreated(finalReceiptResponse.status);

    const finalReceipt = unwrap<{ status: string }>(
      finalReceiptResponse.body,
    );
    expect(finalReceipt.status).toBe("received");

    // The eight received units must be reflected in inventory.
    const finalProductResponse = await request(app).get(
      `/api/products/${product.id}`,
    );

    expect(finalProductResponse.status).toBe(200);

    const finalProduct = unwrap<TestProduct>(finalProductResponse.body);
    expect(Number(finalProduct.quantity)).toBe(8);

    // Both successful receipts must be present in the order history.
    const receiptsResponse = await request(app).get(
      `/api/purchase-orders/${draft.id}/receipts`,
    );

    expect(receiptsResponse.status).toBe(200);

    const receipts = unwrap<{ id: string }[]>(receiptsResponse.body);
    expect(receipts).toHaveLength(2);
  });
});