import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { sessionMiddleware } from "./auth/session.js";
import {
  authorizeApiMutation,
  csrfProtection,
  requireAuthenticatedUser,
} from "./auth/auth.middleware.js";
import { authRouter } from "./routes/auth.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { productsRouter } from "./routes/products.routes.js";
import { suppliersRouter } from "./routes/suppliers.routes.js";
import { purchaseOrdersRouter } from "./routes/purchase-orders.routes.js";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());

const allowedOrigins = new Set([env.FRONTEND_ORIGIN]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      // Permit browser-based loopback development only outside production.
      if (env.NODE_ENV !== "production") {
        try {
          const parsedOrigin = new URL(origin);

          const isLocalDevelopmentOrigin =
            parsedOrigin.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(
              parsedOrigin.hostname,
            );

          if (isLocalDevelopmentOrigin) {
            callback(null, true);
            return;
          }
        } catch {
          // Reject invalid origins below.
        }
      }

      callback(new Error("Origin is not allowed by CORS."));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-CSRF-Token",
    ],
  }),
);

app.use(express.json({ limit: "1mb" }));

// Sessions must be loaded before CSRF and authentication middleware.
app.use(sessionMiddleware);
app.use(csrfProtection);

// Liveness check: verifies the HTTP API is responding.
app.get("/api/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "supplydesk-api",
    timestamp: new Date().toISOString(),
  });
});

// Readiness check: verifies that PostgreSQL can execute a query.
app.get("/api/health/ready", async (_request, response) => {
  try {
    await pool.query("SELECT 1");

    response.status(200).json({
      status: "ready",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch {
    response.status(503).json({
      status: "not_ready",
      database: "unavailable",
    });
  }
});

// Authentication endpoints have their own authentication and role rules.
app.use("/api/auth", authRouter);

// Protect every business API. Viewers are restricted to read-only access.
app.use(
  "/api/dashboard",
  requireAuthenticatedUser,
  authorizeApiMutation,
  dashboardRouter,
);

app.use(
  "/api/products",
  requireAuthenticatedUser,
  authorizeApiMutation,
  productsRouter,
);

app.use(
  "/api/suppliers",
  requireAuthenticatedUser,
  authorizeApiMutation,
  suppliersRouter,
);

app.use(
  "/api/purchase-orders",
  requireAuthenticatedUser,
  authorizeApiMutation,
  purchaseOrdersRouter,
);

app.use((_request, response) => {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
    },
  });
});

const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400
  ) {
    response.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "The request body contains invalid JSON.",
      },
    });
    return;
  }

  console.error("Unhandled API error:", error);

  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected server error occurred.",
    },
  });
};

app.use(errorHandler);