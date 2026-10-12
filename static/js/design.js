/* ============================================================
   design.js - SiteSketch design engine
   Curated taste libraries + design-spec generator (v1 schema).

   Curation rules (design-taste-frontend skill):
   - palette families rotated (no AI-purple default, no beige+brass
     premium default, saturation kept in check, one accent per design)
   - sans-display default; serif only in editorial/restaurant
     archetypes, never Fraunces/Instrument Serif
   - contrast-checked text/accent pairs (WCAG AA)
   - images: stable CDN stock photos with graceful fallback
   ============================================================ */
(function () {
  "use strict";

  var D = {};

  /* ---------- palettes: {bg, surface, text, muted, accent, accentInk, line, soft} ---------- */
  D.PALETTES = [
    /* light */
    { id: "cobalt-cream",  name: "Cobalt & Chalk",   mode: "light", v: ["business", "portfolio", "school", "blog", "store"],
      c: { bg: "#F6F6F4", surface: "#FFFFFF", text: "#16181D", muted: "#5A5F6B", accent: "#1D4ED8", accentInk: "#FFFFFF", line: "#E2E3E0", soft: "#ECF0FE" } },
    { id: "terracotta",    name: "Terracotta Slate", mode: "light", v: ["restaurant", "store", "business"],
      c: { bg: "#F4F5F6", surface: "#FFFFFF", text: "#1C1E22", muted: "#5F6670", accent: "#B04A26", accentInk: "#FFFFFF", line: "#E0E2E5", soft: "#F7EAE4" } },
    { id: "mono-rose",     name: "Monochrome & Rose", mode: "light", v: ["portfolio", "store", "blog"],
      c: { bg: "#FFFFFF", surface: "#F5F5F5", text: "#111113", muted: "#5E5E66", accent: "#E11D5B", accentInk: "#FFFFFF", line: "#E5E5E7", soft: "#FDE8EE" } },
    { id: "olive-brick",   name: "Olive & Brick",    mode: "light", v: ["business", "school", "blog"],
      c: { bg: "#F3F4EE", surface: "#FFFFFF", text: "#1E2018", muted: "#5D6154", accent: "#A6412B", accentInk: "#FFFFFF", line: "#E1E3DA", soft: "#EEF0E4" } },
    { id: "newsprint",     name: "Newsprint & Crimson", mode: "light", v: ["blog", "portfolio", "school"],
      c: { bg: "#FCFCFA", surface: "#FFFFFF", text: "#1A1A18", muted: "#61615C", accent: "#B3312F", accentInk: "#FFFFFF", line: "#E5E4DF", soft: "#F6EFEE" } },
    { id: "pine-bone",     name: "Pine & Bone",      mode: "light", v: ["business", "restaurant", "school"],
      c: { bg: "#F1F1EA", surface: "#FAFAF5", text: "#1B211B", muted: "#57604F", accent: "#1F5B3F", accentInk: "#FFFFFF", line: "#DCDDD1", soft: "#E4ECE3" } },
    { id: "sky-clay",      name: "Sky & Clay",       mode: "light", v: ["portfolio", "business", "store"],
      c: { bg: "#F5F7FA", surface: "#FFFFFF", text: "#17202A", muted: "#586371", accent: "#B4593A", accentInk: "#FFFFFF", line: "#DEE3EA", soft: "#F3E7E1" } },
    /* dark */
    { id: "forest-amber",  name: "Forest & Amber",   mode: "dark", v: ["restaurant", "business", "store"],
      c: { bg: "#101713", surface: "#17201B", text: "#EDEFE9", muted: "#9AA69C", accent: "#F2A93B", accentInk: "#14100A", line: "#26322B", soft: "#1C2A21" } },
    { id: "black-tan",     name: "Black & Tan",      mode: "dark", v: ["portfolio", "restaurant", "store"],
      c: { bg: "#121110", surface: "#1B1A18", text: "#F1EEE8", muted: "#A29C93", accent: "#D3A96B", accentInk: "#14120E", line: "#2A2825", soft: "#221F1B" } },
    { id: "deep-sea",      name: "Deep Sea",         mode: "dark", v: ["business", "portfolio", "school", "blog"],
      c: { bg: "#0B1116", surface: "#121A21", text: "#E7EEF3", muted: "#8FA3B0", accent: "#2DD4BF", accentInk: "#06231F", line: "#1E2A33", soft: "#132229" } },
    { id: "citrus-dark",   name: "Citrus Charcoal",  mode: "dark", v: ["store", "blog", "portfolio"],
      c: { bg: "#17160F", surface: "#1F1E15", text: "#F4F2E7", muted: "#A5A294", accent: "#E8E14B", accentInk: "#171500", line: "#2C2B1F", soft: "#26251A" } },
    { id: "indigo-dawn",   name: "Indigo Dawn",      mode: "dark", v: ["business", "school", "blog", "portfolio"],
      c: { bg: "#0E1015", surface: "#151821", text: "#E9ECF4", muted: "#97A0B5", accent: "#7C9AFF", accentInk: "#0B1024", line: "#222738", soft: "#1A1F2E" } }
  ];
  D.paletteById = function (id) {
    for (var i = 0; i < D.PALETTES.length; i++) if (D.PALETTES[i].id === id) return D.PALETTES[i];
    return D.PALETTES[0];
  };

  /* ---------- font pairings (Google Fonts). serif only for editorial/restaurant ---------- */
  D.FONTS = [
    { id: "grotesk",     name: "Space Grotesk / Public Sans", vibe: ["modern", "tech"],
      display: { f: "Space Grotesk", w: "500;700" }, body: { f: "Public Sans", w: "400;600" } },
    { id: "jakarta",     name: "Plus Jakarta Sans", vibe: ["modern", "friendly"],
      display: { f: "Plus Jakarta Sans", w: "700;800" }, body: { f: "Plus Jakarta Sans", w: "400;600" } },
    { id: "syne",        name: "Syne / Work Sans", vibe: ["artsy", "creative"],
      display: { f: "Syne", w: "700;800" }, body: { f: "Work Sans", w: "400;500" } },
    { id: "dmsans",      name: "DM Sans", vibe: ["clean", "friendly"],
      display: { f: "DM Sans", w: "700" }, body: { f: "DM Sans", w: "400;500" } },
    { id: "archivo",     name: "Archivo / Lora", vibe: ["editorial", "business"],
      display: { f: "Archivo", w: "600;700" }, body: { f: "Lora", w: "400;500" } },
    { id: "newsreader",  name: "Newsreader / Source Sans", vibe: ["editorial", "blog"],
      display: { f: "Newsreader", w: "600;700" }, body: { f: "Source Sans 3", w: "400;600" } },
    { id: "sora",        name: "Sora / Source Sans", vibe: ["tech", "modern"],
      display: { f: "Sora", w: "600;700" }, body: { f: "Source Sans 3", w: "400;600" } },
    { id: "outfit",      name: "Outfit / Work Sans", vibe: ["friendly", "clean"],
      display: { f: "Outfit", w: "600;700" }, body: { f: "Work Sans", w: "400;500" } },
    { id: "playfair",    name: "Playfair Display / Source Sans", vibe: ["classic", "editorial"],
      display: { f: "Playfair Display", w: "600;700" }, body: { f: "Source Sans 3", w: "400;600" } },
    { id: "archivoblack",name: "Archivo Black / IBM Plex", vibe: ["bold", "artsy"],
      display: { f: "Archivo Black", w: "400" }, body: { f: "IBM Plex Sans", w: "400;500" } }
  ];
  D.fontById = function (id) {
    for (var i = 0; i < D.FONTS.length; i++) if (D.FONTS[i].id === id) return D.FONTS[i];
    return D.FONTS[0];
  };

  /* type -> preferred vibes (generator filters, then randomizes within) */
  D.TYPE_VIBES = {
    business: ["modern", "tech", "clean", "business"],
    portfolio: ["artsy", "creative", "modern", "bold"],
    restaurant: ["classic", "editorial", "friendly"],
    store: ["modern", "clean", "bold", "friendly"],
    school: ["friendly", "clean", "modern"],
    blog: ["editorial", "classic", "modern"]
  };

  /* ---------- images: stable CDN stock per slot; renderer falls back on error ---------- */
  D.IMAGES = {
    food: [
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=70",
      "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1200&q=70",
      "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=1200&q=70",
      "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=1200&q=70",
      "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=1200&q=70"
    ],
    bakery: [
      "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200&q=70",
      "https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=1200&q=70",
      "https://images.unsplash.com/photo-1517433670267-08bbd4be890f?w=1200&q=70"
    ],
    cafe: [
      "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=70",
      "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1200&q=70",
      "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=1200&q=70"
    ],
    work: [
      "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=1200&q=70",
      "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1200&q=70",
      "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=1200&q=70",
      "https://images.unsplash.com/photo-1559028012-481c04fa702d?w=1200&q=70"
    ],
    studio: [
      "https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1200&q=70",
      "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=70",
      "https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1200&q=70"
    ],
    people: [
      "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&q=70",
      "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1200&q=70",
      "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=1200&q=70"
    ],
    store: [
      "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&q=70",
      "https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=1200&q=70",
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&q=70"
    ],
    product: [
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1200&q=70",
      "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=1200&q=70",
      "https://images.unsplash.com/photo-1560343090-f0409e92791a?w=1200&q=70",
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1200&q=70"
    ],
    place: [
      "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1200&q=70",
      "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=1200&q=70",
      "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=1200&q=70"
    ],
    school: [
      "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1200&q=70",
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=1200&q=70",
      "https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=1200&q=70"
    ],
    nature: [
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=70",
      "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&q=70",
      "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1200&q=70"
    ]
  };
  /* image pool per site type (generator picks from these) */
  D.TYPE_IMAGES = {
    restaurant: ["food", "place", "people"],
    store: ["product", "store", "work"],
    business: ["studio", "people", "place"],
    portfolio: ["work", "studio", "people"],
    school: ["school", "people", "nature"],
    blog: ["nature", "studio", "people"]
  };
  /* restaurant description keywords -> tighter pool */
  D.KEYWORD_POOLS = [
    { k: ["bakery", "bread", "pastry", "cake", "merienda"], pool: ["bakery", "cafe"] },
    { k: ["coffee", "cafe", "kape", "espresso"], pool: ["cafe"] },
    { k: ["filipino", "carinderia", "lutong", "turo-turo", "home-cooked"], pool: ["food"] }
  ];

  /* ---------- section layout variants ----------
     name = variant key (class suffix g-<type>-<name>)
     family = layout family (diversity engine avoids repeats)       */
  D.VARIANTS = {
    hero:         [{ n: "split", f: "media-split" }, { n: "overlay", f: "media-overlay" }, { n: "type", f: "type-first" }],
    about:        [{ n: "split", f: "media-split" }, { n: "quote", f: "editorial" }],
    features:     [{ n: "grid", f: "card-grid" }, { n: "rows", f: "list-rows" }],
    products:     [{ n: "cards", f: "card-grid" }, { n: "shelf", f: "shelf" }],
    menu:         [{ n: "list", f: "menu-list" }, { n: "cards", f: "card-grid" }],
    gallery:      [{ n: "masonry", f: "image-grid" }, { n: "spotlight", f: "image-grid" }],
    images:       [{ n: "wall", f: "image-grid" }],
    team:         [{ n: "cards", f: "card-grid" }, { n: "rows", f: "list-rows" }],
    blog:         [{ n: "featured", f: "editorial" }, { n: "grid", f: "card-grid" }],
    testimonials: [{ n: "big", f: "quote" }, { n: "cards", f: "card-grid" }],
    contact:      [{ n: "split", f: "media-split" }, { n: "center", f: "centered" }],
    hours:        [{ n: "table", f: "list-rows" }, { n: "split", f: "media-split" }],
    faq:          [{ n: "accordion", f: "list-rows" }, { n: "columns", f: "editorial" }],
    cta:          [{ n: "band", f: "band" }, { n: "box", f: "framed" }],
    newsletter:   [{ n: "row", f: "band" }, { n: "stack", f: "centered" }]
  };

  /* ---------- deterministic RNG (stable per seed) ---------- */
  D.hash = function (str) {
    var h = 2166136261;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  D.mulberry = function (a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  /* ---------- spec generation ---------- */
  var RADII = ["0px", "4px", "10px", "999px"];
  var SPACES = { compact: 0.8, comfy: 1, airy: 1.35 };

  D.resolvePalette = function (spec) {
    var t = spec.tokens || {};
    if (t.colors) return t.colors;                    /* inline (future Gemini output) */
    return D.paletteById(t.palette).c;
  };

  D.resolveFont = function (spec) {
    var t = spec.tokens || {};
    if (t.fonts) return t.fonts;                      /* inline */
    return D.fontById(t.font);
  };

  /* variant for a section: explicit override > deterministic from seed */
  D.variantFor = function (spec, section) {
    var over = spec.sections && spec.sections[section.id];
    if (over && over.variant) return over.variant;
    var opts = D.VARIANTS[section.type] || D.VARIANTS.about;
    var i = D.hash(spec.seed + ":" + section.id) % opts.length;
    return opts[i].n;
  };
  D.familyFor = function (type, variantName) {
    var opts = D.VARIANTS[type] || [];
    for (var i = 0; i < opts.length; i++) if (opts[i].n === variantName) return opts[i].f;
    return "editorial";
  };
  D.imageFor = function (spec, section, ctx) {
    var over = spec.sections && spec.sections[section.id];
    if (over && over.img) return over.img;
    var pools = (ctx && ctx.imgPools) || D.TYPE_IMAGES.business;
    var poolKey = pools[D.hash(spec.seed + ":img:" + section.id) % pools.length];
    var list = D.IMAGES[poolKey] || D.IMAGES.studio;
    return list[D.hash(section.id + ":" + spec.seed) % list.length];
  };
  D.cycleVariant = function (spec, section) {
    var opts = D.VARIANTS[section.type] || D.VARIANTS.about;
    var cur = D.variantFor(spec, section);
    var idx = 0;
    for (var i = 0; i < opts.length; i++) if (opts[i].n === cur) idx = i;
    var next = opts[(idx + 1) % opts.length].n;
    spec.sections = spec.sections || {};
    spec.sections[section.id] = spec.sections[section.id] || {};
    spec.sections[section.id].variant = next;
    return next;
  };

  /* generate a full design spec.
      ctx: { type, goal, description, excludeSeed } */
  D.generateSpec = function (ctx, seed) {
    ctx = ctx || {};
    var rng = D.mulberry(seed >>> 0);
    var type = ctx.type || "business";
    var vibes = D.TYPE_VIBES[type] || D.TYPE_VIBES.business;

    /* palette: filter by type affinity, fall back to all */
    var pool = D.PALETTES.filter(function (p) { return p.v.indexOf(type) !== -1; });
    if (ctx.excludeSeed != null) pool = pool.filter(function (p) { return p.id !== ctx.excludeSeed; });
    if (!pool.length) pool = D.PALETTES.slice();
    var palette = pick(rng, pool);

    /* fonts: vibe match first, never repeat same id if excluded */
    var fpool = D.FONTS.filter(function (f) {
      for (var i = 0; i < f.vibe.length; i++) if (vibes.indexOf(f.vibe[i]) !== -1) return true;
      return false;
    });
    if (ctx.excludeFont != null) fpool = fpool.filter(function (f) { return f.id !== ctx.excludeFont; });
    if (!fpool.length) fpool = D.FONTS.slice();
    var fonts = pick(rng, fpool);

    var spec = {
      v: 1,
      seed: seed >>> 0,
      name: palette.name + " / " + fonts.name.split(" / ")[0],
      mode: palette.mode,
      tokens: {
        palette: palette.id,
        font: fonts.id,
        radius: RADII[Math.floor(rng() * RADII.length)],
        space: pick(rng, ["compact", "comfy", "airy"]),
        shadow: pick(rng, ["flat", "soft", "crisp"])
      },
      motion: { reveal: 1 + Math.floor(rng() * 3) },   /* 1 subtle .. 3 lively */
      nav: pick(rng, ["bar", "minimal", "outline"]),
      footer: Math.floor(rng() * 2),
      sections: {}
    };
    /* theme lock: palette's own mode; also honor ARCHETYPE affinity:
       classic/restaurant often light editorial - kept as-is, no mid-page flips */
    spec.spaceUnit = SPACES[spec.tokens.space] || 1;
    return spec;
  };

  /* Google Fonts URL for a spec (deduped by caller) */
  D.fontLink = function (spec) {
    var f = D.resolveFont(spec);
    var fams = [];
    if (f.display) fams.push("family=" + encodeURIComponent(f.display.f).replace(/%20/g, "+") + ":wght@" + f.display.w);
    if (f.body && f.body.f !== f.display.f) fams.push("family=" + encodeURIComponent(f.body.f).replace(/%20/g, "+") + ":wght@" + f.body.w);
    return "https://fonts.googleapis.com/css2?" + fams.join("&") + "&display=swap";
  };

  /* CSS custom-property block for a spec (string) */
  D.cssVars = function (spec) {
    var c = D.resolvePalette(spec);
    var f = D.resolveFont(spec);
    var u = spec.spaceUnit || SPACES[(spec.tokens || {}).space] || 1;
    return [
      "--bg:" + c.bg,
      "--surface:" + c.surface,
      "--text:" + c.text,
      "--muted:" + c.muted,
      "--accent:" + c.accent,
      "--accent-ink:" + c.accentInk,
      "--line:" + c.line,
      "--soft:" + c.soft,
      "--radius:" + (spec.tokens.radius || "8px"),
      "--font-display: '" + f.display.f + "', system-ui, sans-serif",
      "--font-body: '" + f.body.f + "', system-ui, sans-serif",
      "--pad:" + (64 * u) + "px",
      "--gap:" + (28 * u) + "px",
      "--shadow:" + (spec.tokens.shadow === "flat" ? "none"
        : spec.tokens.shadow === "crisp" ? "4px 4px 0 rgba(0,0,0,.9)".replace("rgba(0,0,0,.9)", "color-mix(in srgb, var(--text) 90%, transparent)")
        : "0 12px 32px rgba(0,0,0,.10)")
    ].join(";");
  };

  D.SPACES = SPACES;
  D.RADII = RADII;
  window.DESIGN = D;
})();
