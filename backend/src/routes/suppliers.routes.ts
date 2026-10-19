import { Router, type Response } from "express";
import { z } from "zod";

import { pool } from "../db/pool.js";

export const suppliersRouter = Router();

type SupplierRow = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

const supplierColumns = `
  id,
  name,
  contact_name,
  email,
  phone,
  address,
  notes,
  is_active,
  created_at,
  updated_at
`;

const uuidSchema = z.string().uuid();

const nullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase())
  .nullable()
  .optional();

const createSupplierSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    contactName: nullableText(120),
    email: emailSchema,
    phone: nullableText(40),
    address: nullableText(2000),
    notes: nullableText(1000),
  })
  .strict();

const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    contactName: nullableText(120),
    email: emailSchema,
    phone: nullableText(40),
    address: nullableText(2000),
    notes: nullableText(1000),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.values(value).some((entry) => entry !== undefined),
    { message: "Provide at least one supplier field to update." },
  );

const listSuppliersSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "inactive"]).default("active"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function toSupplier(row: SupplierRow) {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    isActive: row.is_active,
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
  const result = uuidSchema.safeParse(value);

  if (!result.success) {
    response.status(400).json({
      error: {
        code: "INVALID_ID",
        message: "The supplier ID must be a valid UUID.",
      },
    });
    return null;
  }

  return result.data;
}

function sendSupplierDatabaseError(
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
        code: "DUPLICATE_SUPPLIER_EMAIL",
        message: "A supplier with that email address already exists.",
      },
    });
    return;
  }

  if (code === "23514" || code === "23502" || code === "22001") {
    response.status(400).json({
      error: {
        code: "INVALID_DATA",
        message: "The supplied supplier data is invalid.",
      },
    });
    return;
  }

  console.error(`Supplier operation failed: ${operation}`, error);

  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "The supplier operation could not be completed.",
    },
  });
}

// GET /api/suppliers
suppliersRouter.get("/", async (request, response) => {
  const parsed = listSuppliersSchema.safeParse(request.query);

  if (!parsed.success) {
    sendValidationError(response, parsed.error.issues);
    return;
  }

  const { search, status, page, limit } = parsed.data;
  const conditions: string[] = [];
  const values: (string | number | boolean)[] = [];

  if (search) {
    values.push(`%${search}%`);
    const position = values.length;

    conditions.push(`(
      name ILIKE $${position}
      OR COALESCE(contact_name, '') ILIKE $${position}
      OR COALESCE(email, '') ILIKE $${position}
      OR COALESCE(phone, '') ILIKE $${position}
    )`);
  }

  if (status === "active" || status === "inactive") {
    values.push(status === "active");
    conditions.push(`is_active = $${values.length}`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const countResult = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM suppliers
       ${whereClause}`,
      values,
    );

    const total = Number(countResult.rows[0]?.total ?? 0);

    const result = await pool.query<SupplierRow>(
      `SELECT ${supplierColumns}
       FROM suppliers
       ${whereClause}
       ORDER BY name ASC, id ASC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit],
    );

    response.status(200).json({
      data: result.rows.map(toSupplier),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendSupplierDatabaseError(error, response, "list suppliers");
  }
});

// POST /api/suppliers
suppliersRouter.post("/", async (request, response) => {
  const parsed = createSupplierSchema.safeParse(request.body);

  if (!parsed.success) {
    sendValidationError(response, parsed.error.issues);
    return;
  }

  const supplier = parsed.data;

  try {
    const result = await pool.query<SupplierRow>(
      `INSERT INTO suppliers (
        name,
        contact_name,
        email,
        phone,
        address,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING ${supplierColumns}`,
      [
        supplier.name,
        supplier.contactName ?? null,
        supplier.email ?? null,
        supplier.phone ?? null,
        supplier.address ?? null,
        supplier.notes ?? null,
      ],
    );

    response.status(201).json({
      data: toSupplier(result.rows[0]),
    });
  } catch (error) {
    sendSupplierDatabaseError(error, response, "create supplier");
  }
});

// GET /api/suppliers/:id
suppliersRouter.get("/:id", async (request, response) => {
  const id = readId(request.params.id, response);
  if (!id) return;

  try {
    const result = await pool.query<SupplierRow>(
      `SELECT ${supplierColumns}
       FROM suppliers
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      response.status(404).json({
        error: {
          code: "SUPPLIER_NOT_FOUND",
          message: "The supplier was not found.",
        },
      });
      return;
    }

    response.status(200).json({
      data: toSupplier(result.rows[0]),
    });
  } catch (error) {
    sendSupplierDatabaseError(error, response, "get supplier");
  }
});

// PATCH /api/suppliers/:id
suppliersRouter.patch("/:id", async (request, response) => {
  const id = readId(request.params.id, response);
  if (!id) return;

  const parsed = updateSupplierSchema.safeParse(request.body);

  if (!parsed.success) {
    sendValidationError(response, parsed.error.issues);
    return;
  }

  const updates = parsed.data;

  const columns = {
    name: "name",
    contactName: "contact_name",
    email: "email",
    phone: "phone",
    address: "address",
    notes: "notes",
    isActive: "is_active",
  } as const;

  const entries = (
    Object.entries(updates) as [
      keyof typeof columns,
      string | boolean | null | undefined,
    ][]
  ).filter(([, value]) => value !== undefined);

  const values = entries.map(([, value]) => value);
  const assignments = entries.map(
    ([field], index) => `${columns[field]} = $${index + 1}`,
  );

  values.push(id);

  try {
    const result = await pool.query<SupplierRow>(
      `UPDATE suppliers
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING ${supplierColumns}`,
      values,
    );

    if (result.rows.length === 0) {
      response.status(404).json({
        error: {
          code: "SUPPLIER_NOT_FOUND",
          message: "The supplier was not found.",
        },
      });
      return;
    }

    response.status(200).json({
      data: toSupplier(result.rows[0]),
    });
  } catch (error) {
    sendSupplierDatabaseError(error, response, "update supplier");
  }
});