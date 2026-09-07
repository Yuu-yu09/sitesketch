import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function AuthPage() {
  const { loading, user } = useAuth();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => setLocation("/dashboard"),
    onError: error => setFormError(error.message),
  });
  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => setLocation("/dashboard"),
    onError: error => setFormError(error.message),
  });

  useEffect(() => {
    if (!loading && user) {
      setLocation("/dashboard");
    }
  }, [loading, setLocation, user]);

  const isSubmitting = loginMutation.isPending || registerMutation.isPending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (mode === "login") {
      loginMutation.mutate({ email, password });
    } else {
      registerMutation.mutate({ name, email, password });
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <div className="auth-mark">✦</div>
          <span className="font-display">SITESKETCH</span>
        </div>
        <div className="auth-copy">
          <span className="eyebrow text-indigo-500">Your creative workspace</span>
          <h1 id="auth-title">Plan a clearer website.</h1>
          <p>Sign in to continue, or create an account to save your projects and plans.</p>
        </div>
        <div className="auth-tabs" role="tablist" aria-label="Account options">
          <button type="button" className={mode === "login" ? "auth-tab auth-tab-active" : "auth-tab"} onClick={() => { setMode("login"); setFormError(""); }}>Sign in</button>
          <button type="button" className={mode === "register" ? "auth-tab auth-tab-active" : "auth-tab"} onClick={() => { setMode("register"); setFormError(""); }}>Create account</button>
        </div>
        <form onSubmit={submit}>
          {mode === "register" && <input className="auth-input" value={name} onChange={event => setName(event.target.value)} placeholder="Your name" autoComplete="name" required />}
          <input className="auth-input" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email address" type="email" autoComplete="email" required />
          <input className="auth-input" value={password} onChange={event => setPassword(event.target.value)} placeholder="Password (8+ characters)" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required />
          {formError && <p className="auth-error" role="alert">{formError}</p>}
          <button type="submit" className="auth-submit" disabled={loading || isSubmitting}>
            <LockKeyhole size={16} />
            {isSubmitting ? "Please wait..." : mode === "login" ? "Sign in to SiteSketch" : "Create my account"}
            <ArrowRight size={16} className="ml-auto" />
          </button>
        </form>
        <div className="auth-promise">
          <Sparkles size={14} />
          <span>Your saved workspace is private to your account.</span>
        </div>
      </section>
    </main>
  );
}
