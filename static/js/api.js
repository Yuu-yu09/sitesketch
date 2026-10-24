/* ============================================================
   SiteSketch — client data layer

   Talks to the real Flask API (/api/*) with a JWT. Accounts and
   projects live in Supabase Postgres, so anything created on any
   device is there on the next load.

   The catalogue data below (site types, goals, section library) is
   static and also seeded into Postgres for reference.
   ============================================================ */
(function () {
  "use strict";

  var TOKEN_KEY = "sitesketch_token_v1";
  var USER_KEY = "sitesketch_user_v1";
  var EMAIL_KEY = "sitesketch_last_email_v1";
  var PREF_KEY = "sitesketch_remember_pref_v1";

  /* There is deliberately no refresh token in web storage any more. It is an
     HttpOnly cookie the browser attaches on its own, so a script that manages
     to run on the page cannot read it. The access token below is the only
     credential in storage and it expires in 30 minutes. */

  /* ---------------- transport ---------------- */

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function preference(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }

  function rememberPreference(value) {
    try { localStorage.setItem(PREF_KEY, value ? "1" : "0"); } catch (e) { /* private mode */ }
  }

  /* Remembered between visits so the login form is not empty every time.
     Only the address - never the password. */
  function rememberedEmail() {
    try { return localStorage.getItem(EMAIL_KEY) || ""; } catch (e) { return ""; }
  }

  function rememberEmail(value) {
    try {
      if (value) localStorage.setItem(EMAIL_KEY, value);
      else localStorage.removeItem(EMAIL_KEY);
    } catch (e) { /* private mode */ }
  }

  /* One refresh at a time. Several requests can come back 401 together, and
     without this they would each try to refresh, racing each other and
     occasionally wiping the session they were trying to rescue. */
  /* A request that never answers leaves a button stuck on its spinner with no
     way out, which reads as a broken app rather than a slow one. Bound it
     and say what happened. */
  var REQUEST_TIMEOUT = 25000;

  function fetchWithTimeout(url, options, ms) {
    if (typeof AbortController === "undefined" || !ms) {
      return fetch(url, options);
    }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .then(function (res) { clearTimeout(timer); return res; },
            function (err) {
              clearTimeout(timer);
              if (err && err.name === "AbortError") {
                var slow = new Error("timeout");
                slow.isTimeout = true;
                throw slow;
              }
              throw err;
            });
  }

  var refreshing = null;

  function renew() {
    if (refreshing) return refreshing;

    refreshing = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin"
    }).then(function (res) {
      if (!res.ok) return false;
      return res.json().then(function (data) {
        if (!data || !data.token) return false;
        try { localStorage.setItem(TOKEN_KEY, data.token); } catch (e) { /* private mode */ }
        return true;
      });
    }).catch(function () {
      return false;
    }).then(function (ok) {
      refreshing = null;
      if (!ok) clearSession();
      return ok;
    });

    return refreshing;
  }

  function send(path, options, attempt) {
    options = options || {};
    var headers = options.headers || {};
    if (token()) headers.Authorization = "Bearer " + token();
    if (options.body) headers["Content-Type"] = "application/json";

    return fetchWithTimeout(path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }, options.timeout || REQUEST_TIMEOUT).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

        if (res.status === 401) {
          /* An expired access token is not a failed session: refresh it and
             replay the request once before bothering the user. */
          if (attempt < 1) {
            return renew().then(function (ok) {
              if (ok) return send(path, options, attempt + 1);
              return { ok: false, status: 401, error: (data && data.error) || "Please sign in again." };
            });
          }
          if (attempt === 0) clearSession();
          return { ok: false, status: 401, error: (data && data.error) || "Please sign in again." };
        }
        if (!res.ok) {
          return { ok: false, status: res.status, error: (data && data.error) || "Something went wrong." };
        }
        return { ok: true, status: res.status, data: data };
      });
    }).catch(function (err) {
      if (err && err.isTimeout) {
        return { ok: false, status: 0, timeout: true,
                 error: "The server is taking too long to answer. Try again in a moment." };
      }
      return { ok: false, status: 0, error: "Cannot reach the server. Check your connection." };
    });
  }

  function request(path, options) {
    return send(path, options, 0);
  }

  function setSession(tokenValue, user, remember) {
    try {
      localStorage.setItem(TOKEN_KEY, tokenValue);
      /* the screens render user.name; normalise whatever the API sends */
      localStorage.setItem(USER_KEY, JSON.stringify(Object.assign({}, user, {
        name: user.name || user.username || user.email
      })));
      if (user && user.email) rememberEmail(user.email);
    } catch (e) { /* private mode */ }
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) { /* ignore */ }
    /* Ask the server to drop the cookie too. Fire and forget: whether this
       succeeds must not decide whether the local copy is cleared. */
    try {
      fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
        .catch(function () { /* offline */ });
    } catch (e) { /* ignore */ }
  }

  /* ---------- seed data (mirrors supabase/seed.sql later) ---------- */

  var TYPES = [
    { id: "business",   name: "Business",      icon: "bi-briefcase",     desc: "Services, trust, and contact for a company" },
    { id: "portfolio",  name: "Portfolio",     icon: "bi-easel",         desc: "Show your work and get noticed" },
    { id: "restaurant", name: "Restaurant",    icon: "bi-cup-hot",       desc: "Menu, hours, and location" },
    { id: "store",      name: "Online Store",  icon: "bi-shop",          desc: "Products, launches, and sales" },
    { id: "school",     name: "School Project", icon: "bi-mortarboard",  desc: "Class info, events, and signups" },
    { id: "blog",       name: "Blog",          icon: "bi-journal-richtext", desc: "Articles, updates, and readers" }
  ];

  var GOALS = {
    business: [
      { id: "get-contact",  name: "Get contacted by customers" },
      { id: "show-services", name: "Show my services" },
      { id: "build-trust",  name: "Build trust with visitors" }
    ],
    portfolio: [
      { id: "showcase-work", name: "Showcase my work" },
      { id: "get-hired",     name: "Get hired or find clients" }
    ],
    restaurant: [
      { id: "take-reservations", name: "Take reservations" },
      { id: "show-menu",         name: "Show the menu" },
      { id: "find-location",     name: "Help people find us" }
    ],
    store: [
      { id: "sell-products",   name: "Sell products" },
      { id: "announce-launch", name: "Announce a launch" }
    ],
    school: [
      { id: "share-info",    name: "Share project information" },
      { id: "collect-signups", name: "Collect signups" }
    ],
    blog: [
      { id: "publish-articles", name: "Publish articles" },
      { id: "grow-readers",     name: "Grow my readers" }
    ]
  };

  /* Section library */
  var SECTIONS = {
    hero:        { name: "Hero",           icon: "bi-window",      blurb: "Big headline + one button at the top" },
    about:       { name: "About",          icon: "bi-person",      blurb: "Who you are and what you do" },
    features:    { name: "Features",       icon: "bi-grid",        blurb: "What you offer, in tidy blocks" },
    gallery:     { name: "Gallery",        icon: "bi-images",      blurb: "Photos of your work or place" },
    images:     { name: "Photos",         icon: "bi-grid-3x3-gap", blurb: "Add your own pictures and arrange them freely" },
    testimonials:{ name: "Testimonials",   icon: "bi-chat-quote",  blurb: "What other people say about you" },
    menu:        { name: "Menu Highlights", icon: "bi-list-ul",    blurb: "Signature dishes and prices" },
    products:    { name: "Products",       icon: "bi-bag",         blurb: "Items you sell" },
    team:        { name: "Team",           icon: "bi-people",      blurb: "The people behind it" },
    contact:     { name: "Contact",        icon: "bi-envelope",    blurb: "How people can reach you" },
    faq:         { name: "FAQ",            icon: "bi-question-circle", blurb: "Answers to common questions" },
    cta:         { name: "Call to Action", icon: "bi-megaphone",   blurb: "One final push before the footer" },
    hours:       { name: "Hours & Location", icon: "bi-clock",     blurb: "Opening hours and address" },
    blog:        { name: "Latest Posts",   icon: "bi-journal-text", blurb: "Your newest articles" },
    newsletter:  { name: "Newsletter",     icon: "bi-send",        blurb: "Collect email addresses" }
  };

  var TYPE_SECTIONS = {
    business:   ["hero", "about", "features", "testimonials", "cta", "contact"],
    portfolio:  ["hero", "about", "images", "testimonials", "contact"],
    restaurant: ["hero", "menu", "about", "hours", "gallery", "contact"],
    store:      ["hero", "products", "features", "testimonials", "cta", "contact"],
    school:     ["hero", "about", "gallery", "faq", "contact"],
    blog:       ["hero", "blog", "about", "newsletter", "contact"]
  };

  /* ---------- ids ---------- */

  function uid(prefix) {
    return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 9);
  }

  /* ---------- auth ---------- */

  function currentUser() {
    try {
      if (!token()) return null;
      var u = JSON.parse(localStorage.getItem(USER_KEY) || "null");
      return u && u.email ? u : null;
    } catch (e) { return null; }
  }

  function requireAuth() {
    var u = currentUser();
    if (!u) {
      location.href = "login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search);
      return null;
    }
    return u;
  }

  /* ---------- project CRUD ---------- */

  function makePlan(typeId, goalId, siteName, description) {
    var recs = TYPE_SECTIONS[typeId] || TYPE_SECTIONS.business;
    return {
      meta: {
        type: typeId,
        goal: goalId,
        theme: "modern",
        siteName: siteName || "My Website",
        /* kept so the design can read it later; the spec is generated from
           this, and until now the words the user typed stopped here */
        description: description || ""
      },
      pages: [
        {
          id: "home",
          name: "Home",
          sections: recs.slice(0, 4).map(function (t) {
            return {
              id: uid("s"),
              type: t,
              title: SECTIONS[t].name,
              subtitle: SECTIONS[t].blurb,
              fields: {},
              ready: 0
            };
          })
        }
      ]
    };
  }

  /* ---------- AI plan drafting (server side, Gemini) ---------- */

  /* The server decides what kind of site this is and writes the copy.
     Guessing the type from keywords here got it badly wrong: a full stack
     web programming course matched no keyword, fell back to "business",
     and then used restaurant interiors as its photography. */
  function generatePlan(description) {
    return request("/api/plan", { method: "POST", body: { description: description } })
      .then(function (res) {
        if (!res.ok) return { ok: false, error: res.error, detail: res.detail };
        return { ok: true, result: res.data };
      });
  }

  /* Starter rows for a list section, exposed here because api.js is the one
     script the wizard page loads - editorui.js is not on it. Without these a
     menu or hours section starts with no rows at all and publishes as a bare
     heading. editorui.js keeps its own copy for the builder. */
  var API_STARTERS = {
    features: [
      { title: "Fast and reliable", text: "What makes this worth choosing." },
      { title: "Made with care", text: "The detail people notice." },
      { title: "Here to help", text: "Support when you need it." }
    ],
    products: [
      { title: "Product one", text: "A short line about it.", price: "24" },
      { title: "Product two", text: "A short line about it.", price: "32" },
      { title: "Product three", text: "A short line about it.", price: "18" }
    ],
    menu: [
      { title: "House special", text: "Chef's pick", price: "12" },
      { title: "Seasonal plate", text: "Changes weekly", price: "15" },
      { title: "House classic", text: "The one everyone orders", price: "11" }
    ],
    gallery: [
      { title: "Photo one", text: "" },
      { title: "Photo two", text: "" },
      { title: "Photo three", text: "" }
    ],
    /* the photo wall starts small and spread out, so the user grows it */
    images: [
      { img: "", size: "w", text: "" },
      { img: "", size: "s", text: "" },
      { img: "", size: "t", text: "" },
      { img: "", size: "s", text: "" },
      { img: "", size: "l", text: "" }
    ],
    team: [
      { title: "First name", text: "Their role" },
      { title: "Second name", text: "Their role" },
      { title: "Third name", text: "Their role" }
    ],
    testimonials: [
      { title: "Great service from the start", text: "First name, Local Guide" },
      { title: "Exactly what we needed", text: "Second name, Local Guide" },
      { title: "We will be back", text: "Third name, Local Guide" }
    ],
    blog: [
      { title: "First post title", text: "A short summary of the post." },
      { title: "Second post title", text: "A short summary of the post." },
      { title: "Third post title", text: "A short summary of the post." }
    ],
    faq: [
      { title: "A common question?", text: "The answer goes here." },
      { title: "Another question?", text: "The answer goes here." },
      { title: "And one more?", text: "The answer goes here." }
    ],
    hours: [
      { title: "Monday to Friday", text: "9:00 - 18:00" },
      { title: "Saturday", text: "10:00 - 16:00" },
      { title: "Sunday", text: "Closed" }
    ]
  };

  function startersFor(typeKey) {
    var list = API_STARTERS[typeKey] || [];
    return JSON.parse(JSON.stringify(list));
  }

  /* turn the server's draft into a Plan the builder can open */
  function planFromDraft(draft) {
    var plan = makePlan(draft.type, draft.goal, draft.siteName || "My Website",
                      draft.description || "");
    var written = draft.sections || [];

    plan.pages[0].sections.forEach(function (section) {
      /* A list section with no items renders as a heading and a subtitle
         and nothing else - 226px of empty page on a published site, which is
         what a screenshot of a live ramen shop showed. makePlan does not
         create items, and the draft carries none, so every menu, hours and
         features section started empty. Seed the starters the same way
         adding one from the rail does, so the user opens onto real content
         and can edit it. */
      if (!Array.isArray(section.items)) {
        section.items = startersFor(section.type);
      }
      var match = null;
      for (var i = 0; i < written.length; i++) {
        if (written[i].type === section.type) { match = written[i]; break; }
      }
      if (!match) return;
      section.title = match.title || section.title;
      section.subtitle = match.subtitle || section.subtitle;
      if (match.buttonText) {
        section.fields = section.fields || {};
        section.fields.buttonText = match.buttonText;
      }
    });

    /* the hero should open with the headline the model wrote */
    var hero = plan.pages[0].sections[0];
    if (hero && draft.headline) {
      hero.title = draft.headline;
      hero.subtitle = draft.tagline || hero.subtitle;
    }
    return plan;
  }

  /* ---------- AI content filling (Gemini later; canned copy now) ---------- */

  var AI_HEROES = {
    restaurant: ["Home-cooked meals, made fresh daily", "Family recipes served with a smile", "See the menu"],
    business:   ["We get the job done right", "Reliable service your neighbors trust", "Get a free quote"],
    portfolio:  ["Ideas, designed & built", "Selected work from my creative journey", "View my work"],
    store:      ["New arrivals just landed", "Quality finds at prices you'll love", "Shop now"],
    school:     ["Explore our project", "Everything you need to know in one place", "Learn more"],
    blog:       ["Stories worth reading", "Fresh articles posted every week", "Start reading"]
  };

  var AI_COPY = {
    about:       ["Who we are", "The short story behind what we do"],
    features:    ["What we offer", "The things people count on us for"],
    gallery:     ["A look around", "Photos of our work and our place"],
    products:    ["Fan favorites", "Bestsellers picked just for you"],
    menu:        ["Menu highlights", "The dishes everyone comes back for"],
    testimonials:["What people say", "Kind words from happy customers"],
    team:        ["The people behind it", "Say hello to the team"],
    contact:     ["Get in touch", "We usually reply within a day"],
    faq:         ["Good to know", "Answers to the questions we hear most"],
    cta:         ["Ready when you are", "Take the next step — we'll take it from here"],
    hours:       ["Hours & location", "Open seven days a week — come visit us"],
    blog:        ["Latest posts", "Fresh off the press"],
    newsletter:  ["Stay in the loop", "Get updates straight to your inbox"]
  };

  function fillSection(section, meta) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        var copy;
        if (section.type === "hero") {
          copy = (AI_HEROES[(meta && meta.type)] || AI_HEROES.business).slice();
        } else {
          copy = (AI_COPY[section.type] || ["Fresh content", "Written just for your site"]).slice();
        }
        section.title = copy[0];
        section.subtitle = copy[1];
        if (section.type === "hero" && copy[2]) {
          section.fields = section.fields || {};
          section.fields.buttonText = copy[2];
        }
        resolve(section);
      }, 700);
    });
  }

  function fillPage(page, meta) {
    var chain = Promise.resolve();
    page.sections.forEach(function (s, i) {
      chain = chain
        .then(function () { return new Promise(function (r) { setTimeout(r, i === 0 ? 0 : 180); }); })
        .then(function () { return fillSection(s, meta); });
    });
    return chain.then(function () { return page; });
  }

  /* ---------- public API ---------- */

  window.API = {
    /* meta */
    TYPES: TYPES,
    SECTIONS: SECTIONS,
    startersFor: startersFor,
    setStarters: function (map) { API_STARTERS = map || {}; },
    goalsFor: function (typeId) { return GOALS[typeId] || []; },
    recommendedFor: function (typeId) { return TYPE_SECTIONS[typeId] || []; },

    /* auth */
    currentUser: currentUser,
    requireAuth: requireAuth,
    login: function (email, password, remember) {
      /* remember is sent to the server because it decides the cookie's
         lifespan. The client cannot inspect an HttpOnly cookie, so it has no
         way to work this out afterwards. */
      return request("/api/auth/login", {
        method: "POST",
        body: { email: email, password: password, remember: !!remember }
      }).then(function (res) {
        if (!res.ok) return { ok: false, error: res.error };
        setSession(res.data.token, res.data.user);
        rememberPreference(!!remember);
        return { ok: true, user: res.data.user };
      });
    },
    register: function (name, email, password) {
      return request("/api/auth/register", {
        method: "POST",
        body: { username: name, email: email, password: password }
      }).then(function (res) {
        if (!res.ok) return { ok: false, error: res.error };
        setSession(res.data.token, res.data.user);
        return { ok: true, user: res.data.user };
      });
    },
    logout: function () {
      clearSession();
    },

    /* remembered email and the "keep me signed in" choice, for the login form */
    rememberedEmail: function () {
      return rememberedEmail();
    },
    /* Only the preference, never the token: whether the box was ticked is not
       a secret, and the real cookie cannot be read from script. */
    rememberMe: function () {
      return preference(PREF_KEY, "0") === "1";
    },

    /* projects */
    listProjects: function () {
      return request("/api/projects").then(function (res) {
        if (!res.ok) return { ok: false, error: res.error, projects: [] };
        return { ok: true, projects: res.data || [] };
      });
    },
    getProject: function (id) {
      return request("/api/projects/" + encodeURIComponent(id)).then(function (res) {
        if (!res.ok) return { ok: false, error: res.error, project: null };
        return { ok: true, project: res.data };
      });
    },
    createProject: function (name, typeId, goalId) {
      return request("/api/projects", {
        method: "POST",
        body: {
          name: name,
          type: typeId,
          goal: goalId,
          plan_json: makePlan(typeId, goalId, name)
        }
      }).then(function (res) {
        if (!res.ok) return { ok: false, error: res.error, project: null };
        return { ok: true, project: res.data };
      });
    },
    savePlan: function (projectId, plan) {
      return request("/api/projects/" + encodeURIComponent(projectId), {
        method: "PUT",
        body: {
          plan_json: plan,
          name: (plan.meta && plan.meta.siteName) || undefined,
          theme: plan.meta && plan.meta.theme
        }
      }).then(function (res) {
        if (!res.ok) return { ok: false, error: res.error, project: null };
        return { ok: true, project: res.data };
      });
    },
    deleteProject: function (projectId) {
      return request("/api/projects/" + encodeURIComponent(projectId), { method: "DELETE" });
    },

    /* publish */
    setPublished: function (projectId, published, slug, pages, home) {
      var path = "/api/projects/" + encodeURIComponent(projectId) + (published ? "/publish" : "/unpublish");
      var body = published
        ? { slug: slug, pages: pages || null, home: home || null }
        : {};
      return request(path, { method: "POST", body: body })
        .then(function (res) {
          if (!res.ok) return { ok: false, error: res.error, project: null };
          return { ok: true, project: res.data };
        });
    },

    /* The ZIP binary cannot ride through request(), which parses JSON. It
       still asks for a token and replays once on an expired one, exactly
       like send(), because the download is a signed-in owner action. */
    exportZip: function (projectId) {
      function attempt(retry) {
        var headers = {};
        if (token()) headers.Authorization = "Bearer " + token();
        return fetch("/api/projects/" + encodeURIComponent(projectId) + "/export.zip", {
          headers: headers
        }).then(function (res) {
          if (res.ok) return res.blob().then(function (blob) {
            return { ok: true, blob: blob };
          });
          return res.text().then(function (text) {
            var data = null;
            try { data = JSON.parse(text); } catch (e) { /* html errors */ }
            if (res.status === 401 && retry === 0) {
              return renew().then(function (ok) {
                return ok ? attempt(1) : { ok: false, error: "Please sign in again." };
              });
            }
            return { ok: false, error: (data && data.error) || "Could not build the ZIP." };
          });
        });
      }
      return attempt(0);
    },
    baseUrl: function () {
      return location.origin;
    },

    /* AI */
    generateDesign: function (ctx) {
      return request("/api/design", { method: "POST", body: ctx }).then(function (res) {
        if (!res.ok) return { ok: false, error: res.error };
        return { ok: true, spec: res.data };
      });
    },
    generatePlan: generatePlan,
    planFromDraft: planFromDraft,
    fillSection: fillSection,
    fillPage: fillPage
  };
})();
