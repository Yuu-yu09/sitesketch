/* ============================================================
   SiteSketch — shared UI helpers + mini site compiler
   renderSite() previews the Plan JSON exactly like the real
   Jinja2 compiler will (same structure, same output contract).
   ============================================================ */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ---------- toast ---------- */
  var host = null;
  function toast(msg, icon) {
    if (!host) {
      host = document.createElement("div");
      host.className = "toast-host";
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }
    var t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = '<i class="bi ' + esc(icon || "bi-check2") + '" aria-hidden="true"></i><span>' + esc(msg) + "</span>";
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = "opacity .3s";
      t.style.opacity = "0";
      setTimeout(function () { t.remove(); }, 320);
    }, 3200);
  }

  function fmtDate(ts) {
    var d = new Date(ts), now = new Date();
    var diff = (now - d) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + " min ago";
    if (diff < 86400) return Math.floor(diff / 3600) + " hr ago";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + " day" + (Math.floor(diff / 86400) > 1 ? "s" : "") + " ago";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  }

  /* ---------- mini compiler: plan JSON -> static site HTML ---------- */

  var THEMES = {
    modern: {
      bg: "#ffffff", fg: "#1a2233", muted: "#5b667a", accent: "#2f6fed",
      font: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      radius: "10px"
    },
    classic: {
      bg: "#fdfaf4", fg: "#2b2620", muted: "#6d6355", accent: "#8a5a2b",
      font: "Georgia, 'Times New Roman', serif",
      radius: "2px"
    }
  };

  function sectionHTML(s, theme) {
    var t = esc(s.title || ""), sub = esc(s.subtitle || "");
    switch (s.type) {
      case "hero":
        return '<section class="ss-hero"><h1>' + t + '</h1><p>' + sub + '</p>' +
          '<a class="ss-btn" href="#">' + esc((s.fields && s.fields.buttonText) || "Learn more") + "</a></section>";
      case "features":
      case "products":
      case "menu":
      case "gallery":
      case "team":
      case "blog":
        var items = ["First", "Second", "Third"].map(function (w) {
          return '<div class="ss-card"><div class="ss-card-img"></div><strong>' + w + '</strong><span>' +
            (s.type === "menu" ? "Signature favorite" : "Short description goes here") + "</span></div>";
        }).join("");
        return '<section class="ss-band"><h2>' + t + '</h2><p>' + sub + '</p><div class="ss-grid">' + items + "</div></section>";
      case "testimonials":
        return '<section class="ss-band ss-soft"><h2>' + t + '</h2><blockquote>"Exactly what we needed — simple and clear."<cite>— Happy customer</cite></blockquote></section>';
      case "contact":
        return '<section class="ss-band"><h2>' + t + '</h2><p>' + sub + '</p>' +
          '<form class="ss-form" onsubmit="return false"><input placeholder="Your name" aria-label="Your name"><input placeholder="Your email" aria-label="Your email"><textarea placeholder="Your message" aria-label="Your message"></textarea><button class="ss-btn" type="submit">Send message</button></form></section>';
      case "hours":
        return '<section class="ss-band ss-soft"><h2>' + t + '</h2><p>' + sub + '</p><dl class="ss-hours"><dt>Mon – Fri</dt><dd>9:00 AM – 9:00 PM</dd><dt>Sat – Sun</dt><dd>10:00 AM – 10:00 PM</dd></dl></section>';
      case "faq":
        return '<section class="ss-band"><h2>' + t + '</h2><details><summary>Do you offer delivery?</summary><p>Yes — within the local area.</p></details><details><summary>How do I get started?</summary><p>Reach out using the contact form.</p></details></section>';
      case "cta":
        return '<section class="ss-cta"><h2>' + t + '</h2><p>' + sub + '</p><a class="ss-btn ss-btn-light" href="#">Get started</a></section>';
      case "newsletter":
        return '<section class="ss-band"><h2>' + t + '</h2><p>' + sub + '</p><form class="ss-form ss-form-row" onsubmit="return false"><input placeholder="you@example.com" aria-label="Email address"><button class="ss-btn" type="submit">Subscribe</button></form></section>';
      case "about":
      default:
        return '<section class="ss-band"><h2>' + t + '</h2><p>' + sub + '</p><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua — replace this with your own story.</p></section>';
    }
  }

  function pageHTML(plan, page) {
    var theme = THEMES[plan.meta.theme] || THEMES.modern;
    var nav = plan.pages.map(function (p) {
      return '<a href="#' + esc(p.id) + '"' + (p.id === page.id ? ' class="on"' : "") + ">" + esc(p.name) + "</a>";
    }).join("");
    var body = page.sections.map(function (s) { return sectionHTML(s, theme); }).join("\n");
    return {
      nav: nav,
      body: body,
      theme: theme
    };
  }

  /* Full document for the preview iframe (and later, export). */
  function renderSite(plan, pageId) {
    if (!plan || !plan.pages || !plan.pages.length) return "";
    var page = plan.pages.filter(function (p) { return p.id === pageId; })[0] || plan.pages[0];
    var parts = pageHTML(plan, page);
    var theme = parts.theme;
    var name = esc(plan.meta.siteName || "My Site");
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<title>" + name + "</title><style>" +
      ":root{--bg:" + theme.bg + ";--fg:" + theme.fg + ";--muted:" + theme.muted + ";--accent:" + theme.accent + ";--r:" + theme.radius + "}" +
      "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:" + theme.font + ";line-height:1.55}" +
      "header{display:flex;align-items:center;gap:1.2rem;padding:.9rem 4%;border-bottom:1px solid rgba(0,0,0,.09);position:sticky;top:0;background:var(--bg);z-index:5}" +
      "header b{font-size:1.05rem;margin-right:auto}header a{color:var(--muted);text-decoration:none;font-size:.92rem}header a.on{color:var(--fg);font-weight:600}" +
      "section{padding:2.4rem 4%}h1{font-size:clamp(1.8rem,4vw,2.8rem);margin:0 0 .4rem;line-height:1.12}h2{margin:0 0 .4rem;font-size:1.5rem}p{margin:0 0 1rem;color:var(--muted);max-width:60ch}" +
      ".ss-hero{padding-top:3.4rem;padding-bottom:3rem}.ss-btn{display:inline-block;background:var(--accent);color:#fff;border:none;border-radius:var(--r);padding:.65em 1.3em;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}" +
      ".ss-band h2{font-size:1.5rem}.ss-soft{background:rgba(0,0,0,.03)}" +
      ".ss-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin-top:1.2rem}" +
      ".ss-card{border:1px solid rgba(0,0,0,.1);border-radius:var(--r);padding:1rem;display:grid;gap:.3rem}.ss-card-img{height:70px;border-radius:6px;background:linear-gradient(135deg,rgba(0,0,0,.06),rgba(0,0,0,.12))}" +
      ".ss-card span{color:var(--muted);font-size:.88rem}.ss-price b{font-size:1.5rem}" +
      ".ss-form{display:grid;gap:.6rem;max-width:420px}.ss-form-row{grid-template-columns:1fr auto;max-width:520px}" +
      ".ss-form input,.ss-form textarea{font:inherit;padding:.6em .8em;border:1px solid rgba(0,0,0,.2);border-radius:var(--r)}" +
      ".ss-cta{background:var(--accent);color:#fff;text-align:center}.ss-cta h2,.ss-cta p{color:#fff;margin-inline:auto}.ss-btn-light{background:#fff;color:var(--accent)}" +
      "blockquote{margin:1rem 0 0;font-size:1.2rem;max-width:52ch}cite{display:block;color:var(--muted);font-size:.9rem;margin-top:.5rem}" +
      ".ss-hours{display:grid;grid-template-columns:auto 1fr;gap:.4rem 1.4rem;max-width:340px}.ss-hours dt{font-weight:600}.ss-hours dd{margin:0;color:var(--muted)}" +
      "details{border-bottom:1px solid rgba(0,0,0,.1);padding:.7rem 0;max-width:640px}summary{cursor:pointer;font-weight:600}" +
      "footer{padding:1.4rem 4%;border-top:1px solid rgba(0,0,0,.09);color:var(--muted);font-size:.85rem}" +
      "</style></head><body><header><b>" + name + "</b>" + parts.nav + "</header>" +
      parts.body +
      "<footer>&copy; " + new Date().getFullYear() + " " + name + " · Made with SiteSketch</footer>" +
      "</body></html>";
  }

  /* blueprint tree markup (used in landing showcase + builder pane) */
  function blueprintTree(plan) {
    return plan.pages.map(function (p) {
      var secs = p.sections.map(function (s) { return "<li>" + esc(s.title || s.type) + "</li>"; }).join("");
      return '<div class="bp-page"><i class="bi bi-file-earmark-richtext" aria-hidden="true"></i>' + esc(p.name) +
        '</div><ul class="bp-sections">' + (secs || "<li>No sections yet</li>") + "</ul>";
    }).join("");
  }

  window.SS = {
    esc: esc,
    toast: toast,
    fmtDate: fmtDate,
    renderSite: renderSite,
    blueprintTree: blueprintTree,
    THEMES: THEMES
  };
})();
