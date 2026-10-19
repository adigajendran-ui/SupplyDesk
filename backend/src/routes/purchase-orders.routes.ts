import { Router, type Response } from "express";
import { z } from "zod";

import { pool } from "../db/pool.js";

export const purchaseOrdersRouter = Router();

type PurchaseOrderStatus =
  | "draft"
  | "ordered"
  | "partially_received"
  | "received"
  | "cancelled";

type OrderRow = {
  id: string;
  order_number: string;
  supplier_id: string;
  supplier_name: string;
  status: PurchaseOrderStatus;
  expected_date: string | Date | null;
  ordered_at: Date | string | null;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  item_count?: number;
  total_cost?: string | number;
};

type OrderItemRow = {
  id: string;
  purchase_order_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type LockedOrderItemRow = {
  id: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: string | number;
  current_quantity: number;
};

type ReceiptRow = {
  id: string;
  purchase_order_id: string;
  receipt_reference: string | null;
  notes: string | null;
  received_at: Date | string;
  created_at: Date | string;
};

type ReceiptItemRow = {
  id: string;
  receipt_id: string;
  purchase_order_item_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity_received: number;
};

const uuidSchema = z.string().uuid();

const quantitySchema = z
  .number()
  .int()
  .min(1)
  .max(2_147_483_647);

const unitCostSchema = z
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999.99)
  .refine(
    (value) =>
      Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
    { message: "Unit cost can have at most two decimal places." },
  );

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);

    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Provide a valid calendar date.");

const createOrderItemSchema = z
  .object({
    productId: uuidSchema,
    quantityOrdered: quantitySchema,
    unitCost: unitCostSchema,
  })
  .strict();

const createPurchaseOrderSchema = z
  .object({
    supplierId: uuidSchema,
    expectedDate: isoDateSchema.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    items: z
      .array(createOrderItemSchema)
      .min(1, "At least one order item is required.")
      .max(100, "An order can contain at most 100 line items.")
      .refine(
        (items) =>
          new Set(items.map((item) => item.productId)).size === items.length,
        "Each product can appear only once per purchase order.",
      ),
  })
  .strict();

