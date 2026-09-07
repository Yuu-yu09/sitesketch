import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function AuthPage() {
  const { loading, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && user) {
      setLocation("/dashboard");
    }
  }, [loading, setLocation, user]);

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
          <p>
            Sign in before entering your workspace so your projects, plans, and
            editor changes stay connected to your account.
          </p>
        </div>
        <button
          type="button"
          onClick={() => startLogin()}
          className="auth-submit"
          disabled={loading}
        >
          <LockKeyhole size={16} />
          Sign in to SiteSketch
          <ArrowRight size={16} className="ml-auto" />
        </button>
        <div className="auth-promise">
          <Sparkles size={14} />
          <span>Your saved workspace is private to your account.</span>
        </div>
      </section>
    </main>
  );
}
