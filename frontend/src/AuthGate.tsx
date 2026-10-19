import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";

import {
  AuthApiError,
  getCurrentUser,
  signIn,
  signOut,
  type AuthUser,
} from "./auth";

import "./AuthGate.css";

type AuthGateProps = {
  children: ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [startupError, setStartupError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    getCurrentUser()
      .then((currentUser) => {
        if (active) {
          setUser(currentUser);
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        if (error instanceof AuthApiError && error.status === 401) {
          setUser(null);
        } else {
          setStartupError(
            error instanceof Error
              ? error.message
              : "Could not check your sign-in status.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setChecking(false);
        }
      });

    return () => {
      active = false;
    };
  }, [retryCount]);

  function handleRetry() {
    setStartupError("");
    setChecking(true);
    setRetryCount((value) => value + 1);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setFormError("");
    setSubmitting(true);

    try {
      const signedInUser = await signIn(email.trim(), password);

      setUser(signedInUser);
      setPassword("");
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Sign-in failed. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    setFormError("");

    try {
      await signOut();

      setUser(null);
      setPassword("");
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Sign-out failed. Try again.",
      );
    }
  }

  if (checking) {
    return (
      <main className="auth-screen">
        <div className="auth-card auth-card--status" role="status">
          Checking your SupplyDesk session…
        </div>
      </main>
    );
  }

  if (startupError) {
    return (
      <main className="auth-screen">
        <section
          className="auth-card"
          aria-labelledby="auth-title"
        >
          <p className="auth-eyebrow">SUPPLYDESK</p>
          <h1 id="auth-title">Can't reach SupplyDesk</h1>
          <p className="auth-muted">{startupError}</p>

          <button
            className="auth-primary"
            type="button"
            onClick={handleRetry}
          >
            Retry connection
          </button>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <section
          className="auth-card"
          aria-labelledby="auth-title"
        >
          <div className="auth-mark" aria-hidden="true">
            S
          </div>

          <p className="auth-eyebrow">
            INVENTORY &amp; PURCHASING
          </p>

          <h1 id="auth-title">Sign in to SupplyDesk</h1>

          <p className="auth-muted">
            Use an account created by your SupplyDesk administrator.
          </p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label htmlFor="supplydesk-email">
              Email address
            </label>

            <input
              id="supplydesk-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              required
            />

            <label htmlFor="supplydesk-password">
              Password
            </label>

            <input
              id="supplydesk-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              maxLength={128}
              required
            />

            {formError && (
              <p className="auth-error" role="alert">
                {formError}
              </p>
            )}

            <button
              className="auth-primary"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="auth-footnote">
            Accounts are provisioned by an administrator.
            Public registration is disabled.
          </p>
        </section>
      </main>
    );
  }

  return (
    <>
      {children}

      <div
        className="auth-session-chip"
        aria-label={`Signed in as ${user.email}`}
      >
        <span className="auth-session-user">
          {user.email}
          <small>{user.role}</small>
        </span>

        <button type="button" onClick={handleSignOut}>
          Sign out
        </button>

        {formError && (
          <span className="auth-session-error" role="alert">
            {formError}
          </span>
        )}
      </div>
    </>
  );
}