const updatePurchaseOrderSchema = z
  .object({
    expectedDate: isoDateSchema.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.expectedDate !== undefined || value.notes !== undefined,
    { message: "Provide expectedDate or notes to update." },
  );

const listPurchaseOrdersSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z
    .enum([
      "all",
      "draft",
      "ordered",
      "partially_received",
      "received",
      "cancelled",
    ])
    .default("all"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const receiptItemSchema = z
  .object({
    purchaseOrderItemId: uuidSchema,
    quantityReceived: quantitySchema,
  })
  .strict();

const createReceiptSchema = z
  .object({
    receiptReference: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    items: z
      .array(receiptItemSchema)
      .min(1, "At least one received line item is required.")
      .max(100)
      .refine(
        (items) =>
          new Set(items.map((item) => item.purchaseOrderItemId)).size ===
          items.length,
        "Each purchase order line can appear only once per receipt.",
      ),
  })
  .strict();

function toOrder(row: OrderRow) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    status: row.status,
    expectedDate:
      row.expected_date === null
        ? null
        : String(row.expected_date).slice(0, 10),
    orderedAt: row.ordered_at
      ? new Date(row.ordered_at).toISOString()
      : null,
    notes: row.notes,
    itemCount: Number(row.item_count ?? 0),
    totalCost: Number(row.total_cost ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toOrderItem(row: OrderItemRow) {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    productId: row.product_id,
    sku: row.sku,
    productName: row.product_name,
    quantityOrdered: Number(row.quantity_ordered),
    quantityReceived: Number(row.quantity_received),
    quantityOutstanding:
      Number(row.quantity_ordered) - Number(row.quantity_received),
    unitCost: Number(row.unit_cost),
    lineTotal: Number(row.quantity_ordered) * Number(row.unit_cost),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function sendValidationError(
  response: Response,
  issues: Array<{ path: PropertyKey[]; message: string }>,
): void {
  response.status(400).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "The request contains invalid fields.",
      details: issues.map((issue) => ({
        field: issue.path.map(String).join("."),
        message: issue.message,
      })),
    },
  });
}

function readId(value: string, response: Response): string | null {
  const parsed = uuidSchema.safeParse(value);

  if (!parsed.success) {
    response.status(400).json({
      error: {
        code: "INVALID_ID",
        message: "The resource ID must be a valid UUID.",
      },
    });
    return null;
  }

  return parsed.data;
}

function sendOrderDatabaseError(
  error: unknown,
  response: Response,
  operation: string,
): void {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;

  if (code === "23505") {
    response.status(409).json({
      error: {
        code: "DUPLICATE_RESOURCE",
        message: "A conflicting record already exists.",
      },
    });
    return;
  }

  if (code === "23503") {
    response.status(400).json({
      error: {
        code: "RELATED_RESOURCE_NOT_FOUND",
        message:
          "A referenced supplier, product, order, or receipt line does not exist.",
      },
    });
    return;
  }

  if (
    code === "23514" ||
    code === "23502" ||
    code === "22P02" ||
    code === "22001"
  ) {
    response.status(400).json({
      error: {
        code: "INVALID_DATA",
        message: "The supplied data violates a database constraint.",
      },
    });
    return;
  }

  if (code === "22003") {
    response.status(409).json({
      error: {
        code: "NUMERIC_LIMIT_EXCEEDED",
        message: "The requested change exceeds a supported numeric limit.",
      },
    });
    return;
  }

  console.error(`Purchase-order operation failed: ${operation}`, error);

  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "The purchase-order operation could not be completed.",
    },
  });
}

async function loadOrderDetail(id: string) {
  const headerResult = await pool.query<OrderRow>(
    `SELECT
       po.id,
       po.order_number,
       po.supplier_id,
       s.name AS supplier_name,
       po.status,
       po.expected_date,
       po.ordered_at,
       po.notes,
       po.created_at,
       po.updated_at,
       COUNT(poi.id)::int AS item_count,
       COALESCE(
         SUM(poi.quantity_ordered::numeric * poi.unit_cost),
         0
       ) AS total_cost
     FROM purchase_orders AS po
     INNER JOIN suppliers AS s
       ON s.id = po.supplier_id
     LEFT JOIN purchase_order_items AS poi
       ON poi.purchase_order_id = po.id
     WHERE po.id = $1
     GROUP BY po.id, s.id`,
    [id],
  );

  if (headerResult.rows.length === 0) {
    return null;
  }

  const itemResult = await pool.query<OrderItemRow>(
    `SELECT
       poi.id,
       poi.purchase_order_id,
       poi.product_id,
       p.sku,
       p.name AS product_name,
       poi.quantity_ordered,
       poi.quantity_received,
       poi.unit_cost,
       poi.created_at,
       poi.updated_at
     FROM purchase_order_items AS poi
     INNER JOIN products AS p
       ON p.id = poi.product_id
     WHERE poi.purchase_order_id = $1
     ORDER BY p.name ASC, poi.id ASC`,
    [id],
  );

  return {
    ...toOrder(headerResult.rows[0]),
    items: itemResult.rows.map(toOrderItem),
  };
}

