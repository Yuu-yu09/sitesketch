/* ============================================================
   site.js - compiles a Plan + design spec into a real website.

   One renderer serves three places: the builder canvas, the live
   preview and the published page, so what you edit is exactly
   what ships.

   Text nodes carry data-edit="<path>" and images carry
   data-img-slot="<slot>", which is what makes the page editable
   in place (the WordPress model) rather than through a form.
   ============================================================ */
(function () {
  "use strict";

  var SS = window.SS || (window.SS = {});

  function esc(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  SS.esc = esc;

  /* ---------- small shared UI helpers ---------- */

  SS.fmtDate = function (ts) {
    if (!ts) return "";
    var d = new Date(ts), now = new Date();
    var days = Math.floor((now - d) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return days + " days ago";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  SS.toast = function (message, icon) {
    var host = document.getElementById("toastHost") || (function () {
      var h = document.createElement("div");
      h.id = "toastHost";
      h.className = "toast-host";
      document.body.appendChild(h);
      return h;
    })();
    var t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = '<i class="bi ' + (icon || "bi-check2") + '" aria-hidden="true"></i><span>' + esc(message) + "</span>";
    host.appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 2400);
    setTimeout(function () { t.remove(); }, 2900);
  };

  /* section outline, used by the builder's page/structure panels */
  SS.blueprintTree = function (plan) {
    return (plan.pages || []).map(function (page) {
      var sections = (page.sections || []).map(function (s) {
        return "<li>" + esc(s.title || s.type) + "</li>";
      }).join("");
      return '<div class="bp-page">' + esc(page.name) + '</div><ul class="bp-sections">' + sections + "</ul>";
    }).join("");
  };

  /* ---------- fonts ---------- */
  var loadedFonts = {};
  function ensureFonts(spec) {
    if (!window.DESIGN) return;
    var href = DESIGN.fontLink(spec);
    if (loadedFonts[href]) return;
    loadedFonts[href] = true;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  /* ---------- helpers ---------- */

  /* the design spec for a plan: use the saved one, or make a stable default */
  SS.specFor = function (plan, seedKey) {
    if (plan && plan.design) return plan.design;
    var seed = window.DESIGN ? DESIGN.hash((seedKey || "site") + (plan && plan.meta ? plan.meta.siteName : "")) : 1;
    var spec = window.DESIGN
      ? DESIGN.generateSpec({
          type: plan && plan.meta ? plan.meta.type : "business",
          /* the description the user typed, so "pixelated retro" reaches
             the design and not just the copy */
          description: plan && plan.meta ? plan.meta.description : ""
        }, seed)
      : { tokens: {}, sections: {} };
    if (plan) plan.design = spec;
    return spec;
  };

  function variantOf(plan, section, spec) {
    var chosen = spec.sections && spec.sections[section.id] && spec.sections[section.id].variant;
    if (chosen) return chosen;
    if (window.DESIGN) return DESIGN.variantFor(spec, section);
    return "grid";
  }

  /* images live in two places, and the plan always wins:
     a user's own choice (section.img / items[i].img) beats the
     AI/default pick stored in the design spec. */
  function imgOf(plan, section, spec, slot) {
    if (section[slot || "img"]) return section[slot || "img"];
    var chosen = spec.sections && spec.sections[section.id] && spec.sections[section.id][slot || "img"];
    if (chosen) return chosen;
    return window.DESIGN
      ? DESIGN.imageFor(spec, section, { imgPools: DESIGN.TYPE_IMAGES[plan.meta.type] || DESIGN.TYPE_IMAGES.business })
      : "";
  }

  function items(section) {
    return section.items && section.items.length ? section.items : [];
  }

  /* data-edit tells the editor which part of the plan this text belongs to */
  function ed(path) { return ' data-edit="' + path + '"'; }

  function text(value, path, tag, cls) {
    return "<" + (tag || "p") + (cls ? ' class="' + cls + '"' : "") + ed(path) + ">" + esc(value) + "</" + (tag || "p") + ">";
  }

  /* Images are cropped non-destructively, the way WordPress does it:
     the uploaded file is never modified, we store the crop rectangle
     (fractions of the image, 0-1) on the block and apply it with
     object-fit/position. That keeps crops instant, reversible, and
     working on library photos we do not own. */
  function cropOf(plan, pageId, sectionId, slot) {
    var page = (plan.pages || []).filter(function (p) { return p.id === pageId; })[0];
    if (!page) return null;
    var section = page.sections.filter(function (s) { return s.id === sectionId; })[0];
    if (!section || !section.crops) return null;
    return section.crops[slot] || null;
  }

  function cropStyle(crop) {
    if (!crop) return "";
    var x = clamp01(crop.x), y = clamp01(crop.y);
    var w = clampRange(crop.w, 0.05, 1), h = clampRange(crop.h, 0.05, 1);
    /* never let the window spill outside the image */
    if (x + w > 1) { w = 1 - x; }
    if (y + h > 1) { h = 1 - y; }
    if (w <= 0 || h <= 0) return "";
    /* The window was computed and then thrown away: this used to emit only
       object-position, which slides a cover-fitted image around without
       magnifying it, so cropping saved, persisted and repainted - and
       changed nothing on screen. Reported as "i cropped it and it dont
       update". Zooming by the inverse of the window is what makes a crop a
       crop; object-position then chooses which part sits in frame.

       Scale is taken from w only, so the image is never distorted: h still
       controls how much vertical is in frame through object-position. */
    var scale = 1 / w;
    return "object-fit:cover;" +
      "object-position:" + (x + w / 2) * 100 + "% " + (y + h / 2) * 100 + "%;" +
      "transform:scale(" + scale.toFixed(4) + ");" +
      "transform-origin:" + (x + w / 2) * 100 + "% " + (y + h / 2) * 100 + "%;";
  }

  function clamp01(n) {
    n = Number(n);
    if (!isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }
  function clampRange(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) return hi;
    return Math.min(hi, Math.max(lo, n));
  }

  SS.cropOf = cropOf;
  SS.cropStyle = cropStyle;

  /* ctx is optional: crops only apply to the page being rendered */
  function picture(src, slot, alt, cls, crop) {
    if (!src) {
      return '<div class="ss-img ss-img--empty" data-img-slot="' + esc(slot) + '"' +
        ' role="button" tabindex="0" aria-label="Add an image"></div>';
    }
    var style = cropStyle(crop);
    return '<img src="' + esc(src) + '" alt="' + esc(alt || "") + '" loading="lazy"' +
      (style ? ' style="' + style + '"' : "") +
      (crop ? ' data-cropped="1"' : "") +
      ' data-img-slot="' + esc(slot) + '"' + (cls ? ' class="' + cls + '"' : "") + ">";
  }

  /* ---------- blocks: one builder per section type ---------- */

  var BLOCKS = {};

  BLOCKS.hero = function (ctx) {
    var s = ctx.section, v = ctx.variant;
    var cta = (s.fields && s.fields.buttonText) || "Get started";
    var body = text(s.subtitle, "subtitle");

    if (v === "overlay") {
      return '<section class="ss-sec g-hero v-overlay" ' + ctx.wrapAttrs + '>' +
          '<div class="ss-wrap">' + ctx.imageTag +
            '<p class="ss-eyebrow"' + ed("subtitle") + ">" + esc(s.subtitle || "") + "</p>" +
            "<h1" + ed("title") + ">" + esc(s.title || "") + "</h1>" +
            '<a class="ss-btn"' + ed("fields:buttonText") + ' href="#">' + esc(cta) + "</a>" +
          "</div></section>";
    }
    if (v === "type") {
      return '<section class="ss-sec g-hero v-type" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap">' +
          "<h1" + ed("title") + ">" + esc(s.title || "") + "</h1>" +
          '<div class="ss-rule" aria-hidden="true"></div>' +
          body +
          '<a class="ss-btn"' + ed("fields:buttonText") + ' href="#">' + esc(cta) + "</a>" +
        "</div></section>";
    }
    var flip = (v === "split" && ctx.index % 2 === 1) ? " v-flip" : "";
    return '<section class="ss-sec g-hero v-split' + flip + '" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap">' +
        "<div><h1" + ed("title") + ">" + esc(s.title || "") + "</h1>" + body +
        '<p style="margin-top:1.6rem"><a class="ss-btn"' + ed("fields:buttonText") + ' href="#">' + esc(cta) + "</a></p></div>" +
        "<div>" + ctx.imageTag + "</div>" +
      "</div></section>";
  };

  /* Placeholder guidance belongs in the editor, not on a published page.

     A visitor reading "Replace this with your own story." on a live site is
     looking at instructions meant for the person building it. These strings
     were rendered by the renderer rather than stored in the plan, so no
     amount of editing the content would ever have removed them - found by
     screenshotting a published page and reading that sentence on it. The
     hint stays in the builder, which is where it earns its keep.

     Returns raw text, not HTML. The callers escape it, and text() escapes
     its own argument, so escaping here as well would double it. */
  function hint(ctx, real, placeholder) {
    if (real) return real;
    return ctx.editable ? placeholder : "";
  }

  BLOCKS.about = function (ctx) {
    var s = ctx.section;
    if (ctx.variant === "quote") {
      return '<section class="ss-sec g-about v-quote" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap"><blockquote class="ss-quote" style="max-width:none">' +
        '<span' + ed("title") + ">" + esc(s.title || "") + "</span></blockquote>" + text(s.subtitle, "subtitle") +
        '<p' + ed("body") + ">" + esc(hint(ctx, s.body, "Replace this with your own story.")) + "</p>" +
        "</div></section>";
    }
    var flip = ctx.index % 2 === 1 ? " v-flip" : "";
    return '<section class="ss-sec g-about v-split' + flip + '" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><div><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<p' + ed("body") + ">" + esc(hint(ctx, s.body, "Tell the short version: what you do and who for.")) + "</p></div>" +
      "<div>" + ctx.imageTag + "</div></div></section>";
  };

  /* crop is passed in rather than read off a `ctx`.

     This helper sits outside every block, so there is no ctx in scope here -
     reaching for one worked until a list section actually had items, and then
     it threw "ctx is not defined" and took the whole page down. Empty lists
     returned early, which is exactly why it looked intermittent: it only
     broke for the plans that had something to show. */
  function cardsOf(section, path, limit, fallbackImage, crop, editable, pool) {
    var list = items(section).slice(0, limit || 6);
    if (!list.length) return "";
    var cropFn = typeof crop === "function" ? crop : function () { return null; };
    /* hint() wants a ctx, and there isn't one here by design. editable is
       passed in instead, for the same reason the comment above says: reaching
       for a ctx from out here works right up until a list actually has items
       and then takes the page down. */
    var fakeCtx = { editable: !!editable };
    /* One fallback per card, not one for the whole section. Three menu items
       all rendered the same photograph - measured on a live publish, all
       three pointing at photo-1552566626. Stepping by the card index means
       the pictures differ, and an item that has its own photo still wins. */
    function cardImage(item, i) {
      if (item.img) return item.img;
      if (pool && pool.length) return pool[i % pool.length];
      return fallbackImage;
    }
    return list.map(function (item, i) {
      return '<article class="ss-card">' +
        /* always render the slot, so every card is clickable for a
           picture even before the user chooses one */
        picture(cardImage(item, i), path + ":" + i + ":img", item.title, null, cropFn(path + ":" + i + ":img")) +
        "<h3" + ed(path + ":" + i + ":title") + ">" + esc(hint(fakeCtx, item.title, "Title")) + "</h3>" +
        text(hint(fakeCtx, item.text, "A line about this."), path + ":" + i + ":text", "p") +
        "</article>";
    }).join("");
  }

  BLOCKS.features = function (ctx) {
    var s = ctx.section;
    if (ctx.variant === "rows") {
      return '<section class="ss-sec g-features v-rows" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
        text(s.subtitle, "subtitle") +
        '<div class="ss-rows">' + items(s).map(function (item, i) {
          return '<div class="ss-row"><div><h3' + ed("items:" + i + ":title") + ">" + esc(item.title) + "</h3>" +
            text(item.text || "", "items:" + i + ":text", "p") + "</div></div>";
        }).join("") + "</div></div></section>";
    }
    return '<section class="ss-sec g-features v-grid" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<div class="ss-grid">' + cardsOf(s, "items", 6, ctx.poolImage, ctx.crop, ctx.editable, ctx.cardPool) + "</div></div></section>";
  };

  BLOCKS.products = function (ctx) {
    var s = ctx.section;
    var cards = items(s).slice(0, 8).map(function (item, i) {
      return '<article class="ss-card">' +
        picture(item.img || ctx.fallback(i), "items:" + i + ":img", item.title, null, ctx.crop("items:" + i + ":img")) +
        "<h3" + ed("items:" + i + ":title") + ">" + esc(item.title) + "</h3>" +
        text(item.text || "", "items:" + i + ":text", "p") +
        (item.price ? '<p class="ss-row-price" style="margin:.6rem 0 0">' + esc(item.price) + "</p>" : "") +
        "</article>";
    }).join("");
    return '<section class="ss-sec g-products v-' + (ctx.variant === "shelf" ? "shelf" : "grid") + '" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<div class="ss-grid">' + cards + "</div></div></section>";
  };

  BLOCKS.menu = function (ctx) {
    var s = ctx.section;
    var rows = items(s).map(function (item, i) {
      return "<li><b" + ed("items:" + i + ":title") + ">" + esc(item.title) + "</b>" +
        (item.text ? "<span" + ed("items:" + i + ":text") + ">" + esc(item.text) + "</span>" : "") +
        (item.price ? '<span class="ss-row-price">' + esc(item.price) + "</span>" : "") + "</li>";
    }).join("");
    if (ctx.variant === "cards") {
      return '<section class="ss-sec g-menu v-grid" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
        text(s.subtitle, "subtitle") +
        '<div class="ss-grid">' + cardsOf(s, "items", 6, ctx.poolImage, ctx.crop, ctx.editable, ctx.cardPool) + "</div></div></section>";
    }
    return '<section class="ss-sec g-menu v-list" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<ul class="ss-menu">' + rows + "</ul></div></section>";
  };

  /* A free-arrange photo wall.
     Deliberately not a template: there is no preset layout to pick, the
     user drops pictures in, drags them into the order they want and
     sizes each one. The composition is theirs, so two sites built the
     same way never look the same.

     Each picture also carries its own shape and frame, so it can be a
     plain rectangle, a circle, an arch, or anything in between, framed
     however the owner likes. Shape and frame are per-photo, never
     global, because that is what stops every photo looking the same. */
  var PHOTO_SIZES = ["s", "w", "t", "l"];
  var PHOTO_SIZE_LABEL = { s: "Small", w: "Wide", t: "Tall", l: "Large" };
  SS.PHOTO_SIZES = PHOTO_SIZES;
  SS.PHOTO_SIZE_LABEL = PHOTO_SIZE_LABEL;

  /* clip-path based shapes: they work on any image and need no markup */
  var PHOTO_SHAPES = ["rect", "rounded", "circle", "arch", "diamond", "blob", "leaf"];
  var PHOTO_SHAPE_LABEL = {
    rect: "Square corners",
    rounded: "Rounded",
    circle: "Circle",
    arch: "Arch",
    diamond: "Diamond",
    blob: "Organic",
    leaf: "Leaf"
  };
  var PHOTO_FRAME_STYLES = ["solid", "dashed", "double", "none"];
  SS.PHOTO_SHAPES = PHOTO_SHAPES;
  SS.PHOTO_SHAPE_LABEL = PHOTO_SHAPE_LABEL;
  SS.PHOTO_FRAME_STYLES = PHOTO_FRAME_STYLES;

  /* Shapes that only read correctly when square. On a wide tile a "circle"
     would stretch into an ellipse, which is not what anyone picking Circle
     means, so these are centred as squares inside whatever space they get. */
  var FIT_SHAPES = {
    circle: 1, arch: 1, diamond: 1, blob: 1, leaf: 1
  };

  /* Free-floating decoration on the wall: a shape the owner places behind
     or in front of the photographs, at any position, any size, any colour.
     Position and size are percentages of the wall so the arrangement
     survives a phone screen without needing a second set of numbers. */
  function decorHTML(section) {
    var list = Array.isArray(section.decor) ? section.decor : [];
    if (!list.length) return "";
    return list.map(function (d, i) {
      var shape = PHOTO_SHAPES.indexOf(d.shape) === -1 ? "circle" : d.shape;
      var layer = d.layer === "over" ? "over" : "under";
      var css = [
        "left:" + clampNum(d.x, -40, 140) + "%",
        "top:" + clampNum(d.y, -60, 160) + "%",
        "width:" + clampNum(d.w, 1, 200) + "%",
        "height:" + clampNum(d.h, 1, 200) + "%",
        "background:" + (d.color || "#16283c"),
        "opacity:" + (d.opacity === undefined || d.opacity === null ? 1 : clampNum(d.opacity, 0.05, 1)),
        "transform:rotate(" + clampNum(d.rotate, -180, 180) + "deg)"
      ];
      if (shape === "rounded" && d.radius) css.push("border-radius:" + d.radius);
      if (d.shape === "rect") css.push("border-radius:0");
      return '<span class="ss-decor ss-decor--' + layer + '" data-decor="' + i +
        '" style="' + esc(css.join(";")) + ';clip-path:var(--shape-' + shape + ')" aria-hidden="true"></span>';
    }).join("");
  }

  function clampNum(value, lo, hi) {
    var n = Number(value);
    if (!isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  /* the shape lives on an inner wrapper so the frame can sit outside it */
  function tileStyle(item) {
    var css = [];
    var shape = PHOTO_SHAPES.indexOf(item.shape) === -1 ? "rect" : item.shape;
    if (shape !== "rect") css.push("--tile-shape:var(--shape-" + shape + ")");
    if (shape === "rounded" && item.radius) css.push("--tile-radius:" + item.radius);

    var f = item.frame || {};
    if (f.width) css.push("--tile-frame-w:" + f.width);
    if (f.color) css.push("--tile-frame-color:" + f.color);
    if (f.style) css.push("--tile-frame-style:" + f.style);
    if (f.padding) css.push("--tile-frame-pad:" + f.padding);
    if (f.shadow) css.push("--tile-shadow:" + f.shadow);

    return css.length ? ' style="' + esc(css.join(";")) + '; "' : "";
  }

  BLOCKS.images = function (ctx) {
    var s = ctx.section;
    var list = items(s);

    var tiles = list.map(function (item, i) {
      var size = PHOTO_SIZES.indexOf(item.size) === -1 ? "s" : item.size;
      var shape = PHOTO_SHAPES.indexOf(item.shape) === -1 ? "rect" : item.shape;
      var controls = ctx.editable
        ? '<span class="ss-tile-tools">' +
            '<button type="button" class="ss-tile-grip" data-grip aria-label="Drag to reorder this photo">' +
              '<i class="bi bi-grip-vertical" aria-hidden="true"></i></button>' +
            '<button type="button" class="ss-tile-style" data-tile-style="' + i + '" ' +
              'aria-label="Shape and frame, currently ' + (PHOTO_SHAPE_LABEL[shape] || shape) + '">' +
              '<i class="bi bi-bounding-box-circles" aria-hidden="true"></i></button>' +
            '<button type="button" class="ss-tile-size" data-tile-size="' + i + '" ' +
              'aria-label="Change size, currently ' + (PHOTO_SIZE_LABEL[size] || size) + '">' +
              '<i class="bi bi-aspect-ratio" aria-hidden="true"></i></button>' +
            '<button type="button" class="ss-tile-del" data-tile-del="' + i + '" ' +
              'aria-label="Remove this photo"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
          "</span>"
        : "";

      return '<figure class="ss-tile ss-tile--' + size + '" data-tile="' + i + '"' +
          tileStyle(item) + ">" +
        '<div class="ss-tile-frame' + (FIT_SHAPES[shape] ? " ss-tile-frame--fit" : "") + '">' +
          /* an unfilled slot stays visibly empty instead of borrowing the
             same stock photo as every other slot, which made five blanks
             look like five copies of one picture */
          /* picture() escapes alt itself, so this stays raw. "Add a photo" is a
         label for an empty slot, not a description of a photograph: a
         filled tile with no caption was shipping alt="Add a photo", which
         tells a screen reader user nothing at all. */
      picture(item.img, "items:" + i + ":img", hint(ctx, item.title, "Add a photo")) +
        "</div>" +
        controls +
        /* the caption placeholder is an editor affordance; on a live page
           an uncaptioned photo gets no empty figcaption box */
        (item.text || (ctx.editable && size !== "s")
          ? '<figcaption><span' + ed("items:" + i + ":text") + ">" +
            esc(hint(ctx, item.text, "Add a caption")) + "</span></figcaption>"
          : "") +
        "</figure>";
    }).join("");

    /* the trailing add-tile exists only in the editor */
    var addTile = ctx.editable
      ? '<button type="button" class="ss-tile-add" data-add-tile>' +
        '<i class="bi bi-plus-lg" aria-hidden="true"></i><span>Add a photo</span></button>'
      : "";

    return '<section class="ss-sec g-images" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap">' +
      '<h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<div class="ss-wall" data-wall>' + decorHTML(s) + tiles + addTile + "</div>" +
      "</div></section>";
  };

  BLOCKS.gallery = function (ctx) {
    var s = ctx.section;
    var cards = items(s).slice(0, 9).map(function (item, i) {
var shape = PHOTO_SHAPES.indexOf(item.shape) === -1 ? "rect" : item.shape;
      /* Gallery cards rendered a bare <img>, so the shape, frame and shadow
         variables were never applied to them, and there was no way to reach
         the panel that sets them - the style button exists only on the photo
         wall. Both halves fixed here: the tile wrapper carries
         tileStyle(item), and the button opens the same photoPanel the wall
         uses. Reported as "I can't edit their shape or their style". */
      var controls = ctx.editable
        ? '<span class="ss-tile-tools">' +
            '<button type="button" class="ss-tile-style" data-tile-style="' + i + '" ' +
            'aria-label="Shape and frame for photo ' + (i + 1) + ", currently " +
            (PHOTO_SHAPE_LABEL[shape] || shape) + '">' +
            '<i class="bi bi-bounding-box-circles" aria-hidden="true"></i></button>' +
          "</span>"
        : "";
      return '<figure class="ss-card ss-tile" data-tile="' + i + '"' +
          tileStyle(item) + ">" +
        '<div class="ss-tile-frame' + (FIT_SHAPES[shape] ? " ss-tile-frame--fit" : "") + '">' +
        picture(item.img || ctx.fallback(i), "items:" + i + ":img", item.title || s.title, null, ctx.crop("items:" + i + ":img")) +
        controls +
        "</div>" +
        (item.text ? '<figcaption>' +
          '<span' + ed("items:" + i + ":text") + ">" + esc(item.text) + "</span></figcaption>" : "") +
        "</figure>";
    }).join("");
    return '<section class="ss-sec g-gallery v-' + ctx.variant + '" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<div class="ss-grid">' + cards + "</div></div></section>";
  };

  BLOCKS.team = function (ctx) {
    var s = ctx.section;
    if (ctx.variant === "rows") {
      return '<section class="ss-sec g-team v-rows" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
        '<div class="ss-rows">' + items(s).map(function (item, i) {
          return '<div class="ss-row"><div style="display:flex;gap:1rem;align-items:center">' +
            picture(item.img || ctx.fallback(i), "items:" + i + ":img", item.title, "ss-avatar", ctx.crop("items:" + i + ":img")) +
            "<div><h3" + ed("items:" + i + ":title") + ">" + esc(item.title) + "</h3>" +
            text(item.text || "", "items:" + i + ":text", "p") + "</div></div></div>";
        }).join("") + "</div></div></section>";
    }
    return '<section class="ss-sec g-team v-grid" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<div class="ss-grid">' + cardsOf(s, "items", 6, ctx.poolImage, ctx.crop, ctx.editable, ctx.cardPool) + "</div></div></section>";
  };

  BLOCKS.blog = function (ctx) {
    var s = ctx.section;
    var posts = items(s).slice(0, 6);
    if (ctx.variant === "featured") {
      return '<section class="ss-sec g-blog v-featured" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap">' +
        '<h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
        text(s.subtitle, "subtitle") +
        posts.map(function (item, i) {
          return '<article class="ss-post"' + (i ? ' style="border-top:1px solid var(--line);padding-top:1.6rem"' : "") + ">" +
            '<p class="ss-post-meta"' + ed("items:" + i + ":text") + ">" + esc(item.text || "") + "</p>" +
            "<h3" + ed("items:" + i + ":title") + '><a href="#">' + esc(item.title) + "</a></h3></article>";
        }).join("") + "</div></section>";
    }
    return '<section class="ss-sec g-blog v-grid" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      '<div class="ss-grid">' + posts.map(function (item, i) {
        return '<article class="ss-card ss-post">' +
          picture(item.img || ctx.fallback(i), "items:" + i + ":img", item.title, null, ctx.crop("items:" + i + ":img")) +
          '<p class="ss-post-meta"' + ed("items:" + i + ":text") + ">" + esc(item.text || "") + "</p>" +
          "<h3" + ed("items:" + i + ":title") + '><a href="#">' + esc(item.title) + "</a></h3></article>";
      }).join("") + "</div></div></section>";
  };

  BLOCKS.testimonials = function (ctx) {
    var s = ctx.section;
    var list = items(s).slice(0, 3);
    if (ctx.variant === "big" && list.length) {
      var first = list[0];
      return '<section class="ss-sec g-testimonials v-big ss-sec--center" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
        '<blockquote class="ss-quote"\n          <span' + ed("items:0:title") + ">" + esc(first.title) + "</span></blockquote>" +
        '<cite class="ss-cite"><span' + ed("items:0:text") + ">" + esc(first.text) + "</span></cite>" +
        "</div></section>";
    }
    return '<section class="ss-sec g-testimonials v-grid" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      '<div class="ss-grid">' + list.map(function (item, i) {
        return '<article class="ss-card"><blockquote><span' + ed("items:" + i + ":title") + ">" +
          esc(item.title) + "</span></blockquote>" +
          '<cite class="ss-cite"><span' + ed("items:" + i + ":text") + ">" + esc(item.text) + "</span></cite></article>";
      }).join("") + "</div></div></section>";
  };

  BLOCKS.contact = function (ctx) {
    var s = ctx.section;
    var form =
      '<form class="ss-form" onsubmit="return false">' +
        '<div><label for="cf-n">Your name</label><input id="cf-n" placeholder="Your name"></div>' +
        '<div><label for="cf-e">Email</label><input id="cf-e" type="email" placeholder="you@example.com"></div>' +
        '<div><label for="cf-m">Message</label><textarea id="cf-m" rows="4" placeholder="How can we help?"></textarea></div>' +
        '<div><button class="ss-btn" type="submit">Send message</button></div>' +
      "</form>";
    if (ctx.variant === "center") {
      return '<section class="ss-sec g-contact v-center ss-sec--center" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
        text(s.subtitle, "subtitle") + form + "</div></section>";
    }
    return '<section class="ss-sec g-contact v-split' + (ctx.index % 2 ? " v-flip" : "") + '" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><div><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") + form + "</div>" +
      "<div>" + ctx.imageTag + "</div></div></section>";
  };

  BLOCKS.hours = function (ctx) {
    var s = ctx.section;
    var dl = items(s).map(function (item, i) {
      return "<dt" + ed("items:" + i + ":title") + ">" + esc(item.title) + "</dt>" +
        '<dd' + ed("items:" + i + ":text") + ">" + esc(item.text || "") + "</dd>";
    }).join("");
    if (ctx.variant === "split") {
      return '<section class="ss-sec g-hours v-split' + (ctx.index % 2 ? " v-flip" : "") + '" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap"><div><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
        '<dl class="ss-hours">' + dl + "</dl></div><div>" + ctx.imageTag + "</div></div></section>";
    }
    return '<section class="ss-sec g-hours v-table ss-sec--soft" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<dl class="ss-hours">' + dl + "</dl></div></section>";
  };

  BLOCKS.faq = function (ctx) {
    var s = ctx.section;
    var list = items(s);
    if (ctx.variant === "columns") {
      return '<section class="ss-sec g-faq v-columns" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
        '<div class="ss-faq">' + list.map(function (item, i) {
          return "<details><summary><h3" + ed("items:" + i + ":title") + ">" + esc(item.title) + "</h3></summary>" +
            text(item.text || "", "items:" + i + ":text", "p") + "</details>";
        }).join("") + "</div></div></section>";
    }
    return '<section class="ss-sec g-faq v-accordion" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<div class="ss-faq">' + list.map(function (item, i) {
        return "<details><summary" + ed("items:" + i + ":title") + ">" + esc(item.title) + "</summary>" +
          text(item.text || "", "items:" + i + ":text", "p") + "</details>";
      }).join("") + "</div></div></section>";
  };

  BLOCKS.cta = function (ctx) {
    var s = ctx.section;
    var btn = '<a class="ss-btn' + (ctx.variant === "band" ? " ss-btn--onaccent" : "") + '"' +
      ed("fields:buttonText") + ' href="#">' + esc((s.fields && s.fields.buttonText) || "Get started") + "</a>";
    if (ctx.variant === "box") {
      return '<section class="ss-sec g-cta v-box" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap"><div class="ss-box"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
        text(s.subtitle, "subtitle", "p") + btn + "</div></div></section>";
    }
    return '<section class="ss-sec g-cta v-band" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><div><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle", "p") + "</div>" + btn + "</div></section>";
  };

  BLOCKS.newsletter = function (ctx) {
    var s = ctx.section;
    var form =
      '<form class="ss-form-row" onsubmit="return false">' +
        '<div class="ss-field"><label for="nl-e">Email</label>' +
        '<input id="nl-e" type="email" placeholder="you@example.com"></div>' +
        '<button class="ss-btn" type="submit">Subscribe</button></form>';
    if (ctx.variant === "stack") {
      return '<section class="ss-sec g-newsletter v-stack ss-sec--center" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
        text(s.subtitle, "subtitle") + form + "</div></section>";
    }
    return '<section class="ss-sec g-newsletter v-row ss-sec--soft" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><div><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") + "</div>" + form + "</div></section>";
  };

  SS.BLOCKS = BLOCKS;

  /* ---------- page ---------- */

  /* The one place a page id becomes part of a URL.

     It has to match projects.slugify on the server exactly, because the
     server stores compiled pages under the slugified key and looks them up by
     the path segment. "About Us" and "about-us" both have to arrive as
     "about-us" or the link is dead. Kept short and boring on purpose. */
  SS.pageKey = function (id) {
    var out = String(id === undefined || id === null ? "" : id)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-\s]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return out || "home";
  };

  /* The menu is a separate structure from the pages.

     Pages are what exist; the menu is which of them a visitor is shown, in
     what order, under what name, and what hangs beneath. Deriving one from
     the other means a page cannot be renamed in the menu, reordered, hidden,
     or nested - and the nav is the second most looked-at thing on a small
     business site after the hero.

     plan.nav is optional. A plan without one keeps working and renders every
     page in order, which is what every site made before this existed does. */
  function safeHref(value) {
  /* A published page is a finished HTML document served from our origin,
     and the menu is the one place a user types a URL that goes straight into
     an href attribute. Without this, "javascript:..." would survive into the
     published document: the publish endpoint strips <script> and event
     handlers, but it cannot see inside an attribute.

     Only the schemes a business menu actually uses are allowed. Anything
     else - including a relative-looking string with a colon in it - becomes
     no link at all rather than a surprise. */
  var raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
  /* A plain web address with no scheme is what people actually type, so
     "example.com" is allowed and normalised to https. */
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/.*)?$/i.test(raw)) {
    return "https://" + raw;
  }
  return "";
}

