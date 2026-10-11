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
      ? DESIGN.generateSpec({ type: plan && plan.meta ? plan.meta.type : "business" }, seed)
      : { tokens: {}, sections: {} };
    if (plan) plan.design = spec;
    return spec;
  };

  function specFor(plan, section, spec) {
    return spec || SS.specFor(plan);
  }

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

  function picture(src, slot, alt, cls) {
    if (!src) {
      return '<div class="ss-img ss-img--empty" data-img-slot="' + esc(slot) + '"' +
        ' role="button" tabindex="0" aria-label="Add an image"></div>';
    }
    return '<img src="' + esc(src) + '" alt="' + esc(alt || "") + '" loading="lazy"' +
      ' data-img-slot="' + esc(slot) + '"' + (cls ? ' class="' + cls + '"' : "") + ">";
  }

  /* ---------- blocks: one builder per section type ---------- */

  var BLOCKS = {};

  BLOCKS.hero = function (ctx) {
    var s = ctx.section, v = ctx.variant;
    var cta = (s.fields && s.fields.buttonText) || "Get started";
    var body = text(s.subtitle, "subtitle");

    if (v === "overlay") {
      return picture(ctx.image, "img", s.title, "ss-bg") &&
        '<section class="ss-sec g-hero v-overlay" ' + ctx.wrapAttrs + '>' +
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

  BLOCKS.about = function (ctx) {
    var s = ctx.section;
    if (ctx.variant === "quote") {
      return '<section class="ss-sec g-about v-quote" ' + ctx.wrapAttrs + '>' +
        '<div class="ss-wrap"><blockquote class="ss-quote" style="max-width:none">' +
        '<span' + ed("title") + ">" + esc(s.title || "") + "</span></blockquote>" + text(s.subtitle, "subtitle") +
        '<p' + ed("body") + ">" + esc(s.body || "Replace this with your own story.") + "</p>" +
        "</div></section>";
    }
    var flip = ctx.index % 2 === 1 ? " v-flip" : "";
    return '<section class="ss-sec g-about v-split' + flip + '" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><div><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<p' + ed("body") + ">" + esc(s.body || "Tell the short version: what you do and who for.") + "</p></div>" +
      "<div>" + ctx.imageTag + "</div></div></section>";
  };

  function cardsOf(section, path, limit, fallbackImage) {
    var list = items(section).slice(0, limit || 6);
    if (!list.length) return "";
    return list.map(function (item, i) {
      return '<article class="ss-card">' +
        /* always render the slot, so every card is clickable for a
           picture even before the user chooses one */
        picture(item.img || fallbackImage, path + ":" + i + ":img", item.title) +
        "<h3" + ed(path + ":" + i + ":title") + ">" + esc(item.title || "Title") + "</h3>" +
        text(item.text || "A line about this.", path + ":" + i + ":text", "p") +
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
      '<div class="ss-grid">' + cardsOf(s, "items", 6, ctx.poolImage) + "</div></div></section>";
  };

  BLOCKS.products = function (ctx) {
    var s = ctx.section;
    var cards = items(s).slice(0, 8).map(function (item, i) {
      return '<article class="ss-card">' +
        (item.img ? picture(item.img, "items:" + i + ":img", item.title) : picture(ctx.poolImage, "items:" + i + ":img", item.title)) +
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
        '<div class="ss-grid">' + cardsOf(s, "items", 6, ctx.poolImage) + "</div></div></section>";
    }
    return '<section class="ss-sec g-menu v-list" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<ul class="ss-menu">' + rows + "</ul></div></section>";
  };

  BLOCKS.gallery = function (ctx) {
    var s = ctx.section;
    var cards = items(s).slice(0, 9).map(function (item, i) {
      return '<figure class="ss-card" style="padding:.6rem">' +
        picture(item.img || ctx.poolImage, "items:" + i + ":img", item.title || s.title) +
        (item.text ? '<figcaption style="margin-top:.5rem;font-size:.86rem;color:var(--muted)">' +
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
            picture(item.img || ctx.poolImage, "items:" + i + ":img", item.title, "ss-avatar") +
            "<div><h3" + ed("items:" + i + ":title") + ">" + esc(item.title) + "</h3>" +
            text(item.text || "", "items:" + i + ":text", "p") + "</div></div></div>";
        }).join("") + "</div></div></section>";
    }
    return '<section class="ss-sec g-team v-grid" ' + ctx.wrapAttrs + '>' +
      '<div class="ss-wrap"><h2' + ed("title") + ">" + esc(s.title || "") + "</h2>" +
      text(s.subtitle, "subtitle") +
      '<div class="ss-grid">' + cardsOf(s, "items", 6, ctx.poolImage) + "</div></div></section>";
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
          (item.img ? picture(item.img, "items:" + i + ":img", item.title) : picture(ctx.poolImage, "items:" + i + ":img", item.title)) +
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

  function navHTML(plan, pageId, spec) {
    var meta = plan.meta || {};
    var name = meta.siteName || "SiteSketch";
    var links = (plan.pages || []).map(function (p) {
      return '<a href="#' + esc(p.id) + '"' + (p.id === pageId ? ' aria-current="page" style="color:var(--text)"' : "") + ">" +
        esc(p.name) + "</a>";
    }).join("");
    var style = spec.nav || "bar";
    var cls = style === "outline" ? "ss-nav ss-nav--outline" : style === "minimal" ? "ss-nav ss-nav--minimal" : "ss-nav ss-nav--bar";
    return '<nav class="' + cls + '"><div class="ss-wrap ss-navrow">' +
      '<a class="ss-brand" href="#">' + esc(name) + "</a>" +
      '<div class="ss-navlinks">' + links + "</div></div></nav>";
  }

  function footerHTML(plan, spec) {
    var meta = plan.meta || {};
    var name = meta.siteName || "SiteSketch";
    var links = (plan.pages || []).map(function (p) { return '<a href="#' + esc(p.id) + '">' + esc(p.name) + "</a>"; }).join("");
    if (!spec.footer) {
      return '<footer class="ss-footer"><div class="ss-wrap" style="display:flex;justify-content:space-between;gap:1.5rem;flex-wrap:wrap">' +
        '<span class="ss-foot-note">' + esc(name) + "</span>" +
        '<span class="ss-foot-note">' + esc(name) + " · " + new Date().getFullYear() + "</span></div></footer>";
    }
    return '<footer class="ss-footer ss-footer--rich"><div class="ss-wrap">' +
      '<div class="ss-foot-col"><a class="ss-brand" href="#">' + esc(name) + "</a>" +
        '<p class="ss-foot-note" style="margin-top:.6rem">Made with SiteSketch.</p></div>' +
      '<div class="ss-foot-col"><h3>Pages</h3><div class="ss-foot-links">' + links + "</div></div>" +
      '<div class="ss-foot-col"><h3>Contact</h3><div class="ss-foot-links">' +
        '<a href="#">Email us</a><a href="#">Instagram</a><a href="#">Facebook</a></div></div>' +
      "</div></footer>";
  }

  function sectionHTML(section, index, plan, spec, editable) {
    var block = BLOCKS[section.type] || BLOCKS.about;
    var variant = variantOf(plan, section, spec);
    var image = imgOf(plan, section, spec, "img");
    var pools = window.DESIGN ? DESIGN.TYPE_IMAGES[(plan.meta || {}).type] || DESIGN.TYPE_IMAGES.business : [];
    var poolKey = pools.length ? pools[index % pools.length] : null;
    var poolImage = window.DESIGN ? ((DESIGN.IMAGES[poolKey] || [])[index % 3] || "") : "";

    var ctx = {
      section: section,
      index: index,
      variant: variant,
      image: image,
      imageTag: picture(image, "img", section.title),
      poolImage: poolImage,
      wrapAttrs: ' data-sect="' + esc(section.id) + '" data-sect-label="' + esc(section.type) + '"',
      editable: !!editable,
    };

    if (section.align === "center") ctx.wrapAttrs += ' style="text-align:center"';
    var html = block(ctx);
    if (!editable) return html;

    /* the block grip (drag handle + hover affordance), inserted just inside
       the opening tag. Only ever rendered in the editor, never on a
       published page. */
    var grip = '<span class="sec-grip" aria-hidden="true"><i class="bi bi-grip-vertical"></i></span>';
    return html.replace(/^<section\b[^>]*>/, function (tag) { return tag + grip; });
  }

  /* options: { editable, live } */
  SS.renderPage = function (plan, pageId, options) {
    options = options || {};
    var spec = SS.specFor(plan);
    ensureFonts(spec);
    var page = (plan.pages || []).filter(function (p) { return p.id === pageId; })[0] || plan.pages[0];
    if (!page) return "";

    var body = (page.sections || []).map(function (section, i) {
      var style = "";
      if (section.style) {
        style = ' style="' + Object.keys(section.style).map(function (k) {
          return k + ":" + section.style[k];
        }).join(";") + '"';
      }
      var html = sectionHTML(section, i, plan, spec, options.editable);
      return style ? html.replace(' data-sect="', style + ' data-sect="') : html;
    }).join("\n");

    var cls = "ss-site" + (options.editable ? " is-editing" : "") + (options.live ? " is-live" : "");
    var cssVars = window.DESIGN ? DESIGN.cssVars(spec) : "";

    return '<div class="' + cls + '" style="' + cssVars + '">' +
      navHTML(plan, page.id, spec) +
      '<main data-reveal>' + body + "</main>" +
      footerHTML(plan, spec) +
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

  window.SS = SS;
})();