// GET /api/purchase-orders
purchaseOrdersRouter.get("/", async (request, response) => {
  const parsed = listPurchaseOrdersSchema.safeParse(request.query);

  if (!parsed.success) {
    sendValidationError(response, parsed.error.issues);
    return;
  }

  const { search, status, page, limit } = parsed.data;
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (search) {
    values.push(`%${search}%`);
    const position = values.length;

    conditions.push(`(
      po.order_number ILIKE $${position}
      OR s.name ILIKE $${position}
    )`);
  }

  if (status !== "all") {
    values.push(status);
    conditions.push(`po.status = $${values.length}`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const countResult = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM purchase_orders AS po
       INNER JOIN suppliers AS s
         ON s.id = po.supplier_id
       ${whereClause}`,
      values,
    );

    const total = Number(countResult.rows[0]?.total ?? 0);

    const result = await pool.query<OrderRow>(
      `SELECT
         po.id,
         po.order_number,
         po.supplier_id,
         s.name AS supplier_name,
         po.status,
         po.expected_date,
         po.ordered_at,
         po.notes,
         po.created_at,
         po.updated_at,
         COUNT(poi.id)::int AS item_count,
         COALESCE(
           SUM(poi.quantity_ordered::numeric * poi.unit_cost),
           0
         ) AS total_cost
       FROM purchase_orders AS po
       INNER JOIN suppliers AS s
         ON s.id = po.supplier_id
       LEFT JOIN purchase_order_items AS poi
         ON poi.purchase_order_id = po.id
       ${whereClause}
       GROUP BY po.id, s.id
       ORDER BY po.created_at DESC, po.id ASC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit],
    );

    response.status(200).json({
      data: result.rows.map(toOrder),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendOrderDatabaseError(error, response, "list purchase orders");
  }
});

// POST /api/purchase-orders
// Creates a draft and its line items atomically. Stock is not changed yet.
purchaseOrdersRouter.post("/", async (request, response) => {
  const parsed = createPurchaseOrderSchema.safeParse(request.body);

  if (!parsed.success) {
    sendValidationError(response, parsed.error.issues);
    return;
  }

  const input = parsed.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const supplierResult = await client.query<{ id: string }>(
      `SELECT id
       FROM suppliers
       WHERE id = $1 AND is_active = TRUE
       FOR SHARE`,
      [input.supplierId],
    );

    if (supplierResult.rows.length === 0) {
      await client.query("ROLLBACK");

      response.status(400).json({
        error: {
          code: "SUPPLIER_UNAVAILABLE",
          message: "The supplier does not exist or is inactive.",
        },
      });
      return;
    }

    const productIds = input.items.map((item) => item.productId);

    const productResult = await client.query<{ id: string }>(
      `SELECT id
       FROM products
       WHERE id = ANY($1::uuid[])`,
      [productIds],
    );

    if (productResult.rows.length !== productIds.length) {
      await client.query("ROLLBACK");

      response.status(400).json({
        error: {
          code: "PRODUCT_UNAVAILABLE",
          message:
            "One or more products do not exist. Refresh the product list and try again.",
        },
      });
      return;
    }

    const sequenceResult = await client.query<{ value: string }>(
      `SELECT nextval('purchase_order_number_seq')::text AS value`,
    );

    const sequenceValue = sequenceResult.rows[0].value;
    const year = new Date().getUTCFullYear();
    const orderNumber = `PO-${year}-${sequenceValue.padStart(6, "0")}`;

    const orderResult = await client.query<{ id: string }>(
      `INSERT INTO purchase_orders (
         order_number,
         supplier_id,
         status,
         expected_date,
         notes
       )
       VALUES ($1, $2, 'draft', $3, $4)
       RETURNING id`,
      [
        orderNumber,
        input.supplierId,
        input.expectedDate ?? null,
        input.notes ?? null,
      ],
    );

    const orderId = orderResult.rows[0].id;

    for (const item of input.items) {
      await client.query(
        `INSERT INTO purchase_order_items (
           purchase_order_id,
           product_id,
           quantity_ordered,
           unit_cost
         )
         VALUES ($1, $2, $3, $4)`,
        [
          orderId,
          item.productId,
          item.quantityOrdered,
          item.unitCost,
        ],
      );
    }

    await client.query("COMMIT");

    const detail = await loadOrderDetail(orderId);

    response.status(201).json({
      data: detail,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Purchase-order creation rollback failed:", rollbackError);
    }

    sendOrderDatabaseError(error, response, "create purchase order");
  } finally {
    client.release();
  }
});

// GET /api/purchase-orders/:id
purchaseOrdersRouter.get("/:id", async (request, response) => {
  const id = readId(request.params.id, response);
  if (!id) return;

  try {
    const detail = await loadOrderDetail(id);

    if (!detail) {
      response.status(404).json({
        error: {
          code: "PURCHASE_ORDER_NOT_FOUND",
          message: "The purchase order was not found.",
        },
      });
      return;
    }

    response.status(200).json({ data: detail });
  } catch (error) {
    sendOrderDatabaseError(error, response, "get purchase order");
  }
});

// PATCH /api/purchase-orders/:id
// Drafts only: the order cannot be modified after it is placed.
purchaseOrdersRouter.patch("/:id", async (request, response) => {
  const id = readId(request.params.id, response);
  if (!id) return;

  const parsed = updatePurchaseOrderSchema.safeParse(request.body);

  if (!parsed.success) {
    sendValidationError(response, parsed.error.issues);
    return;
  }

  const updates = parsed.data;
  const assignments: string[] = [];
  const values: (string | null)[] = [];

  if (updates.expectedDate !== undefined) {
    values.push(updates.expectedDate);
    assignments.push(`expected_date = $${values.length}`);
  }

  if (updates.notes !== undefined) {
    values.push(updates.notes);
    assignments.push(`notes = $${values.length}`);
  }

  assignments.push("updated_at = NOW()");
  values.push(id);

  try {
    const result = await pool.query<{ id: string }>(
      `UPDATE purchase_orders
       SET ${assignments.join(", ")}
       WHERE id = $${values.length}
         AND status = 'draft'
       RETURNING id`,
      values,
    );

    if (result.rows.length === 0) {
      const existing = await pool.query<{ status: string }>(
        "SELECT status FROM purchase_orders WHERE id = $1",
        [id],
      );

      if (existing.rows.length === 0) {
        response.status(404).json({
          error: {
            code: "PURCHASE_ORDER_NOT_FOUND",
            message: "The purchase order was not found.",
          },
        });
        return;
      }

      response.status(409).json({
        error: {
          code: "PURCHASE_ORDER_NOT_EDITABLE",
          message: "Only draft purchase orders can be edited.",
        },
      });
      return;
    }

    const detail = await loadOrderDetail(id);

    response.status(200).json({ data: detail });
  } catch (error) {
    sendOrderDatabaseError(error, response, "update purchase order");
  }
});

// POST /api/purchase-orders/:id/place
purchaseOrdersRouter.post("/:id/place", async (request, response) => {
  const id = readId(request.params.id, response);
  if (!id) return;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const orderResult = await client.query<{
      id: string;
      status: PurchaseOrderStatus;
    }>(
      `SELECT id, status
       FROM purchase_orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");

      response.status(404).json({
        error: {
          code: "PURCHASE_ORDER_NOT_FOUND",
          message: "The purchase order was not found.",
        },
      });
      return;
    }

    const order = orderResult.rows[0];

    if (order.status !== "draft") {
      await client.query("ROLLBACK");

      response.status(409).json({
        error: {
          code: "INVALID_PURCHASE_ORDER_STATE",
          message: "Only draft purchase orders can be placed.",
        },
      });
      return;
    }

    const itemCount = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM purchase_order_items
       WHERE purchase_order_id = $1`,
      [id],
    );

    if (Number(itemCount.rows[0]?.count ?? 0) === 0) {
      await client.query("ROLLBACK");

      response.status(409).json({
        error: {
          code: "EMPTY_PURCHASE_ORDER",
          message: "Add at least one item before placing an order.",
        },
      });
      return;
    }

    await client.query(
      `UPDATE purchase_orders
       SET status = 'ordered',
           ordered_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    await client.query("COMMIT");

    const detail = await loadOrderDetail(id);

    response.status(200).json({ data: detail });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Order placement rollback failed:", rollbackError);
    }

    sendOrderDatabaseError(error, response, "place purchase order");
  } finally {
    client.release();
  }
});

// POST /api/purchase-orders/:id/cancel
purchaseOrdersRouter.post("/:id/cancel", async (request, response) => {
  const id = readId(request.params.id, response);
  if (!id) return;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const orderResult = await client.query<{
      id: string;
      status: PurchaseOrderStatus;
    }>(
      `SELECT id, status
       FROM purchase_orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");

      response.status(404).json({
        error: {
          code: "PURCHASE_ORDER_NOT_FOUND",
          message: "The purchase order was not found.",
        },
      });
      return;
    }

    const order = orderResult.rows[0];

    if (order.status !== "draft" && order.status !== "ordered") {
      await client.query("ROLLBACK");

      response.status(409).json({
        error: {
          code: "PURCHASE_ORDER_NOT_CANCELLABLE",
          message:
            "Only draft or ordered purchase orders without receipts can be cancelled.",
        },
      });
      return;
    }

    const receivedResult = await client.query<{ received: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM purchase_order_items
         WHERE purchase_order_id = $1
           AND quantity_received > 0
       ) AS received`,
      [id],
    );

    if (receivedResult.rows[0]?.received) {
      await client.query("ROLLBACK");

      response.status(409).json({
        error: {
          code: "PURCHASE_ORDER_HAS_RECEIPTS",
          message:
            "An order with received inventory cannot be cancelled.",
        },
      });
      return;
    }

    await client.query(
      `UPDATE purchase_orders
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    await client.query("COMMIT");

    const detail = await loadOrderDetail(id);

    response.status(200).json({ data: detail });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Order cancellation rollback failed:", rollbackError);
    }

    sendOrderDatabaseError(error, response, "cancel purchase order");
  } finally {
    client.release();
  }
});

