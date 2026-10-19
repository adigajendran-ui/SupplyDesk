import { z } from "zod";

import { hashPassword } from "../auth/password.js";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

const roleSchema = z.enum(["admin", "manager", "viewer"]);

async function main(): Promise<void> {
  const emailResult = emailSchema.safeParse(
    process.env.SUPPLYDESK_NEW_USER_EMAIL,
  );

  const password = process.env.SUPPLYDESK_NEW_USER_PASSWORD;

  const roleResult = roleSchema.safeParse(
    process.env.SUPPLYDESK_NEW_USER_ROLE ?? "admin",
  );

  if (!emailResult.success) {
    throw new Error(
      "Set SUPPLYDESK_NEW_USER_EMAIL to a valid email address.",
    );
  }

  if (!password || password.length < 12 || password.length > 128) {
    throw new Error(
      "Set SUPPLYDESK_NEW_USER_PASSWORD to a password between 12 and 128 characters.",
    );
  }

  if (!roleResult.success) {
    throw new Error(
      "SUPPLYDESK_NEW_USER_ROLE must be admin, manager, or viewer.",
    );
  }

  try {
    const passwordHash = await hashPassword(password);

    const result = await pool.query<{
      id: string;
      email: string;
      role: string;
    }>(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, email, role`,
      [
        emailResult.data,
        passwordHash,
        roleResult.data,
      ],
    );

    console.log(
      `Created SupplyDesk user ${result.rows[0].email} with role ${result.rows[0].role}.`,
    );
  } finally {
    await pool.end();
  }
}

// Importing env ensures the root .env is loaded and validated first.
void env;

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown error.";

  console.error(`User creation failed: ${message}`);
  process.exitCode = 1;
});