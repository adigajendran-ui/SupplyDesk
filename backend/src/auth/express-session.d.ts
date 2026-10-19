import "express-session";

type SupplyDeskRole = "admin" | "manager" | "viewer";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: string;
      email: string;
      role: SupplyDeskRole;
    };

    csrfToken?: string;
  }
}