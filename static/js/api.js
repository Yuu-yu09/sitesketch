/* ============================================================
   SiteSketch — client data layer (PROTOTYPE / MOCK)
   ------------------------------------------------------------
   Every function here mirrors a future Flask endpoint (see
   PLAN.md §Routes). When the backend lands, the insides of
   this file get replaced with fetch() calls — nothing else
   in the app changes.
   ============================================================ */
(function () {
  "use strict";

  var DB_KEY = "sitesketch_db_v2";
  var SESSION_KEY = "sitesketch_session_v1";

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

  /* ---------- storage helpers ---------- */

  function load() {
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) { var stored = JSON.parse(raw); scrubLegacy(stored); return stored; }
    } catch (e) { /* corrupt -> reseed */ }
    var db = seed();
    save(db);
    return db;
  }

  /* one-time scrub of legacy demo identifiers in an already-stored db */
  function scrubLegacy(db) {
    var changed = false;
    (db.users || []).forEach(function (u) {
      if (u.id === "usr_demo" && (u.email === "alex@sitesketch.demo" || u.name === "Alex")) {
        u.name = "Demo";
        u.email = "demo@sitesketch.app";
        changed = true;
      }
    });
    (db.projects || []).forEach(function (p) {
      if (p.name === "Sample Portfolio" || p.slug === "sample-portfolio") {
        p.name = "My Portfolio";
        p.slug = "my-portfolio";
        changed = true;
      }
      if (p.plan_json && p.plan_json.meta && p.plan_json.meta.siteName === "Sample Portfolio") {
        p.plan_json.meta.siteName = "My Portfolio";
        changed = true;
      }
    });
    if (changed) save(db);
  }

  function save(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function uid(prefix) {
    return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 9);
  }

  /* ---------- seed: demo account + 2 demo projects ---------- */

  function seed() {
    var demoProject = {
      id: "proj_demo_lolas",
      name: "Lola's Kitchen",
      type: "restaurant",
      goal: "show-menu",
      theme: "modern",
      slug: "lolas-kitchen",
      is_published: false,
      view_count: 0,
      created_at: Date.now() - 86400000 * 3,
      updated_at: Date.now() - 86400000,
      plan_json: {
        meta: { type: "restaurant", goal: "show-menu", theme: "modern", siteName: "Lola's Kitchen" },
        pages: [
          { id: "home", name: "Home", sections: [
            { id: uid("s"), type: "hero", title: "Home-cooked Filipino comfort food", subtitle: "Family recipes since 1987", fields: { buttonText: "See the menu" }, ready: 2 },
            { id: uid("s"), type: "menu", title: "Menu highlights", subtitle: "Customer favorites", fields: {}, ready: 0 },
            { id: uid("s"), type: "hours", title: "Hours & location", subtitle: "Open Tuesday to Sunday", fields: {}, ready: 1 }
          ]},
          { id: "about", name: "About", sections: [
            { id: uid("s"), type: "about", title: "Our story", subtitle: "Three generations of home cooking", fields: {}, ready: 1 },
            { id: uid("s"), type: "contact", title: "Get in touch", subtitle: "Reserve a table", fields: {}, ready: 0 }
          ]}
        ]
      }
    };

    var portfolioProject = {
      id: "proj_demo_portfolio",
      name: "My Portfolio",
      type: "portfolio",
      goal: "get-hired",
      theme: "modern",
      slug: "my-portfolio",
      is_published: true,
      view_count: 12, /* demo figure — synthetic prototype data */
      created_at: Date.now() - 86400000 * 10,
      updated_at: Date.now() - 3600000 * 5,
      plan_json: {
        meta: { type: "portfolio", goal: "get-hired", theme: "modern", siteName: "My Portfolio" },
        pages: [
          { id: "home", name: "Home", sections: [
            { id: uid("s"), type: "hero", title: "Design student & web enthusiast", subtitle: "Open to internships & collabs", fields: { buttonText: "View my work" }, ready: 3 },
            { id: uid("s"), type: "gallery", title: "Selected work", subtitle: "School and personal projects", fields: {}, ready: 2 },
            { id: uid("s"), type: "contact", title: "Get in touch", subtitle: "Open to internships", fields: {}, ready: 1 }
          ]}
        ]
      }
    };

    return {
      users: [
        /* demo login shown on the login screen */
        { id: "usr_demo", name: "Demo", email: "demo@sitesketch.app", password: "demo1234" }
      ],
      projects: [demoProject, portfolioProject]
    };
  }

  /* ---------- auth (Flask session later) ---------- */

  function currentUser() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY));
      /* legacy demo session scrub (topbar identity) */
      if (s && s.id === "usr_demo" && (s.email === "alex@sitesketch.demo" || s.name === "Alex")) {
        s.name = "Demo";
        s.email = "demo@sitesketch.app";
        localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      }
      return s && s.name ? s : null;
    } catch (e) { return null; }
  }

  function requireAuth() {
    var u = currentUser();
    /* ?demo=1 — one-click demo sign-in (for demos/screenshots; no server yet) */
    if (!u && /[?&]demo=1/.test(location.search)) {
      var db = load();
      var d = db.users.filter(function (x) { return x.email === "demo@sitesketch.app"; })[0];
      if (d) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ id: d.id, name: d.name, email: d.email }));
        u = JSON.parse(localStorage.getItem(SESSION_KEY));
      }
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
      var db = load();
      var u = db.users.filter(function (x) { return x.email.toLowerCase() === String(email).toLowerCase(); })[0];
      if (!u || u.password !== password) return { ok: false, error: "That email and password don't match an account." };
      localStorage.setItem(SESSION_KEY, JSON.stringify({ id: u.id, name: u.name, email: u.email }));
      return { ok: true, user: u };
    },
    register: function (name, email, password) {
      var db = load();
      if (db.users.some(function (x) { return x.email.toLowerCase() === String(email).toLowerCase(); }))
        return { ok: false, error: "An account with that email already exists." };
      var u = { id: uid("usr"), name: name, email: email, password: password };
      db.users.push(u);
      save(db);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ id: u.id, name: u.name, email: u.email }));
      return { ok: true, user: u };
    },
    logout: function () { localStorage.removeItem(SESSION_KEY); },

    /* projects */
    listProjects: function () {
      return load().projects.slice().sort(function (a, b) { return b.updated_at - a.updated_at; });
    },
    getProject: function (id) {
      return load().projects.filter(function (p) { return p.id === id; })[0] || null;
    },
    createProject: function (name, typeId, goalId) {
      var db = load();
      var p = {
        id: uid("proj"),
        name: name,
        type: typeId,
        goal: goalId,
        theme: "modern",
        slug: null,
        is_published: false,
        view_count: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
        plan_json: makePlan(typeId, goalId, name)
      };
      db.projects.push(p);
      save(db);
      return p;
    },
    savePlan: function (projectId, plan) {
      var db = load();
      var p = db.projects.filter(function (x) { return x.id === projectId; })[0];
      if (!p) return null;
      p.plan_json = plan;
      p.type = plan.meta.type;
      p.goal = plan.meta.goal;
      p.theme = plan.meta.theme;
      p.name = plan.meta.siteName || p.name;
      p.updated_at = Date.now();
      save(db);
      return p;
    },
    deleteProject: function (projectId) {
      var db = load();
      db.projects = db.projects.filter(function (p) { return p.id !== projectId; });
      save(db);
    },

    /* publish (server compiles later — this is the same UX contract) */
    setPublished: function (projectId, published, slug) {
      var db = load();
      var p = db.projects.filter(function (x) { return x.id === projectId; })[0];
      if (!p) return null;
      p.is_published = !!published;
      if (slug !== undefined) p.slug = slug;
      p.updated_at = Date.now();
      save(db);
      return p;
    },
    baseUrl: function () {
      return "https://sitesketch.vercel.app";
    },

    /* AI */
    generatePlan: generatePlan,
    fillSection: fillSection,
    fillPage: fillPage
  };
})();
