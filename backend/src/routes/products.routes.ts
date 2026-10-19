import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { pool } from "../db/pool.js";

export const productsRouter = Router();

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  reorder_point: number;
  unit_cost: string | number;
  location: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type MovementRow = {
  id: string;
  product_id: string;
  movement_type: string;
  quantity_delta: number;
  quantity_after: number;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: Date | string;
};

const productColumns = `
  id,
  sku,
  name,
  category,
  quantity,
  reorder_point,
  unit_cost,
  location,
  created_at,
  updated_at
`;

const uuidSchema = z.string().uuid();

const nameSchema = z.string().trim().min(1).max(120);
const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .transform((value) => value.toUpperCase());
const categorySchema = z.string().trim().min(1).max(80);
const locationSchema = z.string().trim().min(1).max(80);
const quantitySchema = z
  .number()
  .int()
  .min(0)
  .max(2_147_483_647);
const unitCostSchema = z
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999.99);

const createProductSchema = z
  .object({
    sku: skuSchema,
    name: nameSchema,
    category: categorySchema,
    quantity: quantitySchema,
    reorderPoint: quantitySchema,
    unitCost: unitCostSchema,
    location: locationSchema,
  })
  .strict();

const updateProductSchema = z
  .object({
    sku: skuSchema,
    name: nameSchema,
    category: categorySchema,
    reorderPoint: quantitySchema,
    unitCost: unitCostSchema,
    location: locationSchema,
  })
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one product field to update.",
  });