function navItems(plan) {
    var pages = plan.pages || [];
    if (Array.isArray(plan.nav) && plan.nav.length) {
      /* Drop entries whose page has since been deleted, rather than
         rendering a link to nothing. */
      var seen = {};
      /* An entry is kept if it points at a page that still exists, or if it is
         a custom link - which has an href and no page at all. That second
         case is why a user can link to their Instagram rather than being
         limited to the pages SiteSketch happens to have generated. */
      function keeps(item, seenMap) {
        if (!item) return false;
        /* A custom link is kept on its own account - it has no page. */
        if (item.href && safeHref(item.href)) return true;
        /* A section anchor: it points at a block on a page, not a page. It
           needs its own existence test, or a menu entry for a deleted
           section would survive and link to nothing. */
        if (item.sectionId) {
          if (seenMap["s:" + item.sectionId]) return false;
          seenMap["s:" + item.sectionId] = true;
          return sectionExists(item.pageId, item.sectionId);
        }
        if (!item.pageId) return false;
        if (seenMap[item.pageId]) return false;
        /* Marked seen here, after the duplicate test and not before it.
           Doing it first made every page-backed entry reject itself as a
           duplicate of itself, which silently dropped the home page from
           the menu. */
        seenMap[item.pageId] = true;
        return pages.some(function (p) { return p.id === item.pageId; });
      }
      /* A section lives on whichever page holds it; pageId may be absent, in
         which case the home page is meant. */
      function sectionExists(pageId, sectionId) {
        var host = pageId
          ? pages.filter(function (p) { return p.id === pageId; })[0]
          : pages[0];
        if (!host) return false;
        return (host.sections || []).some(function (s) { return s.id === sectionId; });
      }
      function trim(item) {
        return {
          pageId: item.pageId || null,
          sectionId: item.sectionId || null,
          href: safeHref(item.href),
          label: String(item.label || ""),
          visible: item.visible !== false,
          /* Children get their own duplicate map. Sharing the top-level one
             meant a submenu entry pointing at a page that was also in the
             menu rejected itself as a duplicate and the submenu silently
             rendered empty. */
          children: Array.isArray(item.children)
            ? item.children.filter(function (c) { return keeps(c, {}); })
                .map(trim)
            : []
        };
      }
      var out = [];
      plan.nav.forEach(function (item) {
        if (keeps(item, seen)) out.push(trim(item));
      });
      return out;
    }
    /* No saved menu yet.
       A one-page site used to default to a single "Home" link pointing at
       the page you are already on, so a six-section site had a navbar that
       reached nothing. Default it to its own sections instead - the titles
       are already written, and this is what a brochure one-pager is. Only
       for a single page: with several, page links are the right answer. */
    if (pages.length === 1) {
      var home = pages[0];
      var blocks = (home.sections || []).filter(function (s) { return !s.hidden; });
      if (blocks.length > 1) {
        return blocks.map(function (s, n) {
          /* The first block is the top of the page; a "Home" link to it
             would sit next to a link to the very same place. */
          return n === 0
            ? { pageId: home.id, label: "", visible: true, children: [] }
            : { pageId: home.id, sectionId: s.id, label: "", visible: true, children: [] };
        });
      }
    }
    return pages.map(function (p) {
      return { pageId: p.id, label: "", visible: true, children: [] };
    });
  }
  SS.navItems = navItems;
  SS.safeHref = safeHref;

  function navHTML(plan, pageId, spec, options) {
    options = options || {};
    var meta = plan.meta || {};
    var name = meta.siteName || "SiteSketch";
    var pages = plan.pages || [];
    var homeId = pages.length ? pages[0].id : pageId;

    /* In the builder the pages are switched by tabs, so the links are only
       ever in-page anchors and are never followed. On a published site each
       page is its own document, so the same links have to be real URLs or
       the navigation is dead. pageBase is what makes them real. */
    function hrefFor(entry) {
      /* Accepts a nav entry or a bare page id, because the brand link in
         the footer passes a string. A custom link carries its own href and
         has no page at all. A section entry carries a sectionId and points
         at a block on a page - the fragment has to survive the page URL. */
      if (entry && typeof entry === "object") {
        if (entry.href) return entry.href;
        if (entry.sectionId) {
          /* In the builder the page itself is already on screen and the
             canvas is the document, so a section link is the bare fragment.
             Appending to a "#pageId" base produced "#home#s_123" - two
             fragments, which resolves to nothing. */
          if (!options.pageBase) return "#" + esc(entry.sectionId);
          return pageUrl(entry.pageId || homeId) + "#" + esc(entry.sectionId);
        }
        entry = entry.pageId;
      }
      if (!entry) return "#";
      return pageUrl(entry);
    }

    /* The real address of a page. Extracted because a section entry needs
       it too: the fragment goes after the page, not instead of it. */
    function pageUrl(id) {
      if (!id) return options.pageBase || "#";
      if (!options.pageBase) return "#" + esc(id);
      var key = SS.pageKey(id);
      return key === SS.pageKey(homeId) ? options.pageBase
                                        : options.pageBase + "/" + key;
    }

    function nameOf(target, label) {
      if (label) return label;
      var page = pages.filter(function (p) { return p.id === target; })[0];
      return page ? page.name : "";
    }

    /* A section entry is named after the section, not the page. Its title is
       already written - that is the whole reason for defaulting to these. */
    function labelFor(entry) {
      if (entry.label) return entry.label;
      if (entry.sectionId) {
        var host = pages.filter(function (p) {
          return p.id === (entry.pageId || homeId);
        })[0] || pages[0];
        var sec = host && (host.sections || []).filter(function (s) {
          return s.id === entry.sectionId;
        })[0];
        if (sec && sec.title) return sec.title;
      }
      return nameOf(entry.pageId, entry.label);
    }

    /* `entry` rather than `target`/`label` separately: a custom link has no
       pageId to pass, so the two-argument form could not express one. */
    function link(entry, sub) {
      var target = entry.pageId || null;
      /* aria-current marks the page you are on. A section anchor is on the
         same page, so marking it too would put "current" on every link. */
      var current = !!target && target === pageId && !entry.sectionId;
      return '<a href="' + esc(hrefFor(entry)) + '"' +
        (current ? ' aria-current="page" style="color:var(--text)"' : "") +
        (sub ? ' class="ss-sublink"' : "") + ">" +
        esc(labelFor(entry)) + "</a>";
    }

    var visible = navItems(plan).filter(function (i) { return i.visible; });
    var links = visible.map(function (item) {
      var kids = item.children.map(function (c) {
        return link(c, true);
      }).join("");
      /* Only wrap in a submenu container when there is something to put in
         it, so a flat menu stays flat markup. */
      var sub = kids
        ? '<div class="ss-submenu" data-submenu>' + kids + "</div>"
        : "";
      /* has-sub belongs INSIDE the class attribute. Appending it after the
         closing quote produced <div class="ss-navitem" has-sub=""> - a stray
         boolean attribute that matched no selector, so .ss-navitem.has-sub
         never applied and the submenu could never open. */
      var cls = "ss-navitem" + (item.children.length ? " has-sub" : "");
      return '<div class="' + cls + '">' +
        link(item, false) + sub + "</div>";
    }).join("");

    var style = spec.nav || "bar";
    var cls = style === "outline" ? "ss-nav ss-nav--outline" : style === "minimal" ? "ss-nav ss-nav--minimal" : "ss-nav ss-nav--bar";
    return '<nav class="' + cls + '"><div class="ss-wrap ss-navrow">' +
      '<a class="ss-brand" href="' + esc(hrefFor(homeId)) + '">' + esc(name) + "</a>" +
      '<div class="ss-navlinks">' + links + "</div></div></nav>";
  }

  /* The footer is a real block. It lives in plan.footer and is edited
     inline like every other block, using the same data-edit hooks, so
     users can type into it and set real URLs on the social links. */
  function footerData(plan) {
    var f = plan.footer || {};
    return {
      tagline: f.tagline !== undefined ? f.tagline : "Made with SiteSketch.",
      aboutTitle: f.aboutTitle !== undefined ? f.aboutTitle : "",
      linkTitle: f.linkTitle !== undefined ? f.linkTitle : "Pages",
      contactTitle: f.contactTitle !== undefined ? f.contactTitle : "Contact",
      socials: Array.isArray(f.socials) && f.socials.length
        ? f.socials
        : [
          { label: "Email us", url: "mailto:hello@example.com" },
          { label: "Instagram", url: "https://instagram.com" },
          { label: "Facebook", url: "https://facebook.com" }
        ],
      copyright: f.copyright !== undefined ? f.copyright : "",
      style: f.style || {},
      hidden: f.hidden === true
    };
  }
  SS.footerData = footerData;

  function footerHTML(plan, spec, editable, pageId, options) {
    options = options || {};
    var meta = plan.meta || {};
    var name = meta.siteName || "SiteSketch";
    var f = footerData(plan);
    if (f.hidden) return "";

    var pages = plan.pages || [];
    var homeId = pages.length ? pages[0].id : pageId;
    var year = new Date().getFullYear();
    /* These used to be href="#<page.id>" with nothing on the page carrying
       that id, so every "Pages" link in the footer went nowhere - measured
       on a live site: href="#home" with no id="home" anywhere in the
       document. A published page is its own document, so a link to another
       page has to be a real URL, exactly as the navbar already does it. */
    function pageHref(p) {
      if (!options.pageBase) return "#" + esc(p.id);
      var key = SS.pageKey(p.id);
      return key === SS.pageKey(homeId) ? options.pageBase
                                         : options.pageBase + "/" + key;
    }
    /* The footer used to list pages, so on a one-page site the whole column
       read "PAGES / Home" - one link to the page you are already on, under a
       heading for a list of one. The navbar already learned to list
       sections for exactly that reason, so the footer now follows: the same
       entries, the same anchors, resolved the same way. Multi-page sites
       still get their pages. */
    var footLinks = (function () {
      var entries = navItems(plan).filter(function (i) { return i.visible; });
      /* fall back to pages when the menu says nothing useful */
      if (!entries.length) {
        return pages.map(function (p) {
          return '<a href="' + esc(pageHref(p)) + '">' + esc(p.name) + "</a>";
        }).join("");
      }
      return entries.map(function (entry) {
        var target = entry.pageId || homeId;
        var base = options.pageBase ? pageHref(target) : "#" + esc(target);
        var href = entry.sectionId ? base + "#" + esc(entry.sectionId) : base;
        var label = entry.label;
        if (!label) {
          var page = pages.filter(function (p) { return p.id === target; })[0];
          label = page ? page.name : "";
        }
        if (entry.sectionId) {
          var host = pages.filter(function (p) { return p.id === target; })[0] || pages[0];
          var sec = host && (host.sections || []).filter(function (s) {
            return s.id === entry.sectionId;
          })[0];
          if (sec && sec.title) label = sec.title;
        }
        return '<a href="' + esc(href) + '">' + esc(label) + "</a>";
      }).join("");
    })();
    var links = footLinks;

    var socials = f.socials.map(function (s, i) {
      var href = s.url || "#";
      return '<a href="' + esc(href) + '"' + ed("socials:" + i + ":label") +
        ' rel="noopener" target="_blank">' + esc(s.label || "Link") + "</a>";
    }).join("");

    var copyright = f.copyright || (name + " \u00d7 " + year);

    var rich = spec.footer !== false;
    var html = rich
      ? '<footer class="ss-footer ss-footer--rich" data-foot="1"><div class="ss-wrap">' +
          '<div class="ss-foot-col">' +
            '<a class="ss-brand" href="' + esc(options.pageBase || "#") + '">' + esc(name) + "</a>" +
            '<p class="ss-foot-note"' + ed("aboutTitle") + ' style="margin-top:.6rem">' +
              esc(f.aboutTitle || f.tagline) + "</p>" +
          "</div>" +
          '<div class="ss-foot-col"><h3' + ed("linkTitle") + ">" + esc(f.linkTitle) + "</h3>" +
            '<div class="ss-foot-links">' + links + "</div></div>" +
          '<div class="ss-foot-col"><h3' + ed("contactTitle") + ">" + esc(f.contactTitle) + "</h3>" +
            '<div class="ss-foot-links">' + socials + "</div></div>" +
        "</div>" +
        '<div class="ss-wrap ss-foot-bottom">' +
          '<span class="ss-foot-note"' + ed("copyright") + ">" + esc(copyright) + "</span>" +
        "</div>" +
        "</footer>"
      : '<footer class="ss-footer" data-foot="1"><div class="ss-wrap" style="display:flex;justify-content:space-between;gap:1.5rem;flex-wrap:wrap">' +
          '<span class="ss-foot-note"' + ed("copyright") + ">" + esc(copyright) + "</span>" +
          '<span class="ss-foot-note">' + esc(name) + "</span>" +
        "</div></footer>";

    html = applyFooterStyle(html, f);
    if (editable) {
      var grip = '<button type="button" class="sec-grip" data-grip aria-label="Reorder or edit the footer">' +
        '<i class="bi bi-grip-vertical" aria-hidden="true"></i></button>';
      html = html.replace(/^(<footer\b[^>]*>)/, function (whole) { return whole + grip; });
    }
    return html;
  }

  function applyFooterStyle(html, f) {
    var css = [];
    if (f.style.bg) css.push("--sec-bg:" + f.style.bg);
    if (f.style.textColor) css.push("--sec-text:" + f.style.textColor);
    if (f.style.accent) css.push("--sec-accent:" + f.style.accent);
    /* A separate variable, so the footer's link colour changes only when the
       user actually picks an accent. --sec-accent is a global theme token and
       is always defined, so reading it directly would restyle every site's
       footer links whether or not anyone had touched the control. */
    if (f.style.accent) css.push("--foot-accent:" + f.style.accent);
    if (f.style.align) css.push("--sec-align:" + f.style.align);
    if (f.style.columns !== undefined) css.push("--foot-cols:" + f.style.columns);
    if (!css.length) return html;
    return html.replace(/^(<footer\b[^>]*?)(\s*>)/, function (whole, head, tail) {
      var merged = css.join(";") + ";";
      var existing = /style="([^"]*)"/.exec(head);
      if (existing) {
        head = head.replace(existing[0], ' style="' + merged + existing[1] + '"');
        return head + tail;
      }
      return head + ' style="' + merged + '"' + tail;
    });
  }

  /* Black or white, whichever is readable on this colour.
     Users pick backgrounds without thinking about contrast; this keeps
     their text legible instead of silently producing unreadable pages. */
  function readableOn(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return "inherit";
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    /* relative luminance, sRGB */
    function lin(c) {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    var L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    var onBlack = (L + 0.05) / 0.05;
    var onWhite = 1.05 / (L + 0.05);
    return onBlack >= onWhite ? "#000000" : "#FFFFFF";
  }
  SS.readableOn = readableOn;

  /* Per-block overrides, the WordPress "block settings" model.
     Everything a user can set on one section lives in section.style,
     and is written here as CSS custom properties so the block keeps
     using the site's own stylesheet - no inline soup to undo later. */
  function applySectionStyle(html, section) {
    var s = section.style || {};
    var css = [];

    if (s.bg) css.push("--sec-bg:" + s.bg);
    if (s.textColor) css.push("--sec-text:" + s.textColor);
    else if (s.bg) {
      /* A background the user chose can be light or dark. Inheriting the
         site's text colour gives unreadable contrast half the time, so
         pick black or white by luminance unless they set one themselves. */
      css.push("--sec-text:" + readableOn(s.bg));
    }
    if (s.accent) css.push("--sec-accent:" + s.accent);
    if (s.align) css.push("--sec-align:" + s.align);
    if (s.padTop !== undefined) css.push("--sec-pad-top:" + s.padTop);
    if (s.padBottom !== undefined) css.push("--sec-pad-bottom:" + s.padBottom);
    if (s.radius !== undefined) css.push("--sec-radius:" + s.radius);
    if (s.height) css.push("--sec-min-height:" + s.height);

    if (section.align === "center") css.push("--sec-align:center");

    if (!css.length) return html;
    /* merge with any style the block already set on its own tag */
    return html.replace(/^(<section\b[^>]*?)(\s*>)/, function (whole, head, tail) {
      var existing = /style="([^"]*)"/.exec(head);
      var merged = css.join(";") + ";";
      if (existing) {
        head = head.replace(existing[0], ' style="' + merged + existing[1] + '"');
        return head + tail;
      }
      return head + ' style="' + merged + '"' + tail;
    });
  }
  SS.applySectionStyle = applySectionStyle;

  function sectionHTML(section, index, plan, spec, editable, pageId) {
    var block = BLOCKS[section.type] || BLOCKS.about;
    var variant = variantOf(plan, section, spec);
    var image = imgOf(plan, section, spec, "img");
    var pools = window.DESIGN ? DESIGN.TYPE_IMAGES[(plan.meta || {}).type] || DESIGN.TYPE_IMAGES.business : [];
    var poolKey = pools.length ? pools[index % pools.length] : null;
    var poolImage = window.DESIGN ? ((DESIGN.IMAGES[poolKey] || [])[index % 3] || "") : "";
    /* A per-card spread of pictures, so cards inside one section do not all
       come out identical. Built from the same pool, offset by the section's
       own index so two sections do not start on the same photo either. */
    var poolList = window.DESIGN ? (DESIGN.IMAGES[poolKey] || []) : [];
    var cardPool = poolList.length
      ? poolList.map(function (_, k) { return poolList[(index + k) % poolList.length]; })
      : [];

    /* the section's own crop, if the user has set one */
    function crop(slot) { return cropOf(plan, pageId, section.id, slot); }

    var ctx = {
      section: section,
      index: index,
      variant: variant,
      image: image,
      imageTag: picture(image, "img", section.title, null, crop("img")),
      poolImage: poolImage,
      cardPool: cardPool,
      /* Per-item fallback. The duplicate-photo fix landed on cardsOf only,
         and four other blocks still passed ctx.poolImage to every item in
         the section - so a gallery, a menu list, a team row and a blog row
         each rendered the same photograph in every slot. Measured on a
         gallery: items 0, 1 and 2 all pointed at the same url. */
      fallback: function (i) {
        if (cardPool && cardPool.length) return cardPool[i % cardPool.length];
        return poolImage;
      },
      crop: crop,
      wrapAttrs: ' id="' + esc(section.id) + '" data-sect="' + esc(section.id) +
        '" data-sect-label="' + esc(section.type) + '"',
      editable: !!editable,
    };

    var html = block(ctx);
    html = applySectionStyle(html, section);
    if (!editable) return html;

    /* the block grip (drag handle + hover affordance), inserted as the first
       child of the section. Only ever rendered in the editor, never on a
       published page. It is a real button so keyboard and screen-reader
       users can reach it, not just people who can drag a mouse. */
    var label = "Reorder this section. Use the up and down buttons in the toolbar to move it.";
    var grip = '<button type="button" class="sec-grip" data-grip aria-label="' + esc(label) + '">' +
      '<i class="bi bi-grip-vertical" aria-hidden="true"></i></button>';
    return html.replace(/^(<section\b[^>]*>)/, function (whole) { return whole + grip; });
  }

  /* options: { editable, live } */
  SS.renderPage = function (plan, pageId, options) {
    options = options || {};
    var spec = SS.specFor(plan);
    ensureFonts(spec);
    var page = (plan.pages || []).filter(function (p) { return p.id === pageId; })[0] || plan.pages[0];
    if (!page) return "";

    var body = (page.sections || []).map(function (section, i) {
      if (section.hidden) return "";
      return sectionHTML(section, i, plan, spec, options.editable, page.id);
    }).join("\n");

    var cls = "ss-site" + (options.editable ? " is-editing" : "") + (options.live ? " is-live" : "");
    var cssVars = window.DESIGN ? DESIGN.cssVars(spec) : "";

    return '<div class="' + cls + '" style="' + cssVars + '">' +
      navHTML(plan, page.id, spec, options) +
      '<main data-reveal>' + body + "</main>" +
      footerHTML(plan, spec, options.editable, page.id, options) +
      "</div>";
  };

  /* scroll reveal, IntersectionObserver only (never a scroll listener) */
  SS.observeMotion = function (root) {
    if (!window.DESIGN) return;
    var scope = root || document;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var nodes = scope.querySelectorAll("[data-reveal], .ss-sec, .ss-grid > *");
    if (!("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    Array.prototype.forEach.call(nodes, function (node, i) {
      if (!node.hasAttribute("data-reveal") && !node.classList.contains("is-in")) node.setAttribute("data-reveal", "");
      node.style.setProperty("--reveal-i", Math.min(i % 4, 3));
      io.observe(node);
    });
  };

  /* kept for older call sites */
  SS.renderSite = function (plan, pageId, options) { return SS.renderPage(plan, pageId, options); };

  /* ---------------------------------------------------------------- publish
     Compiles a whole plan into one self-contained HTML document per page.

     A published site runs no JavaScript at all. That is a deliberate choice
     rather than a shortcut:

       - the server can answer with `script-src 'none'`, so anything that
         slips through the escaping in user content still cannot run;
       - the page cannot be slow because of our code, and cannot break
         because of a browser API that moved on;
       - the whole site is a handful of documents that the CDN and the
         browser cache like.

     The cost is the scroll-reveal animation, which needs an
     IntersectionObserver to add .is-in. Left switched on it would hide every
     section forever, so the compiled markup deliberately renders without the
     `is-live` class and everything is visible on arrival.
  */
  SS.compileSite = function (plan, options) {
    options = options || {};
    var base = options.pageBase || "";
    var css = options.css || "";
    var pages = plan.pages || [];
    if (!pages.length) return { pages: {}, home: "" };

    /* The stylesheet is a required argument, not an optional one.

       A published site is one self-contained document that runs zero
       JavaScript, so a page compiled without CSS is stored unstyled and
       stays that way until someone republishes by hand. Emitting it
       silently is the worst outcome available: it looks like it worked.

       Found by screenshotting a published site that had been compiled by a
       script passing no css, and seeing Times New Roman and blue
       underlines where a design should have been. */
    if (!css) {
      throw new Error("compileSite needs the site stylesheet: a published " +
                      "page has no JavaScript to load one later");
    }

    var spec = SS.specFor(plan);
    var fonts = window.DESIGN ? DESIGN.fontLink(spec) : "";
    var siteName = (plan.meta && plan.meta.siteName) || "SiteSketch";
    var out = {};
    var homeKey = "";

    pages.forEach(function (page, i) {
      /* One normalisation, used for the stored key AND the links. These have
         to agree or the navigation 404s: the server stores pages under a
         slugified key, so a page id of "About Us" has to become "about-us"
         in the href too, not just in the payload. Doing it in one place is
         the only way to be sure they cannot drift. */
      var key = SS.pageKey(page.id);
      var pageBase = i === 0 ? base : base + "/" + key;
      var body = SS.renderPage(plan, page.id, {
        editable: false,
        live: false,          /* see the note above: no observer on the server-side page */
        pageBase: pageBase
      });
      if (!body) return;
      if (i === 0) homeKey = key;

      /* The first page is the site; the rest are sections of it. Comparing
         page.name to pages[0].id to spot that looks tempting but is wrong -
         the display name is "Home" and the id is "home". Use the index. */
      var title = i === 0 ? siteName : page.name + " · " + siteName;
      /* A description of "Home" helps nobody, least of all a preview card. */
      var first = (page.sections || [])[0] || {};
      var blurb = (first.subtitle || "").trim();
      var desc = i === 0 ? (blurb || siteName) : ((page.name || "") + " · " + (blurb || siteName));

      out[key] = "<!doctype html>\n" +
        '<html lang="en">\n<head>\n' +
        '<meta charset="utf-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
        "<title>" + esc(title) + "</title>\n" +
        '<meta name="description" content="' + esc(desc) + '">\n' +
        '<meta property="og:title" content="' + esc(title) + '">\n' +
        '<meta property="og:description" content="' + esc(desc) + '">\n' +
        '<meta property="og:type" content="website">\n' +
        (fonts ? '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
                 '<link rel="stylesheet" href="' + esc(fonts) + '">\n' : "") +
        /* inlined so a published page is a single document with no extra
           round trip, and so the server does not have to trust a <link> it
           did not write itself */
        "<style>\n" + css + "\n</style>\n" +
        "</head>\n<body>\n" + body + "\n</body>\n</html>\n";
    });

    /* home is returned rather than left for the caller to guess. The server
       stores these pages as jsonb, which reorders keys, so "the first one" is
       not a fact that survives the round trip. */
    return { pages: out, home: homeKey };
  };

  window.SS = SS;
})();
