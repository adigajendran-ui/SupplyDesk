const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/+$/, "");

let csrfToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function clearCsrfToken(): void {
  csrfToken = null;
  csrfTokenPromise = null;
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) {
    return csrfToken;
  }

  if (csrfTokenPromise) {
    return csrfTokenPromise;
  }

  csrfTokenPromise = (async () => {
    const response = await fetch(`${API_BASE_URL}/auth/csrf`, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    let payload: {
      data?: { csrfToken?: string };
      error?: { message?: string };
    };

    try {
      payload = await response.json();
    } catch {
      throw new Error(
        "The API returned an invalid security-token response.",
      );
    }

    if (!response.ok || !payload.data?.csrfToken) {
      throw new Error(
        payload.error?.message ??
          "Could not obtain a request security token.",
      );
    }

    csrfToken = payload.data.csrfToken;
    return csrfToken;
  })();

  try {
    return await csrfTokenPromise;
  } finally {
    csrfTokenPromise = null;
  }
}

export async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  const method = (options.method ?? "GET").toUpperCase();

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", await getCsrfToken());
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });
}

export { API_BASE_URL };