import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "./pool.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

const migrationsDirectory = resolve(
  currentDirectory,
  "migrations",
);

async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/i.test(filename))
    .sort();

  if (migrationFiles.length === 0) {
    console.log("No database migrations were found.");
    return;
  }

  for (const filename of migrationFiles) {
    const alreadyApplied = await pool.query(
      `SELECT filename
       FROM schema_migrations
       WHERE filename = $1`,
      [filename],
    );

    if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
      console.log(`SKIPPED ${filename} (already applied)`);
      continue;
    }

    const sql = await readFile(
      resolve(migrationsDirectory, filename),
      "utf8",
    );

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(sql);

      await client.query(
        `INSERT INTO schema_migrations (filename)
         VALUES ($1)`,
        [filename],
      );

      await client.query("COMMIT");

      console.log(`APPLIED ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`FAILED ${filename}`);
      throw error;
    } finally {
      client.release();
    }
  }

  console.log("Database migrations completed.");
}

async function main(): Promise<void> {
  try {
    await runMigrations();
  } catch (error) {
    console.error("Database migration failed.");

    if (error instanceof Error) {
      console.error(error.message);
    }

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();