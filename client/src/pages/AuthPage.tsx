import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Github, LockKeyhole, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function AuthPage() {
  const { loading, user } = useAuth();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<"login" | "register">(() => {
    if (typeof window === "undefined") return "login";
    return new URLSearchParams(window.location.search).get("mode") === "register" ? "register" : "login";
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => window.location.assign("/dashboard"),
    onError: error => setFormError(error.message),
  });
  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => window.location.assign("/dashboard"),
    onError: error => setFormError(error.data?.code === "CONFLICT" ? "You already have an account with this email. Try signing in instead." : error.message),
  });

  useEffect(() => {
    const oauthError = new URLSearchParams(window.location.search).get("oauth_error");
    if (oauthError === "google_not_configured") setFormError("Google login is not configured yet. Add the Google OAuth credentials to your environment.");
    if (oauthError === "github_not_configured") setFormError("GitHub login is not configured yet. Add the GitHub OAuth credentials to your environment.");
    if (oauthError === "account_exists") {
      setMode("login");
      setFormError("You already have an account with this provider. We switched you to sign in.");
    }
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

  const startProviderLogin = (provider: "google" | "github") => {
    window.location.href = `/api/auth/${provider}?intent=${mode}`;
  };

  return (
    <main className="auth-shell" aria-label="SiteSketch authentication">
      <header className="auth-header">
        <button type="button" className="auth-brand" onClick={() => setLocation("/")} aria-label="SiteSketch home">
          <span className="auth-mark" aria-hidden="true">S</span>
          <span className="font-display">SITESKETCH</span>
        </button>
        <button type="button" className="auth-back-button" onClick={() => setLocation("/")}>
          <ArrowLeft size={15} />
          <span>Back to home</span>
        </button>
      </header>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-copy">
          <span className="eyebrow text-indigo-500">Your creative workspace</span>
          <h1 id="auth-title">Plan a clearer website.</h1>
          <p>Sign in to continue, or create an account to save your projects and plans.</p>
        </div>
        <div className="auth-tabs" role="tablist" aria-label="Account options">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "auth-tab auth-tab-active" : "auth-tab"} onClick={() => { setMode("login"); setFormError(""); }}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "auth-tab auth-tab-active" : "auth-tab"} onClick={() => { setMode("register"); setFormError(""); }}>Create account</button>
        </div>
        <form onSubmit={submit}>
          {mode === "register" && <input className="auth-input" value={name} onChange={event => setName(event.target.value)} placeholder="Your name" aria-label="Your name" autoComplete="name" required />}
          <input className="auth-input" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email address" aria-label="Email address" type="email" autoComplete="email" required />
          <div className="auth-password-field">
            <input className="auth-input" value={password} onChange={event => setPassword(event.target.value)} placeholder="Password (8+ characters)" aria-label="Password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required />
            <button type="button" className="auth-password-toggle" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {formError && <p className="auth-error" role="alert">{formError}</p>}
          <button type="submit" className="auth-submit" disabled={loading || isSubmitting}>
            <LockKeyhole size={16} />
            {isSubmitting ? "Please wait..." : mode === "login" ? "Sign in to SiteSketch" : "Create my account"}
            <ArrowRight size={16} className="ml-auto" />
          </button>
        </form>
        <div className="auth-divider"><span>or continue with</span></div>
        <div className="auth-providers">
          <button type="button" className="auth-provider" onClick={() => startProviderLogin("google")}><span className="google-g">G</span>Google</button>
          <button type="button" className="auth-provider" onClick={() => startProviderLogin("github")}><Github size={16} />GitHub</button>
        </div>
        <div className="auth-promise">
          <Sparkles size={14} />
          <span>Your saved workspace is private to your account.</span>
        </div>
      </section>
    </main>
  );
}