// POST /api/purchase-orders/:id/receipts
// Receipts, line quantities, product stock, and stock movements are atomic.
purchaseOrdersRouter.post("/:id/receipts", async (request, response) => {
  const id = readId(request.params.id, response);
  if (!id) return;

  const parsed = createReceiptSchema.safeParse(request.body);

  if (!parsed.success) {
    sendValidationError(response, parsed.error.issues);
    return;
  }

  const input = parsed.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const orderResult = await client.query<{
      id: string;
      order_number: string;
      status: PurchaseOrderStatus;
    }>(
      `SELECT id, order_number, status
       FROM purchase_orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");

      response.status(404).json({
        error: {
          code: "PURCHASE_ORDER_NOT_FOUND",
          message: "The purchase order was not found.",
        },
      });
      return;
    }

    const order = orderResult.rows[0];

    if (
      order.status !== "ordered" &&
      order.status !== "partially_received"
    ) {
      await client.query("ROLLBACK");

      response.status(409).json({
        error: {
          code: "PURCHASE_ORDER_NOT_RECEIVABLE",
          message:
            "Only placed or partially received orders can receive inventory.",
        },
      });
      return;
    }

    const requestedIds = input.items.map(
      (item) => item.purchaseOrderItemId,
    );

    // Lock order lines and products in a consistent product order.
    const lockedResult = await client.query<LockedOrderItemRow>(
      `SELECT
         poi.id,
         poi.product_id,
         p.sku,
         p.name AS product_name,
         poi.quantity_ordered,
         poi.quantity_received,
         poi.unit_cost,
         p.quantity AS current_quantity
       FROM purchase_order_items AS poi
       INNER JOIN products AS p
         ON p.id = poi.product_id
       WHERE poi.purchase_order_id = $1
         AND poi.id = ANY($2::uuid[])
       ORDER BY p.id ASC, poi.id ASC
       FOR UPDATE OF poi, p`,
      [id, requestedIds],
    );

    if (lockedResult.rows.length !== input.items.length) {
      await client.query("ROLLBACK");

      response.status(400).json({
        error: {
          code: "INVALID_ORDER_ITEMS",
          message:
            "One or more receipt lines do not belong to this purchase order.",
        },
      });
      return;
    }

    const lockedItems = lockedResult.rows;
    const receiptQuantities = new Map(
      input.items.map((item) => [
        item.purchaseOrderItemId,
        item.quantityReceived,
      ]),
    );

    for (const item of lockedItems) {
      const receiving = receiptQuantities.get(item.id);

      if (receiving === undefined) {
        await client.query("ROLLBACK");

        response.status(400).json({
          error: {
            code: "INVALID_RECEIPT",
            message: "A receipt line could not be matched to its order item.",
          },
        });
        return;
      }

      if (item.quantity_received + receiving > item.quantity_ordered) {
        await client.query("ROLLBACK");

        response.status(409).json({
          error: {
            code: "OVER_RECEIVING",
            message: `Receiving would exceed the ordered quantity for ${item.sku}.`,
            sku: item.sku,
            quantityOrdered: item.quantity_ordered,
            quantityAlreadyReceived: item.quantity_received,
            quantityRequested: receiving,
            quantityOutstanding:
              item.quantity_ordered - item.quantity_received,
          },
        });
        return;
      }
    }

    const receiptResult = await client.query<ReceiptRow>(
      `INSERT INTO purchase_order_receipts (
         purchase_order_id,
         receipt_reference,
         notes
       )
       VALUES ($1, $2, $3)
       RETURNING
         id,
         purchase_order_id,
         receipt_reference,
         notes,
         received_at,
         created_at`,
      [
        id,
        input.receiptReference ?? null,
        input.notes ?? null,
      ],
    );

    const receipt = receiptResult.rows[0];

    const receivedItems: Array<{
      purchaseOrderItemId: string;
      productId: string;
      sku: string;
      productName: string;
      quantityReceived: number;
      quantityAfter: number;
    }> = [];

    // Product rows are updated while locked, so simultaneous receipts
    // cannot overwrite quantities calculated from stale stock values.
    for (const item of lockedItems) {
      const receivedQuantity = receiptQuantities.get(item.id)!;

      const lineUpdate = await client.query<{ quantity_received: number }>(
        `UPDATE purchase_order_items
         SET quantity_received = quantity_received + $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING quantity_received`,
        [receivedQuantity, item.id],
      );

      const productUpdate = await client.query<{ quantity: number }>(
        `UPDATE products
         SET quantity = quantity + $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING quantity`,
        [receivedQuantity, item.product_id],
      );

      const quantityAfter = Number(productUpdate.rows[0].quantity);

      await client.query(
        `INSERT INTO purchase_order_receipt_items (
           receipt_id,
           purchase_order_item_id,
           quantity_received
         )
         VALUES ($1, $2, $3)`,
        [receipt.id, item.id, receivedQuantity],
      );

      await client.query(
        `INSERT INTO stock_movements (
           product_id,
           movement_type,
           quantity_delta,
           quantity_after,
           reason,
           reference_type,
           reference_id
         )
         VALUES ($1, 'received', $2, $3, $4, 'purchase_order_receipt', $5)`,
        [
          item.product_id,
          receivedQuantity,
          quantityAfter,
          `Received ${receivedQuantity} units against ${order.order_number}`,
          receipt.id,
        ],
      );

      receivedItems.push({
        purchaseOrderItemId: item.id,
        productId: item.product_id,
        sku: item.sku,
        productName: item.product_name,
        quantityReceived: receivedQuantity,
        quantityAfter,
      });

      // Accessing the result also ensures the database reported the
      // updated quantity; the transaction rolls back if any query fails.
      if (lineUpdate.rows.length !== 1) {
        throw new Error("The purchase order line failed to update.");
      }
    }

    const outstandingResult = await client.query<{ remaining: number }>(
      `SELECT COUNT(*)::int AS remaining
       FROM purchase_order_items
       WHERE purchase_order_id = $1
         AND quantity_received < quantity_ordered`,
      [id],
    );

    const remaining = Number(outstandingResult.rows[0]?.remaining ?? 0);

    const nextStatus: PurchaseOrderStatus =
      remaining === 0 ? "received" : "partially_received";

    await client.query(
      `UPDATE purchase_orders
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [nextStatus, id],
    );

    await client.query("COMMIT");

    response.status(201).json({
      data: {
        receiptId: receipt.id,
        purchaseOrderId: id,
        orderNumber: order.order_number,
        status: nextStatus,
        receiptReference: receipt.receipt_reference,
        notes: receipt.notes,
        receivedAt: new Date(receipt.received_at).toISOString(),
        items: receivedItems,
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Receipt transaction rollback failed:", rollbackError);
    }

    sendOrderDatabaseError(error, response, "receive purchase order");
  } finally {
    client.release();
  }
});

// GET /api/purchase-orders/:id/receipts
purchaseOrdersRouter.get("/:id/receipts", async (request, response) => {
  const id = readId(request.params.id, response);
  if (!id) return;

  try {
    const orderResult = await pool.query<{ id: string }>(
      "SELECT id FROM purchase_orders WHERE id = $1",
      [id],
    );

    if (orderResult.rows.length === 0) {
      response.status(404).json({
        error: {
          code: "PURCHASE_ORDER_NOT_FOUND",
          message: "The purchase order was not found.",
        },
      });
      return;
    }

    const receiptsResult = await pool.query<ReceiptRow>(
      `SELECT
         id,
         purchase_order_id,
         receipt_reference,
         notes,
         received_at,
         created_at
       FROM purchase_order_receipts
       WHERE purchase_order_id = $1
       ORDER BY received_at DESC, id DESC`,
      [id],
    );

    const receiptIds = receiptsResult.rows.map((receipt) => receipt.id);

    const receiptItemsById = new Map<
      string,
      Array<{
        id: string;
        purchaseOrderItemId: string;
        productId: string;
        sku: string;
        productName: string;
        quantityReceived: number;
      }>
    >();

    for (const receipt of receiptsResult.rows) {
      receiptItemsById.set(receipt.id, []);
    }

    if (receiptIds.length > 0) {
      const itemsResult = await pool.query<ReceiptItemRow>(
        `SELECT
           ri.id,
           ri.receipt_id,
           ri.purchase_order_item_id,
           poi.product_id,
           p.sku,
           p.name AS product_name,
           ri.quantity_received
         FROM purchase_order_receipt_items AS ri
         INNER JOIN purchase_order_items AS poi
           ON poi.id = ri.purchase_order_item_id
         INNER JOIN products AS p
           ON p.id = poi.product_id
         WHERE ri.receipt_id = ANY($1::uuid[])
         ORDER BY p.name ASC, ri.id ASC`,
        [receiptIds],
      );

      for (const item of itemsResult.rows) {
        receiptItemsById.get(item.receipt_id)?.push({
          id: item.id,
          purchaseOrderItemId: item.purchase_order_item_id,
          productId: item.product_id,
          sku: item.sku,
          productName: item.product_name,
          quantityReceived: Number(item.quantity_received),
        });
      }
    }

    response.status(200).json({
      data: receiptsResult.rows.map((receipt) => ({
        id: receipt.id,
        purchaseOrderId: receipt.purchase_order_id,
        receiptReference: receipt.receipt_reference,
        notes: receipt.notes,
        receivedAt: new Date(receipt.received_at).toISOString(),
        createdAt: new Date(receipt.created_at).toISOString(),
        items: receiptItemsById.get(receipt.id) ?? [],
      })),
    });
  } catch (error) {
    sendOrderDatabaseError(error, response, "list purchase-order receipts");
  }
});