const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
  status: z
    .enum(["all", "in-stock", "low-stock", "out-of-stock"])
    .default("all"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(["name", "sku", "category", "quantity", "unitCost", "updatedAt"])
    .default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const movementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const adjustmentSchema = z
  .object({
    delta: z
      .number()
      .int()
      .min(-2_147_483_647)
      .max(2_147_483_647)
      .refine((value) => value !== 0, {
        message: "The stock adjustment cannot be zero.",
      }),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

type ProductInput = z.infer<typeof createProductSchema>;
type ProductUpdate = z.infer<typeof updateProductSchema>;

function toProduct(row: ProductRow) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    quantity: Number(row.quantity),
    reorderPoint: Number(row.reorder_point),
    unitCost: Number(row.unit_cost),
    location: row.location,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toMovement(row: MovementRow) {
  return {
    id: row.id,
    productId: row.product_id,
    movementType: row.movement_type,
    quantityDelta: Number(row.quantity_delta),
    quantityAfter: Number(row.quantity_after),
    reason: row.reason,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function sendValidationError(
  response: Response,
  issues: Array<{ path: PropertyKey[]; message: string }>,
) {
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

function sendDatabaseError(
  error: unknown,
  response: Response,
  operation: string,
) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;

  if (code === "23505") {
    response.status(409).json({
      error: {
        code: "DUPLICATE_RESOURCE",
        message: "A product with that SKU already exists.",
      },
    });
    return;
  }

  if (
    code === "23514" ||
    code === "23502" ||
    code === "22P02" ||
    code === "22003" ||
    code === "22001"
  ) {
    response.status(400).json({
      error: {
        code: "INVALID_DATA",
        message: "The supplied data violates a product constraint.",
      },
    });
    return;
  }

  if (code === "23503") {
    response.status(409).json({
      error: {
        code: "RELATED_RESOURCE_CONFLICT",
        message: "The operation conflicts with related records.",
      },
    });
    return;
  }

  console.error(`Database operation failed: ${operation}`, error);

  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "The operation could not be completed.",
    },
  });
}

function readId(value: string, response: Response): string | null {
  const result = uuidSchema.safeParse(value);

  if (!result.success) {
    response.status(400).json({
      error: {
        code: "INVALID_ID",
        message: "The resource ID must be a valid UUID.",
      },
    });
    return null;
  }

  return result.data;
}

// GET /api/products
// Supports search, category/status filtering, pagination, and sorting.
productsRouter.get("/", async (request, response) => {
  const parsedQuery = listQuerySchema.safeParse(request.query);

  if (!parsedQuery.success) {
    sendValidationError(response, parsedQuery.error.issues);
    return;
  }

  const {
    search,
    category,
    status,
    page,
    limit,
    sortBy,
    sortOrder,
  } = parsedQuery.data;

  const conditions: string[] = [];
  const parameters: (string | number)[] = [];

  if (search) {
    parameters.push(`%${search}%`);
    const position = parameters.length;

    conditions.push(`
      (
        name ILIKE $${position}
        OR sku ILIKE $${position}
        OR category ILIKE $${position}
        OR location ILIKE $${position}
      )
    `);
  }

  if (category) {
    parameters.push(category);
    conditions.push(`category = $${parameters.length}`);
  }

  if (status === "in-stock") {
    conditions.push("quantity > reorder_point");
  } else if (status === "low-stock") {
    conditions.push("quantity > 0 AND quantity <= reorder_point");
  } else if (status === "out-of-stock") {
    conditions.push("quantity = 0");
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sortColumns: Record<typeof sortBy, string> = {
    name: "name",
    sku: "sku",
    category: "category",
    quantity: "quantity",
    unitCost: "unit_cost",
    updatedAt: "updated_at",
  };

  const sortColumn = sortColumns[sortBy];
  const direction = sortOrder === "asc" ? "ASC" : "DESC";
  const offset = (page - 1) * limit;

  try {
    const countResult = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM products
       ${whereClause}`,
      parameters,
    );

    const total = Number(countResult.rows[0]?.total ?? 0);

    const dataResult = await pool.query<ProductRow>(
      `SELECT ${productColumns}
       FROM products
       ${whereClause}
       ORDER BY ${sortColumn} ${direction}, id ASC
       LIMIT $${parameters.length + 1}
       OFFSET $${parameters.length + 2}`,
      [...parameters, limit, offset],
    );

    response.status(200).json({
      data: dataResult.rows.map(toProduct),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendDatabaseError(error, response, "list products");
  }
});

// POST /api/products
// The product and its opening stock movement are committed together.
productsRouter.post("/", async (request, response) => {
  const parsedBody = createProductSchema.safeParse(request.body);

  if (!parsedBody.success) {
    sendValidationError(response, parsedBody.error.issues);
    return;
  }

  const product: ProductInput = parsedBody.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<ProductRow>(
      `INSERT INTO products (
        sku,
        name,
        category,
        quantity,
        reorder_point,
        unit_cost,
        location
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${productColumns}`,
      [
        product.sku,
        product.name,
        product.category,
        product.quantity,
        product.reorderPoint,
        product.unitCost,
        product.location,
      ],
    );

    const createdProduct = result.rows[0];

    if (createdProduct.quantity > 0) {
      await client.query(
        `INSERT INTO stock_movements (
          product_id,
          movement_type,
          quantity_delta,
          quantity_after,
          reason
        )
        VALUES ($1, 'opening_balance', $2, $3, $4)`,
        [
          createdProduct.id,
          createdProduct.quantity,
          createdProduct.quantity,
          "Opening balance recorded when product was created.",
        ],
      );
    }

    await client.query("COMMIT");

    response.status(201).json({
      data: toProduct(createdProduct),
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Product creation rollback failed:", rollbackError);
    }

    sendDatabaseError(error, response, "create product");
  } finally {
    client.release();
  }
});

// GET /api/products/categories
productsRouter.get("/categories", async (_request, response) => {
  try {
    const result = await pool.query<{ category: string }>(`
      SELECT DISTINCT category
      FROM products
      ORDER BY category ASC
    `);

    response.status(200).json({
      data: result.rows.map((row) => row.category),
    });
  } catch (error) {
    sendDatabaseError(error, response, "list product categories");
  }
});
// GET /api/products/:id
productsRouter.get("/:id", async (request, response) => {
  const id = readId(request.params.id, response);

  if (!id) return;

  try {
    const result = await pool.query<ProductRow>(
      `SELECT ${productColumns}
       FROM products
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      response.status(404).json({
        error: {
          code: "PRODUCT_NOT_FOUND",
          message: "The requested product was not found.",
        },
      });
      return;
    }

    response.status(200).json({
      data: toProduct(result.rows[0]),
    });
  } catch (error) {
    sendDatabaseError(error, response, "retrieve product");
  }
});

// PATCH /api/products/:id
// Stock quantity is intentionally excluded from this route.
productsRouter.patch("/:id", async (request, response) => {
  const id = readId(request.params.id, response);

  if (!id) return;

  const parsedBody = updateProductSchema.safeParse(request.body);

  if (!parsedBody.success) {
    sendValidationError(response, parsedBody.error.issues);
    return;
  }

  const updates: ProductUpdate = parsedBody.data;

  const columns: Record<keyof ProductUpdate, string> = {
    sku: "sku",
    name: "name",
    category: "category",
    reorderPoint: "reorder_point",
    unitCost: "unit_cost",
    location: "location",
  };

  const entries = Object.entries(updates) as [
    keyof ProductUpdate,
    ProductUpdate[keyof ProductUpdate],
  ][];

  const assignments = entries.map(
    ([field], index) => `${columns[field]} = $${index + 1}`,
  );

  const values = entries.map(([, value]) => value);
  values.push(id);

  try {
    const result = await pool.query<ProductRow>(
      `UPDATE products
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING ${productColumns}`,
      values,
    );

    if (result.rows.length === 0) {
      response.status(404).json({
        error: {
          code: "PRODUCT_NOT_FOUND",
          message: "The requested product was not found.",
        },
      });
      return;
    }

    response.status(200).json({
      data: toProduct(result.rows[0]),
    });
  } catch (error) {
    sendDatabaseError(error, response, "update product");
  }
});

// POST /api/products/:id/adjustments
// Locks the product row and records its movement in one transaction.
productsRouter.post("/:id/adjustments", async (request, response) => {
  const id = readId(request.params.id, response);

  if (!id) return;

  const parsedBody = adjustmentSchema.safeParse(request.body);

  if (!parsedBody.success) {
    sendValidationError(response, parsedBody.error.issues);
    return;
  }

  const { delta, reason } = parsedBody.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentResult = await client.query<ProductRow>(
      `SELECT ${productColumns}
       FROM products
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    if (currentResult.rows.length === 0) {
      await client.query("ROLLBACK");

      response.status(404).json({
        error: {
          code: "PRODUCT_NOT_FOUND",
          message: "The requested product was not found.",
        },
      });
      return;
    }

    const current = currentResult.rows[0];
    const newQuantity = current.quantity + delta;

    if (newQuantity < 0) {
      await client.query("ROLLBACK");

      response.status(409).json({
        error: {
          code: "INSUFFICIENT_STOCK",
          message: "This adjustment would make inventory negative.",
          currentQuantity: current.quantity,
          requestedDelta: delta,
        },
      });
      return;
    }

    const updatedResult = await client.query<ProductRow>(
      `UPDATE products
       SET quantity = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING ${productColumns}`,
      [newQuantity, id],
    );

    const updatedProduct = updatedResult.rows[0];
    const movementType = delta > 0 ? "adjustment_in" : "adjustment_out";

    const movementResult = await client.query<MovementRow>(
      `INSERT INTO stock_movements (
        product_id,
        movement_type,
        quantity_delta,
        quantity_after,
        reason
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        product_id,
        movement_type,
        quantity_delta,
        quantity_after,
        reason,
        reference_type,
        reference_id,
        created_at`,
      [id, movementType, delta, newQuantity, reason],
    );

    await client.query("COMMIT");

    response.status(200).json({
      data: {
        product: toProduct(updatedProduct),
        movement: toMovement(movementResult.rows[0]),
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Stock adjustment rollback failed:", rollbackError);
    }

    sendDatabaseError(error, response, "adjust product stock");
  } finally {
    client.release();
  }
});

// GET /api/products/:id/movements
productsRouter.get("/:id/movements", async (request, response) => {
  const id = readId(request.params.id, response);

  if (!id) return;

  const parsedQuery = movementQuerySchema.safeParse(request.query);

  if (!parsedQuery.success) {
    sendValidationError(response, parsedQuery.error.issues);
    return;
  }

  const { page, limit } = parsedQuery.data;
  const offset = (page - 1) * limit;

  try {
    const productResult = await pool.query(
      "SELECT id FROM products WHERE id = $1",
      [id],
    );

    if (productResult.rows.length === 0) {
      response.status(404).json({
        error: {
          code: "PRODUCT_NOT_FOUND",
          message: "The requested product was not found.",
        },
      });
      return;
    }

    const countResult = await pool.query<{ total: number }>(
      "SELECT COUNT(*)::int AS total FROM stock_movements WHERE product_id = $1",
      [id],
    );

    const total = Number(countResult.rows[0]?.total ?? 0);

    const movementResult = await pool.query<MovementRow>(
      `SELECT
        id,
        product_id,
        movement_type,
        quantity_delta,
        quantity_after,
        reason,
        reference_type,
        reference_id,
        created_at
      FROM stock_movements
      WHERE product_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );

    response.status(200).json({
      data: movementResult.rows.map(toMovement),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendDatabaseError(error, response, "list stock movements");
  }
});