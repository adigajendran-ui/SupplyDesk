import {
  API_BASE_URL,
  apiFetch,
  clearCsrfToken,
  setCsrfToken,
} from "./authTransport";

export type AuthRole = "admin" | "manager" | "viewer";

export type AuthUser = {
  id: string;
  email: string;
  role: AuthRole;
};

type AuthResponse<T> = {
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
};

export class AuthApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  let payload: AuthResponse<T>;

  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(
      "The SupplyDesk API returned an invalid response.",
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new AuthApiError(
      payload.error?.message ??
        `The request failed with HTTP ${response.status}.`,
      response.status,
    );
  }

  return payload.data as T;
}

export async function getCurrentUser(): Promise<AuthUser> {
  let response: Response;

  try {
    response = await apiFetch(`${API_BASE_URL}/auth/me`);
  } catch (error) {
    throw new Error(
      "Could not connect to the SupplyDesk API. Check that the backend is running on port 3001.",
      { cause: error },
    );
  }

  return readResponse<AuthUser>(response);
}

export async function signIn(
  email: string,
  password: string,
): Promise<AuthUser> {
  let response: Response;

  try {
    response = await apiFetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    if (error instanceof AuthApiError) {
      throw error;
    }

    throw new Error(
      "Could not connect to the SupplyDesk API. Check that the backend is running on port 3001.",
      { cause: error },
    );
  }

  const data = await readResponse<{
    user: AuthUser;
    csrfToken: string;
  }>(response);

  setCsrfToken(data.csrfToken);

  return data.user;
}

export async function signOut(): Promise<void> {
  let response: Response;

  try {
    response = await apiFetch(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
    });
  } catch (error) {
    throw new Error(
      "Could not connect to the SupplyDesk API. Check that the backend is running on port 3001.",
      { cause: error },
    );
  }

  await readResponse<{ success: boolean }>(response);
  clearCsrfToken();
}