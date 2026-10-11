/* ============================================================
   editorui.js - the panels around the page editor.

   EditorUI owns the things that are not the page itself:
     * the media picker (curated library + your own uploads)
     * the Styles panel (colours, typography, layout)
     * adding a section to the page
   ============================================================ */
(function () {
  "use strict";

  var SS = window.SS || (window.SS = {});
  var EditorUI = {};

  /* ------------------------------------------------------------------ media */

  var mediaState = { sectionId: null, slot: "img", uploads: [] };

  function buildMediaModal() {
    var host = document.getElementById("mediaHost") || (function () {
      var h = document.createElement("div");
      h.id = "mediaHost";
      document.body.appendChild(h);
      return h;
    })();

    host.innerHTML =
      '<div class="modal" id="mediaModal" hidden role="dialog" aria-modal="true" aria-labelledby="mediaTitle">' +
        '<div class="modal-card">' +
          '<header class="modal-head"><h2 id="mediaTitle">Choose an image</h2>' +
          '<button class="icon-btn" data-close aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>' +
          '<div class="modal-body">' +
            '<div class="media-tabs" role="tablist">' +
              '<button class="chip is-on" data-tab="library" role="tab">Library</button>' +
              '<button class="chip" data-tab="yours" role="tab">Your uploads</button>' +
              '<label class="chip chip--upload" tabindex="0">' +
                '<i class="bi bi-upload" aria-hidden="true"></i> Upload an image' +
                '<input type="file" id="mediaFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>' +
              "</label>" +
            "</div>" +
            '<div class="media-grid" id="mediaGrid"></div>' +
            '<p class="hint" id="mediaHint">JPG, PNG, WebP or GIF, up to 6 MB.</p>' +
          "</div>" +
        "</div>" +
      "</div>";

    var modal = host.querySelector("#mediaModal");
    modal.addEventListener("click", function (event) {
      if (event.target === modal || event.target.closest("[data-close]")) closeMedia();
    });

    host.querySelectorAll("[data-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        host.querySelectorAll("[data-tab]").forEach(function (t) { t.classList.toggle("is-on", t === tab); });
        paintMediaGrid(tab.dataset.tab);
      });
    });

    var input = host.querySelector("#mediaFile");
    var label = input.closest(".chip");
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) uploadFile(input.files[0]);
    });
    label.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !modal.hidden) closeMedia();
    });

    return host;
  }

  function openMedia(sectionId, slot) {
    mediaState.sectionId = sectionId;
    mediaState.slot = slot || "img";
    buildMediaModal();
    var modal = document.getElementById("mediaModal");
    modal.hidden = false;
    paintMediaGrid("library");
    loadUploads();
  }

  function closeMedia() {
    var modal = document.getElementById("mediaModal");
    if (modal) modal.hidden = true;
  }
  EditorUI.openMedia = openMedia;
  EditorUI.closeMedia = closeMedia;

  function pick(url) {
    window.Editor.setImage(mediaState.sectionId, mediaState.slot, url);
    /* setImage only writes the plan; the page needs repainting to show it */
    window.Editor.render();
    window.Editor.select(mediaState.sectionId);
    closeMedia();
    SS.toast("Image updated", "bi-image");
  }

  function tile(url, label) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "media-tile";
    button.innerHTML = '<img src="' + SS.esc(url) + '" alt="' + SS.esc(label || "") + '" loading="lazy">' +
      (label ? "<span>" + SS.esc(label) + "</span>" : "");
    button.addEventListener("click", function () { pick(url); });
    return button;
  }

  function paintMediaGrid(tab) {
    var grid = document.getElementById("mediaGrid");
    if (!grid) return;
    grid.innerHTML = "";

    if (tab === "yours") {
      if (!mediaState.uploads.length) {
        grid.innerHTML = '<p class="hint">No uploads yet. Use <strong>Upload an image</strong> above.</p>';
        return;
      }
      mediaState.uploads.forEach(function (item) { grid.appendChild(tile(item.url, item.name)); });
      return;
    }

    var pools = window.DESIGN ? DESIGN.TYPE_IMAGES.business : [];
    pools.concat(["food", "store", "people", "nature", "place", "work"]).forEach(function (pool) {
      (DESIGN.IMAGES[pool] || []).forEach(function (url) { grid.appendChild(tile(url, pool)); });
    });
  }

  function loadUploads() {
    fetch("/api/media", { headers: { Authorization: "Bearer " + localStorage.getItem("sitesketch_token_v1") } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        mediaState.uploads = list || [];
        var tab = document.querySelector('[data-tab="yours"]');
        if (tab && tab.classList.contains("is-on")) paintMediaGrid("yours");
      })
      .catch(function () { /* offline: library tab still works */ });
  }

  function uploadFile(file) {
    var hint = document.getElementById("mediaHint");
    hint.textContent = "Uploading…";
    var form = new FormData();
    form.append("file", file);

    fetch("/api/media", {
      method: "POST",
      headers: { Authorization: "Bearer " + localStorage.getItem("sitesketch_token_v1") },
      body: form
    })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (result) {
        if (!result.ok) {
          hint.textContent = result.body.error || "Upload failed.";
          return;
        }
        mediaState.uploads.unshift({ url: result.body.url, name: result.body.name });
        hint.textContent = "Uploaded. Pick it below.";
        var yours = document.querySelector('[data-tab="yours"]');
        if (yours) yours.click();
        else paintMediaGrid("yours");
      })
      .catch(function () { hint.textContent = "Upload failed. Check your connection."; });
  }

  /* ------------------------------------------------------------------ starters */

  /* A section with no items renders as a bare heading, which reads as a
     broken page. Every list-based block starts with a few editable
     placeholders the user overwrites. */
  var STARTERS = {
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

  EditorUI.startersFor = function (typeKey) {
    var list = STARTERS[typeKey] || [];
    return JSON.parse(JSON.stringify(list));
  };

  /* ----------------------------------------------------------------- styles */

  /* ------------------------------------------------------- block settings */

  /* The WordPress "block settings" sidebar: everything you can change
     about one section, without leaving the page. Values live in
     section.style and are written as --sec-* custom properties. */
  EditorUI.blockPanel = function (host) {
    var Editor = window.Editor;
    var section = Editor.currentSection();
    host.hidden = false;

    if (!section) {
      host.innerHTML =
        '<div class="panel-empty">' +
          '<i class="bi bi-cursor" aria-hidden="true"></i>' +
          "<p>Click any section on the page to change its layout, colours and spacing.</p>" +
        "</div>";
      return;
    }

    var def = API.SECTIONS[section.type] || { name: section.type };
    var style = section.style || {};
    var spec = Editor.spec();
    var variants = (window.DESIGN ? DESIGN.VARIANTS[section.type] : []) || [];

    function refresh() {
      EditorUI.blockPanel(host);
    }
    function set(key, value) {
      var s = Editor.currentSection();
      if (!s) return;
      s.style = s.style || {};
      if (value === null || value === "" || value === undefined) delete s.style[key];
      else s.style[key] = value;
      Editor.render();
      if (Editor.onChange) Editor.onChange("style:" + key);
    }

    var padTop = style.padTop !== undefined ? String(style.padTop) : "";
    var padBottom = style.padBottom !== undefined ? String(style.padBottom) : "";

    host.innerHTML =
      '<div class="panel-section">' +
        '<h3>' + SS.esc(def.name) + " settings</h3>" +
        '<p class="palette-current" id="blockTypeLabel">' + SS.esc(section.title || def.name) + "</p>" +

        '<label class="field"><span>Layout</span>' +
          '<select id="blockVariant">' +
            (variants.length ? variants.map(function (v) {
              var isOn = DESIGN.variantFor(spec, section) === v.n;
              return '<option value="' + v.n + '"' + (isOn ? " selected" : "") + ">" +
                SS.esc(v.n.charAt(0).toUpperCase() + v.n.slice(1)) + "</option>";
            }).join("") : '<option>Default</option>') +
          "</select></label>" +

        '<label class="field"><span>Text alignment</span>' +
          '<select id="blockAlign">' +
            ["", "left", "center", "right"].map(function (a) {
              return '<option value="' + a + '"' + ((style.align || "") === a ? " selected" : "") + ">" +
                (a === "" ? "Default" : a.charAt(0).toUpperCase() + a.slice(1)) + "</option>";
            }).join("") +
          "</select></label>" +
      "</div>" +

      '<div class="panel-section">' +
        "<h3>Colours</h3>" +
        '<label class="field"><span>Background</span>' +
          '<span class="colour-row">' +
            '<input type="color" id="blockBg" value="' + SS.esc(normHex(style.bg) || paletteColor(spec, "bg")) + '">' +
            '<button type="button" class="btn btn-sm" data-clear="bg">Use theme</button>' +
          "</span></label>" +
        '<label class="field"><span>Text</span>' +
          '<span class="colour-row">' +
            '<input type="color" id="blockText" value="' + SS.esc(normHex(style.textColor) || paletteColor(spec, "text")) + '">' +
            '<button type="button" class="btn btn-sm" data-clear="textColor">Use theme</button>' +
          "</span></label>" +
        '<label class="field"><span>Accent</span>' +
          '<span class="colour-row">' +
            '<input type="color" id="blockAccent" value="' + SS.esc(normHex(style.accent) || paletteColor(spec, "accent")) + '">' +
            '<button type="button" class="btn btn-sm" data-clear="accent">Use theme</button>' +
          "</span></label>" +
      "</div>" +

      '<div class="panel-section">' +
        "<h3>Spacing and shape</h3>" +
        '<label class="field"><span>Space above</span>' +
          '<input type="range" id="blockPadTop" min="0" max="160" step="4" value="' +
            (padTop ? parseInt(padTop, 10) : 0) + '">' +
          '<output id="padTopOut">' + (padTop || "Theme default") + "</output></label>" +
        '<label class="field"><span>Space below</span>' +
          '<input type="range" id="blockPadBottom" min="0" max="160" step="4" value="' +
            (padBottom ? parseInt(padBottom, 10) : 0) + '">' +
          '<output id="padBottomOut">' + (padBottom || "Theme default") + "</output></label>" +
        '<label class="field"><span>Corner style</span>' +
          '<select id="blockRadius">' +
            ["", "0px", "10px", "18px", "999px"].map(function (r) {
              return '<option value="' + r + '"' + ((style.radius || "") === r ? " selected" : "") + ">" +
                (r === "" ? "Theme default" : r === "999px" ? "Pill" : r === "0px" ? "Square" : r) + "</option>";
            }).join("") +
          "</select></label>" +
      "</div>" +

      '<div class="panel-section">' +
        '<button type="button" class="btn btn-block" id="blockReset">Reset this section</button>' +
        '<button type="button" class="btn btn-block" id="blockToggle">' +
          (section.hidden ? "Show this section" : "Hide this section") + "</button>" +
      "</div>";

    var variantPick = host.querySelector("#blockVariant");
    if (variantPick && variants.length) {
      variantPick.addEventListener("change", function () {
        var s = Editor.currentSection();
        if (!s) return;
        if (window.DESIGN) {
          spec.sections = spec.sections || {};
          spec.sections[s.id] = spec.sections[s.id] || {};
          spec.sections[s.id].variant = this.value;
        }
        Editor.render();
        if (Editor.onChange) Editor.onChange("layout");
      });
    }

    host.querySelector("#blockAlign").addEventListener("change", function () {
      set("align", this.value || null);
    });
    host.querySelector("#blockBg").addEventListener("input", function () { set("bg", this.value); });
    host.querySelector("#blockText").addEventListener("input", function () { set("textColor", this.value); });
    host.querySelector("#blockAccent").addEventListener("input", function () { set("accent", this.value); });
    host.querySelector("#blockRadius").addEventListener("change", function () { set("radius", this.value || null); });

    host.querySelectorAll("[data-clear]").forEach(function (button) {
      button.addEventListener("click", function () {
        set(button.getAttribute("data-clear"), null);
        refresh();
      });
    });

    /* sliders only write once the drag ends, so we do not save on every pixel */
    function wireSlider(id, key, outId) {
      var slider = host.querySelector(id);
      var out = host.querySelector(outId);
      if (!slider) return;
      slider.addEventListener("input", function () {
        var v = parseInt(this.value, 10);
        out.textContent = v === 0 ? "Theme default" : v + "px";
      });
      slider.addEventListener("change", function () {
        var v = parseInt(this.value, 10);
        set(key, v === 0 ? null : v + "px");
        refresh();
      });
    }
    wireSlider("#blockPadTop", "padTop", "#padTopOut");
    wireSlider("#blockPadBottom", "padBottom", "#padBottomOut");

    host.querySelector("#blockReset").addEventListener("click", function () {
      var s = Editor.currentSection();
      if (!s) return;
      s.style = {};
      if (window.DESIGN && spec.sections && spec.sections[s.id]) delete spec.sections[s.id].variant;
      Editor.render();
      if (Editor.onChange) Editor.onChange("style:reset");
      refresh();
      SS.toast("Section reset", "bi-arrow-counterclockwise");
    });

    host.querySelector("#blockToggle").addEventListener("click", function () {
      var s = Editor.currentSection();
      if (!s) return;
      s.hidden = !s.hidden;
      Editor.render();
      if (Editor.onChange) Editor.onChange("hidden");
      refresh();
    });
  };

  function normHex(value) {
    return value && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
  }
  function paletteColor(spec, key) {
    var c = window.DESIGN ? DESIGN.resolvePalette(spec) : null;
    return (c && c[key]) || "#000000";
  }

  function paletteSwatches(plan, onPick) {
    var list = document.createElement("div");
    list.className = "swatch-list";
    (window.DESIGN ? DESIGN.PALETTES : []).forEach(function (palette) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.title = palette.name + " (" + palette.mode + ")";
      button.style.background = "linear-gradient(135deg, " + palette.c.bg + " 0 50%, " + palette.c.accent + " 50% 100%)";
      button.setAttribute("aria-label", palette.name);
      var spec = window.Editor ? window.Editor.spec() : null;
      if (spec && spec.tokens.palette === palette.id) button.classList.add("is-on");
      button.addEventListener("click", function () {
        window.Editor.setToken("palette", palette.id);
        list.querySelectorAll(".swatch").forEach(function (b) { b.classList.remove("is-on"); });
        button.classList.add("is-on");
        onPick();
      });
      list.appendChild(button);
    });
    return list;
  }

  EditorUI.stylesPanel = function (host) {
    var plan = window.Editor.plan;
    var spec = window.Editor.spec();
    var refresh = function () { window.Editor.render(); };

    host.innerHTML =
      '<div class="panel-section">' +
        '<h3>Colours</h3>' +
        '<div class="palette-current" id="paletteName"></div>' +
        '<div id="swatchHost"></div>' +
      "</div>" +
      '<div class="panel-section">' +
        "<h3>Typography</h3>" +
        '<label class="field"><span>Font pairing</span>' +
          '<select id="fontPick">' +
            (window.DESIGN ? DESIGN.FONTS : []).map(function (font) {
              return '<option value="' + font.id + '"' + (font.id === spec.tokens.font ? " selected" : "") + ">" +
                SS.esc(font.name) + "</option>";
            }).join("") +
          "</select></label>" +
      "</div>" +
      '<div class="panel-section">' +
        "<h3>Layout</h3>" +
        '<label class="field"><span>Corner style</span><select id="radiusPick">' +
          (window.DESIGN ? DESIGN.RADII : ["8px"]).map(function (r) {
            return '<option value="' + r + '"' + (r === spec.tokens.radius ? " selected" : "") + ">" +
              (r === "999px" ? "Pill" : r === "0px" ? "Square" : "Soft " + r) + "</option>";
          }).join("") +
        "</select></label>" +
        '<label class="field"><span>Spacing</span><select id="spacePick">' +
          ["compact", "comfy", "airy"].map(function (s) {
            return '<option value="' + s + '"' + (s === spec.tokens.space ? " selected" : "") + ">" +
              (s[0].toUpperCase() + s.slice(1)) + "</option>";
          }).join("") +
        "</select></label>" +
        '<label class="field"><span>Shadow</span><select id="shadowPick">' +
          ["flat", "soft", "crisp"].map(function (s) {
            return '<option value="' + s + '"' + (s === spec.tokens.shadow ? " selected" : "") + ">" +
              (s[0].toUpperCase() + s.slice(1)) + "</option>";
          }).join("") +
        "</select></label>" +
      "</div>" +
      '<div class="panel-section">' +
        '<button class="btn btn-block" id="redesignBtn">' +
          '<i class="bi bi-stars" aria-hidden="true"></i> Try a new design</button>' +
        '<p class="hint">Generates a fresh palette, fonts and layouts without touching your text.</p>' +
      "</div>";

    var paletteName = host.querySelector("#paletteName");
    var current = window.DESIGN ? DESIGN.paletteById(spec.tokens.palette) : null;
    if (paletteName && current) paletteName.textContent = current.name;

    host.querySelector("#swatchHost").appendChild(paletteSwatches(plan, refresh));

    host.querySelector("#fontPick").addEventListener("change", function () {
      window.Editor.setToken("font", this.value); refresh();
    });
    host.querySelector("#radiusPick").addEventListener("change", function () {
      window.Editor.setToken("radius", this.value); refresh();
    });
    host.querySelector("#spacePick").addEventListener("change", function () {
      window.Editor.setToken("space", this.value);
      if (window.DESIGN) window.Editor.spec().spaceUnit = DESIGN.SPACES[this.value];
      refresh();
    });
    host.querySelector("#shadowPick").addEventListener("change", function () {
      window.Editor.setToken("shadow", this.value); refresh();
    });
    host.querySelector("#redesignBtn").addEventListener("click", function () {
      var button = this;
      button.disabled = true;
      button.innerHTML = '<i class="bi bi-arrow-repeat spin" aria-hidden="true"></i> Designing…';
      var planNow = window.Editor.plan;
      var sections = planNow.pages
        .filter(function (p) { return p.id === window.Editor.pageId; })[0].sections;
      API.generateDesign({
        siteName: planNow.meta.siteName,
        type: planNow.meta.type,
        goal: planNow.meta.goal,
        sections: sections.map(function (s) { return { id: s.id, type: s.type, title: s.title }; })
      }).then(function (result) {
        button.disabled = false;
        button.innerHTML = '<i class="bi bi-stars" aria-hidden="true"></i> Try a new design';
        if (!result.ok) { SS.toast(result.error || "Could not design that", "bi-exclamation-triangle"); return; }
        window.Editor.redesign(result.spec);
        SS.toast("New design: " + result.spec.name, "bi-stars");
      });
    });
  };

  /* ------------------------------------------------------------ add section */

  EditorUI.addSection = function (typeKey) {
    var plan = window.Editor.plan;
    var page = plan.pages.filter(function (p) { return p.id === window.Editor.pageId; })[0];
    if (!page) return;
    var def = API.SECTIONS[typeKey] || { name: typeKey, blurb: "" };
    var section = {
      id: "s_" + Math.random().toString(36).slice(2, 9),
      type: typeKey,
      title: def.name,
      subtitle: def.blurb,
      fields: {},
      items: EditorUI.startersFor(typeKey)
    };
    page.sections.push(section);
    window.Editor.selectedId = section.id;
    if (window.Editor.onChange) window.Editor.onChange("structure");
    SS.toast(def.name + " added", "bi-plus-circle");
  };

  window.EditorUI = EditorUI;
})();