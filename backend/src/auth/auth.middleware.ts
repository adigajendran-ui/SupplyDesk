import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

import { pool } from "../db/pool.js";

type AuthRole = "admin" | "manager" | "viewer";

function unauthenticated(
  response: Parameters<RequestHandler>[1],
): void {
  response.status(401).json({
    error: {
      code: "AUTHENTICATION_REQUIRED",
      message: "Please sign in to continue.",
    },
  });
}

export const requireAuthenticatedUser: RequestHandler = async (
  request,
  response,
  next,
) => {
  const sessionUser = request.session.user;

  if (!sessionUser) {
    unauthenticated(response);
    return;
  }

  try {
    const result = await pool.query<{
      id: string;
      email: string;
      role: AuthRole;
      is_active: boolean;
    }>(
      `SELECT id, email, role, is_active
       FROM users
       WHERE id = $1`,
      [sessionUser.id],
    );

    const user = result.rows[0];

    if (!user || !user.is_active) {
      request.session.destroy(() => {
        unauthenticated(response);
      });
      return;
    }

    // Refresh the session role from the database so role changes
    // take effect on subsequent requests.
    request.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const authorizeApiMutation: RequestHandler = (
  request,
  response,
  next,
) => {
  const isReadOnlyMethod = ["GET", "HEAD", "OPTIONS"].includes(
    request.method.toUpperCase(),
  );

  if (
    isReadOnlyMethod ||
    request.session.user?.role !== "viewer"
  ) {
    next();
    return;
  }

  response.status(403).json({
    error: {
      code: "INSUFFICIENT_PERMISSIONS",
      message: "Your account has read-only access.",
    },
  });
};

export const csrfProtection: RequestHandler = (
  request,
  response,
  next,
) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    next();
    return;
  }

  const expected = request.session.csrfToken;
  const supplied = request.get("X-CSRF-Token");

  if (!expected || !supplied) {
    response.status(403).json({
      error: {
        code: "CSRF_TOKEN_REQUIRED",
        message: "Refresh the page and try again.",
      },
    });
    return;
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    response.status(403).json({
      error: {
        code: "CSRF_TOKEN_INVALID",
        message: "The request security token is invalid. Refresh and try again.",
      },
    });
    return;
  }

  next();
};