import { useState } from "react";
import { ArrowRight, Check, ChevronDown, Menu, Sparkles, X } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

const DEFAULT_PROMPT =
  "A calm, editorial website for a small strategy studio helping ambitious teams find their next clear move.";

const promptExamples = [
  "A bold portfolio for a product designer who makes complex systems feel simple.",
  "A warm neighborhood bakery with seasonal menus and a beautiful online ordering flow.",
  "A focused SaaS landing page that turns curious visitors into confident signups.",
];

const galleryItems = [
  {
    type: "Editorial studio",
    title: "A clearer point of view.",
    description: "Warm typography, confident messaging, and space for the work to lead.",
    tone: "sand",
    label: "northstar studio",
  },
  {
    type: "Digital product",
    title: "Make complex feel simple.",
    description: "A structured product story that moves from problem to proof to action.",
    tone: "indigo",
    label: "orbit / analytics",
  },
  {
    type: "Independent maker",
    title: "Put your best work forward.",
    description: "A flexible portfolio that gives every project the attention it deserves.",
    tone: "mint",
    label: "mara kim · design",
  },
];

const steps = [
  {
    number: "01",
    title: "Describe your direction",
    body: "Start with a sentence about your audience, ambition, or the feeling you want to create.",
  },
  {
    number: "02",
    title: "Shape the structure",
    body: "SiteSketch turns your prompt into a thoughtful page plan you can refine before you build.",
  },
  {
    number: "03",
    title: "Make it yours",
    body: "Edit the details in the visual builder, save your progress, and preview the finished experience.",
  },
];

