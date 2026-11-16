import { useState, type FormEvent } from "react";
import { failIf, supabase } from "./lib";

export type Act = (task: () => Promise<void>) => Promise<void>;
export function Auth({
  act,
  notify,
}: {
  act: Act;
  notify: (text: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    void act(async () => {
      const redirectTo = `${location.origin}${import.meta.env.BASE_URL}`;
      if (mode === "register") {
        const { error, data } = await supabase!.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        failIf(error);
        if (!data.session)
          notify(
            "Check your email to confirm your account, then sign in. Reopen your Handshake link after signing in.",
          );
      } else if (mode === "reset") {
        failIf(
          (await supabase!.auth.resetPasswordForEmail(email, { redirectTo }))
            .error,
        );
        notify(
          "If this account exists, a password reset link will arrive by email.",
        );
      } else
        failIf(
          (await supabase!.auth.signInWithPassword({ email, password })).error,
        );
      setPassword("");
    });
  }
  return (
    <div className="auth-layout">
      <section className="intro">
        <span className="eyebrow">MADE FOR REAL LIFE</span>
        <h1>
          Good to meet you.
          <br />
          <span>Better to stay connected.</span>
        </h1>
        <p>
          A private place for the people you meet. Make a Handshake, choose what
          to share, and pick up where you left off.
        </p>
        <div className="principles">
          <span>◎ Mutual by choice</span>
          <span>◈ Private by default</span>
          <span>↗ Yours to manage</span>
        </div>
      </section>
      <section className="card auth-card">
        <h2>
          {mode === "register"
            ? "Create your account"
            : mode === "reset"
              ? "Reset your password"
              : "Welcome back"}
        </h2>
        <p>
          {mode === "register"
            ? "Start with your email. You’ll choose your private profile after signing in."
            : "Your people, in one quiet place."}
        </p>
        <form onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {mode !== "reset" && (
            <label>
              Password
              <input
                type="password"
                required
                minLength={mode === "register" ? 12 : undefined}
                maxLength={128}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode === "register" && (
                <small>Use at least 12 characters.</small>
              )}
            </label>
          )}
          <button type="submit">
            {mode === "register"
              ? "Create account"
              : mode === "reset"
                ? "Send reset link"
                : "Sign in"}{" "}
            <span aria-hidden="true">→</span>
          </button>
        </form>
        <div className="button-row">
          <button
            className="text-button"
            onClick={() => setMode(mode === "register" ? "login" : "register")}
          >
            {mode === "register"
              ? "Already have an account? Sign in"
              : "Create an account"}
          </button>
          <button
            className="text-button"
            onClick={() => setMode(mode === "reset" ? "login" : "reset")}
          >
            {mode === "reset" ? "Back to sign in" : "Forgot password?"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function Recovery({ act, done }: { act: Act; done: () => void }) {
  const [password, setPassword] = useState("");
  return (
    <section className="card narrow">
      <h1>Choose a new password</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            failIf((await supabase!.auth.updateUser({ password })).error);
            setPassword("");
            done();
          });
        }}
      >
        <label>
          New password
          <input
            type="password"
            minLength={12}
            maxLength={128}
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button>Save password</button>
      </form>
    </section>
  );
}
