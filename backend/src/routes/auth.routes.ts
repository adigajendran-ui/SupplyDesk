import { randomBytes } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

import {
  hashPassword,
  verifyPassword,
} from "../auth/password.js";
import {
  requireAuthenticatedUser,
} from "../auth/auth.middleware.js";
import { pool } from "../db/pool.js";

export const authRouter = Router();

type Role = "admin" | "manager" | "viewer";

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

const passwordSchema = z.string().min(12).max(128);

const userCreateSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    role: z.enum(["admin", "manager", "viewer"]).default("viewer"),
  })
  .strict();

const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();

const dummyPasswordHashPromise = hashPassword(
  "dummy-password-for-timing-equalization-only",
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "LOGIN_RATE_LIMITED",
      message: "Too many sign-in attempts. Please try again in 15 minutes.",
    },
  },
});

const requireAdmin: RequestHandler = (
  request,
  response,
  next,
) => {
  if (request.session.user?.role !== "admin") {
    response.status(403).json({
      error: {
        code: "INSUFFICIENT_PERMISSIONS",
        message: "Only administrators can manage user accounts.",
      },
    });
    return;
  }

  next();
};

function regenerateSession(
  request: Parameters<RequestHandler>[0],
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function saveSession(
  request: Parameters<RequestHandler>[0],
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

// Issue a CSRF token before a user signs in.
authRouter.get("/csrf", (request, response) => {
  request.session.csrfToken ??= randomBytes(32).toString("base64url");

  response.status(200).json({
    data: {
      csrfToken: request.session.csrfToken,
    },
  });
});

authRouter.get(
  "/me",
  requireAuthenticatedUser,
  (request, response) => {
    response.status(200).json({
      data: request.session.user,
    });
  },
);

authRouter.post(
  "/login",
  loginLimiter,
  async (request, response, next) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Enter a valid email address and password.",
        },
      });
      return;
    }

    try {
      const result = await pool.query<{
        id: string;
        email: string;
        password_hash: string;
        role: Role;
        is_active: boolean;
      }>(
        `SELECT id, email, password_hash, role, is_active
         FROM users
         WHERE lower(email) = lower($1)
         LIMIT 1`,
        [parsed.data.email],
      );

      const user = result.rows[0];

      // Verify against a dummy hash for unknown accounts to reduce
      // differences in response processing time.
      const candidateHash =
        user?.password_hash ?? (await dummyPasswordHashPromise);

      const passwordMatches = await verifyPassword(
        parsed.data.password,
        candidateHash,
      );

      if (!user || !user.is_active || !passwordMatches) {
        response.status(401).json({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Email or password is incorrect.",
          },
        });
        return;
      }

      // Rotate the session ID after successful authentication.
      await regenerateSession(request);

      request.session.user = {
        id: user.id,
        email: user.email,
        role: user.role,
      };

      request.session.csrfToken = randomBytes(32).toString("base64url");

      await saveSession(request);

      response.status(200).json({
        data: {
          user: request.session.user,
          csrfToken: request.session.csrfToken,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/logout",
  requireAuthenticatedUser,
  (request, response) => {
    request.session.destroy((error) => {
      if (error) {
        response.status(500).json({
          error: {
            code: "LOGOUT_FAILED",
            message: "Could not sign out. Please try again.",
          },
        });
        return;
      }

      response.clearCookie("supplydesk.sid", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });

      response.status(200).json({
        data: {
          success: true,
        },
      });
    });
  },
);

// Account creation is available only to an authenticated administrator.
// Never accept plaintext passwords into database queries.
authRouter.post(
  "/users",
  requireAuthenticatedUser,
  requireAdmin,
  async (request, response, next) => {
    const parsed = userCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Provide a valid email, a password of at least 12 characters, and a valid role.",
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.map(String).join("."),
            message: issue.message,
          })),
        },
      });
      return;
    }

    try {
      const passwordHash = await hashPassword(parsed.data.password);

      const result = await pool.query<{
        id: string;
        email: string;
        role: Role;
        is_active: boolean;
        created_at: Date | string;
      }>(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3)
         RETURNING id, email, role, is_active, created_at`,
        [
          parsed.data.email,
          passwordHash,
          parsed.data.role,
        ],
      );

      const created = result.rows[0];

      response.status(201).json({
        data: {
          id: created.id,
          email: created.email,
          role: created.role,
          isActive: created.is_active,
          createdAt: new Date(created.created_at).toISOString(),
        },
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        String(error.code) === "23505"
      ) {
        response.status(409).json({
          error: {
            code: "EMAIL_ALREADY_EXISTS",
            message: "An account with that email already exists.",
          },
        });
        return;
      }

      next(error);
    }
  },
);