/* ============================================================
   SiteSketch — cookie consent

   Read this before changing it.

   This site sets exactly one cookie, the HttpOnly session cookie that keeps
   you signed in. Strictly necessary cookies of that kind do not need consent
   under GDPR, and there is no analytics, no advertising and no third-party
   tracker anywhere in this codebase. So there is nothing here for you to
   actually decide.

   The banner says that outright rather than showing a wall of toggles that
   all do the same thing. Pretending a choice exists when it does not would be
   worse than having no banner: it teaches people that consent notices are
   noise, and it implies tracking that does not happen.

   What this is really for is the day something *is* added. `granted()` is the
   single gate any future Analytics or Advertising code has to pass, and the
   categories are already declared in cookies.py, so wiring up a tracker means
   adding a line to that inventory and nothing else.
   ============================================================ */
(function () {
  "use strict";

  var KEY = "sitesketch_consent_v1";
  var MONTHS = 12;

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function write(record) {
    try {
      localStorage.setItem(KEY, JSON.stringify(record));
    } catch (e) { /* private mode: the banner shows again next visit */ }
  }

  var Consent = {
    /* What the visitor has agreed to, or null if they have not been asked. */
    record: read,

    /* True when this category may be used. Essential always is: without it
       the sign-in does not work and there is no honest way to decline it. */
    granted: function (category) {
      if (category === "Essential") return true;
      var r = read();
      return !!(r && r.categories && r.categories.indexOf(category) !== -1);
    },

    save: function (categories) {
      write({
        categories: categories || [],
        essential: true,
        decidedAt: new Date().toISOString(),
        expires: new Date(Date.now() + MONTHS * 30 * 86400000).toISOString()
      });
      Consent.hide();
      document.dispatchEvent(new CustomEvent("consentchange", { detail: categories }));
    },

    /* Withdrawing is as easy as agreeing, and does not need a confirmation
       step that talks you out of it. */
    withdraw: function () {
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      Consent.show();
      document.dispatchEvent(new CustomEvent("consentchange", { detail: [] }));
    },

    show: show,
    hide: hide
  };

  function hide() {
    var el = document.getElementById("consentBar");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function show() {
    if (document.getElementById("consentBar")) return;
    if (read()) return;                       /* already decided */

    var bar = document.createElement("div");
    bar.id = "consentBar";
    bar.className = "consent-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Cookie notice");

    var text = document.createElement("div");
    text.className = "consent-text";
    text.innerHTML =
      "<strong>We use one cookie.</strong> It keeps you signed in, and it cannot " +
      "be read by scripts. We use no analytics and no advertising, so there is " +
      "nothing here to opt out of &mdash; your choices really do not change what " +
      "this site does.";

    var actions = document.createElement("div");
    actions.className = "consent-actions";

    var ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn btn-primary btn-sm";
    ok.textContent = "Got it";
    ok.addEventListener("click", function () { Consent.save(["Functional"]); });

    var manage = document.createElement("a");
    manage.className = "btn btn-ghost btn-sm";
    manage.href = "privacy.html";
    manage.textContent = "Manage preferences";
    manage.addEventListener("click", function () { Consent.hide(); });

    actions.appendChild(ok);
    actions.appendChild(manage);

    bar.appendChild(text);
    bar.appendChild(actions);
    document.body.appendChild(bar);
  }

  window.Consent = Consent;
  show();
})();
