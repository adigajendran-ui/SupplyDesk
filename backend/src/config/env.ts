import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

// The development .env file is at the SupplyDesk project root.
config({
  path: resolve(currentDirectory, "../../../.env"),
});

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  FRONTEND_ORIGIN: z.string().url(),

  DATABASE_URL: z.string().min(1),
});

const result = environmentSchema.safeParse(process.env);

if (!result.success) {
  console.error("SupplyDesk environment configuration is invalid.");
  console.error(result.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration.");
}

export const env = result.data;