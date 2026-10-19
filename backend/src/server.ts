import { createServer } from "node:http";

import { app } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";

const server = createServer(app);

server.listen(env.PORT, "127.0.0.1", () => {
  console.log(`SupplyDesk API listening on http://127.0.0.1:${env.PORT}`);
  console.log(`Environment: ${env.NODE_ENV}`);
  console.log("Health endpoint: /api/health");
  console.log("Readiness endpoint: /api/health/ready");
});

let isShuttingDown = false;

function shutdown(signal: string): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}. Shutting down SupplyDesk API...`);

  const forceShutdown = setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, 10_000);

  forceShutdown.unref();

  server.close(async (error) => {
    try {
      await pool.end();

      if (error) {
        console.error("HTTP server shutdown failed:", error);
        process.exitCode = 1;
      }
    } catch (poolError) {
      console.error("Database pool shutdown failed:", poolError);
      process.exitCode = 1;
    } finally {
      clearTimeout(forceShutdown);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));