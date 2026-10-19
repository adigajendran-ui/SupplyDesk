import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import { env } from "../config/env.js";
import { pool } from "../db/pool.js";

const PostgreSqlSessionStore = connectPgSimple(session);

export const sessionMiddleware = session({
  name: "supplydesk.sid",
  secret: env.SESSION_SECRET,

  store: new PostgreSqlSessionStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false,
  }),

  resave: false,
  saveUninitialized: false,
  rolling: true,

  cookie: {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  },
});