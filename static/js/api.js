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

  /* ---------------- transport ---------------- */

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function request(path, options) {
    options = options || {};
    var headers = options.headers || {};
    if (token()) headers.Authorization = "Bearer " + token();
    if (options.body) headers["Content-Type"] = "application/json";

    return fetch(path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (res.status === 401) {
          clearSession();
          return { ok: false, status: 401, error: (data && data.error) || "Please sign in again." };
        }
        if (!res.ok) {
          return { ok: false, status: res.status, error: (data && data.error) || "Something went wrong." };
        }
        return { ok: true, status: res.status, data: data };
      });
    }).catch(function (err) {
      return { ok: false, status: 0, error: "Cannot reach the server. Check your connection." };
    });
  }

  function setSession(tokenValue, user) {
    try {
      localStorage.setItem(TOKEN_KEY, tokenValue);
      /* the screens render user.name; normalise whatever the API sends */
      localStorage.setItem(USER_KEY, JSON.stringify(Object.assign({}, user, {
        name: user.name || user.username || user.email
      })));
    } catch (e) { /* private mode */ }
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
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
    portfolio:  ["hero", "about", "gallery", "testimonials", "contact"],
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
    /* ?demo=1 - one-click demo sign-in (creates the demo account server side) */
    if (!u && /[?&]demo=1/.test(location.search)) {
      request("/api/auth/demo", { method: "POST" }).then(function (res) {
        if (res.ok && res.data) {
          setSession(res.data.token, res.data.user);
          location.reload();
        } else {
          location.href = "login.html";
        }
      });
      return null;
    }
    if (!u) {
      location.href = "login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search);
      return null;
    }
    return u;
  }

  /* ---------- project CRUD ---------- */

  function makePlan(typeId, goalId, siteName) {
    var recs = TYPE_SECTIONS[typeId] || TYPE_SECTIONS.business;
    return {
      meta: { type: typeId, goal: goalId, theme: "modern", siteName: siteName || "My Website" },
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

  /* ---------- AI (Gemini later; canned draft now) ---------- */

  function generatePlan(description) {
    return new Promise(function (resolve) {
      var text = (description || "").toLowerCase();
      var typeId = "business";
      if (/(food|restaurant|menu|dish|cafe|kitchen|eat|cook)/.test(text)) typeId = "restaurant";
      else if (/(shop|store|sell|product|price|buy|ecommerce|boutique)/.test(text)) typeId = "store";
      else if (/(portfolio|photo|designer|art|creative|showcase|work)/.test(text)) typeId = "portfolio";
      else if (/(school|class|club|event|project|student|teacher)/.test(text)) typeId = "school";
      else if (/(blog|article|post|write|news)/.test(text)) typeId = "blog";

      var goal = GOALS[typeId][0].id;

      /* name: quoted phrase if present, else the meaningful words before " for ..." */
      var quoted = description.match(/["“']([^"”']{2,40})["”']/);
      var siteName;
      if (quoted) siteName = quoted[1];
      else {
        var STOP = { website: 1, site: 1, page: 1, landing: 1, online: 1, and: 1, with: 1, my: 1, our: 1, the: 1, for: 1, that: 1, this: 1, an: 1, a: 1, want: 1, need: 1, create: 1, make: 1, build: 1 };
        var base = description.split(/\s+for\s+/i)[0]
          .replace(/^(i want |i need |a |an |the |create |make |build )/i, "");
        var words = base.split(/\s+/).filter(function (w) {
          return w.length > 2 && !STOP[w.toLowerCase()];
        }).slice(0, 3);
        siteName = words.map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ") || "My Website";
      }

      var plan = makePlan(typeId, goal, siteName);
      /* AI-drafted plans arrive with some content already written */
      plan.pages[0].sections.forEach(function (s, i) {
        if (i === 0) {
          s.title = siteName;
          s.subtitle = description.slice(0, 90);
        }
      });

      /* simulate network + model latency */
      setTimeout(function () {
        resolve({ type: typeId, goal: goal, plan: plan });
      }, 1100);
    });
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
    goalsFor: function (typeId) { return GOALS[typeId] || []; },
    recommendedFor: function (typeId) { return TYPE_SECTIONS[typeId] || []; },

    /* auth */
    currentUser: currentUser,
    requireAuth: requireAuth,
    login: function (email, password) {
      return request("/api/auth/login", {
        method: "POST",
        body: { email: email, password: password }
      }).then(function (res) {
        if (!res.ok) return { ok: false, error: res.error };
        setSession(res.data.token, res.data.user);
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
    setPublished: function (projectId, published, slug) {
      var path = "/api/projects/" + encodeURIComponent(projectId) + (published ? "/publish" : "/unpublish");
      return request(path, { method: "POST", body: published ? { slug: slug } : {} })
        .then(function (res) {
          if (!res.ok) return { ok: false, error: res.error, project: null };
          return { ok: true, project: res.data };
        });
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
    fillSection: fillSection,
    fillPage: fillPage
  };
})();