const valueCards = [
  {
    number: "01",
    title: "Start with clarity",
    body: "A focused prompt becomes a focused first draft—so you spend less time staring at a blank canvas.",
  },
  {
    number: "02",
    title: "Keep your voice",
    body: "Every suggestion is a starting point. Shape the copy, sections, and visual direction until it feels like you.",
  },
  {
    number: "03",
    title: "Stay in control",
    body: "Generate, edit, save, and preview in one calm workspace built for making decisions, not managing tools.",
  },
];

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [menuOpen, setMenuOpen] = useState(false);

  const goToAuth = (mode: "login" | "register") => {
    setMenuOpen(false);
    if (user) {
      setLocation("/dashboard");
      return;
    }
    setLocation(`/auth?mode=${mode}`);
  };

  const startBuilding = () => {
    try {
      window.localStorage.setItem("sitesketch-pending-prompt", prompt.trim());
    } catch {
      // Local storage is optional; authentication can still continue.
    }
    goToAuth("register");
  };

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <button className="landing-brand" type="button" onClick={() => scrollTo("top")} aria-label="SiteSketch home">
            <span className="landing-brand-mark" aria-hidden="true">✦</span>
            <span className="font-display">SITESKETCH</span>
          </button>

          <nav id="landing-navigation" className={menuOpen ? "landing-nav landing-nav-open" : "landing-nav"} aria-label="Primary navigation">
            <button type="button" onClick={() => scrollTo("how-it-works")}>How it works</button>
            <button type="button" onClick={() => scrollTo("examples")}>Examples</button>
            <button type="button" onClick={() => scrollTo("why-sitesketch")}>Why SiteSketch</button>
            <div className="landing-nav-actions">
              <button className="landing-nav-signin" type="button" onClick={() => goToAuth("login")}>Sign in</button>
              <button className="landing-nav-cta" type="button" onClick={() => goToAuth("register")}>
                {user ? "Open workspace" : "Create account"} <ArrowRight size={14} />
              </button>
            </div>
          </nav>

          <button
            className="landing-menu-toggle"
            type="button"
            onClick={() => setMenuOpen(value => !value)}
            aria-expanded={menuOpen}
            aria-controls="landing-navigation"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      <main id="top">
        <section className="landing-hero">
          <div className="landing-hero-grid" aria-hidden="true" />
          <div className="landing-container landing-hero-content">
            <div className="landing-eyebrow"><Sparkles size={13} /> A clearer way to build your website</div>
            <h1>Make a website<br /><em>worth finding.</em></h1>
            <p className="landing-hero-copy">
              Turn a good idea into a clear plan, a confident first draft, and a site that feels unmistakably yours.
            </p>

            <form className="landing-prompt-card" onSubmit={event => { event.preventDefault(); startBuilding(); }}>
              <label htmlFor="landing-prompt">What are you building?</label>
              <textarea
                id="landing-prompt"
                value={prompt}
                onChange={event => setPrompt(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Describe your audience, ambition, or the feeling you want to create..."
              />
              <div className="landing-prompt-footer">
                <span>{prompt.length}/500</span>
                <button type="submit" disabled={!prompt.trim()}>
                  Generate my starting point <ArrowRight size={15} />
                </button>
              </div>
            </form>
            <div className="landing-prompt-examples" aria-label="Prompt examples">
              <span>Try a starting point</span>
              <div>
              {promptExamples.map(example => (
                <button type="button" key={example} onClick={() => setPrompt(example)}>
                  {example}
                </button>
              ))}
              </div>
            </div>
            <div className="landing-trust-line">
              <span><Check size={13} /> Start free</span>
              <span><Check size={13} /> Keep your projects private</span>
              <span><Check size={13} /> Edit everything</span>
            </div>
          </div>
          <div className="landing-hero-orbit landing-hero-orbit-one" aria-hidden="true" />
          <div className="landing-hero-orbit landing-hero-orbit-two" aria-hidden="true" />
        </section>

        <section className="landing-section landing-gallery-section" id="examples" aria-labelledby="examples-title">
          <div className="landing-container">
            <div className="landing-section-heading">
              <div>
                <div className="landing-eyebrow">A few good directions</div>
                <h2 id="examples-title">Your first draft can<br /><em>feel like you.</em></h2>
              </div>
              <p>Not a template library. A thoughtful place to turn your point of view into a site people remember.</p>
            </div>
            <div className="landing-gallery">
              {galleryItems.map(item => (
                <article className={`landing-gallery-card landing-gallery-${item.tone}`} key={item.title}>
                  <div className="landing-gallery-preview" aria-hidden="true">
                    <div className="landing-gallery-browser"><i /><i /><i /><span>{item.label}</span></div>
                    <div className="landing-gallery-art">
                      <span className="landing-gallery-art-eyebrow">{item.type}</span>
                      <strong>{item.title}</strong>
                      <div className="landing-gallery-art-lines"><i /><i /><i /></div>
                      <span className="landing-gallery-art-button">Explore <ArrowRight size={10} /></span>
                    </div>
                  </div>
                  <div className="landing-gallery-copy">
                    <span>{item.type}</span>
                    <p>{item.description}</p>
                  </div>
                  <button type="button" className="landing-gallery-action" onClick={() => { setPrompt(`A ${item.type.toLowerCase()} website. ${item.description}`); scrollTo("top"); }}>
                    Try this direction <ArrowRight size={13} />
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-steps-section" id="how-it-works" aria-labelledby="steps-title">
          <div className="landing-container">
            <div className="landing-section-heading landing-section-heading-centered">
              <div className="landing-eyebrow">From thought to live direction</div>
              <h2 id="steps-title">A better way to move<br /><em>from blank page to build.</em></h2>
              <p>SiteSketch keeps the creative momentum going without taking the creative decisions away from you.</p>
            </div>
            <div className="landing-steps">
              {steps.map((step, index) => (
                <article className="landing-step" key={step.number}>
                  <div className="landing-step-number">{step.number}</div>
                  <div className="landing-step-line" aria-hidden="true"><span /></div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  {index < steps.length - 1 && <div className="landing-step-arrow" aria-hidden="true"><ChevronDown size={15} /></div>}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-values-section" id="why-sitesketch" aria-labelledby="values-title">
          <div className="landing-container landing-values-layout">
            <div className="landing-values-intro">
              <div className="landing-eyebrow">The SiteSketch difference</div>
              <h2 id="values-title">Less noise.<br /><em>More signal.</em></h2>
              <p>Good websites are not built by adding more. They are built by knowing what matters, then making it easy to see.</p>
              <button type="button" className="landing-text-link" onClick={() => goToAuth("register")}>
                Start with your idea <ArrowRight size={15} />
              </button>
            </div>
            <div className="landing-value-cards">
              {valueCards.map(card => (
                <article className="landing-value-card" key={card.number}>
                  <span>{card.number}</span>
                  <div>
                    <h3>{card.title}</h3>
                    <p>{card.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-final-cta">
          <div className="landing-container landing-final-cta-inner">
            <div className="landing-eyebrow">Your next clear move</div>
            <h2>Ready to make it real?</h2>
            <p>Bring the idea. We’ll help you find the shape.</p>
            <button type="button" className="landing-final-button" onClick={() => goToAuth("register")}>
              Start building for free <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div className="landing-brand landing-footer-brand"><span className="landing-brand-mark" aria-hidden="true">✦</span><span className="font-display">SITESKETCH</span></div>
          <p>Plan with intention. Build with confidence.</p>
          <button type="button" onClick={() => goToAuth("login")}>Sign in <ArrowRight size={13} /></button>
        </div>
      </footer>
    </div>
  );
}
