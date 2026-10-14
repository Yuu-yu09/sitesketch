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

  EditorUI.startersFor = function (typeKey) {
    var list = STARTERS[typeKey] || [];
    return JSON.parse(JSON.stringify(list));
  };

  /* ----------------------------------------------------------------- styles */

  /* -------------------------------------------------- background decoration */

  /* Free-form shapes the owner places on the wall itself: behind the
     photographs or in front of them, any size, any colour, any position.
     Nothing here is a preset layout, it is a set of parts to arrange. */
  function decorPanel(section) {
    var list = Array.isArray(section.decor) ? section.decor : [];

    var rows = list.map(function (d, i) {
      var shape = (window.SS.PHOTO_SHAPES || []).indexOf(d.shape) === -1 ? "circle" : d.shape;
      return '<div class="decor-row" data-decor-row="' + i + '">' +
        '<div class="decor-head">' +
          '<strong>' + SS.esc((window.SS.PHOTO_SHAPE_LABEL || {})[shape] || shape) + "</strong>" +
          '<span class="decor-layer">' +
            '<button type="button" class="chip' + (d.layer === "over" ? " is-on" : "") +
              '" data-decor-layer="' + i + '" aria-pressed="' + (d.layer === "over") + '">' +
              (d.layer === "over" ? "In front" : "Behind") + "</button>" +
          "</span>" +
          '<button type="button" class="icon-btn" data-decor-del="' + i + '" ' +
            'aria-label="Remove this shape"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
        "</div>" +
        '<div class="colour-row">' +
          '<input type="color" data-decor-color="' + i + '" value="' +
            SS.esc(normHex(d.color) || "#16283c") + '" aria-label="Shape colour">' +
          '<select data-decor-shape="' + i + '" aria-label="Shape">' +
            (window.SS.PHOTO_SHAPES || []).map(function (key) {
              return '<option value="' + key + '"' + (key === shape ? " selected" : "") + ">" +
                SS.esc((window.SS.PHOTO_SHAPE_LABEL || {})[key] || key) + "</option>";
            }).join("") +
          "</select>" +
        "</div>" +
        decorSliders(i, d) +
        "</div>";
    }).join("");

    return '<div class="panel-section">' +
      "<h3>Background shapes</h3>" +
      (list.length
        ? '<div class="decor-list">' + rows + "</div>"
        : '<p class="hint">Add shapes to sit behind or in front of your photos.</p>') +
      '<button type="button" class="btn btn-block" id="decorAdd">' +
        '<i class="bi bi-plus-lg" aria-hidden="true"></i> Add a shape</button>' +
      "</div>";
  }

  function decorSliders(i, d) {
    function slider(key, label, min, max, step, fallback, suffix) {
      return '<label class="field"><span>' + label + "</span>" +
        '<input type="range" data-decor-prop="' + key + '" data-decor-at="' + i + '" ' +
          'min="' + min + '" max="' + max + '" step="' + step + '" value="' +
          (d[key] === undefined ? fallback : d[key]) + '">' +
        '<output data-decor-out="' + key + '">' +
          (d[key] === undefined ? fallback : d[key]) + (suffix || "") + "</output></label>";
    }
    return '<div class="decor-sliders">' +
      slider("x", "Across", -40, 140, 1, 0, "%") +
      slider("y", "Down", -60, 160, 1, 0, "%") +
      slider("w", "Width", 1, 200, 1, 30, "%") +
      slider("h", "Height", 1, 200, 1, 30, "%") +
      slider("opacity", "Strength", 5, 100, 1, 100, "%") +
      slider("rotate", "Turn", -180, 180, 1, 0, "°") +
      "</div>";
  }

  /* wires every decoration control; called after the panel is rebuilt */
  EditorUI.wireDecor = function (host, section) {
    var Editor = window.Editor;

    function setAt(i, patch) {
      var d = section.decor[i];
      if (!d) return;
      Object.keys(patch).forEach(function (k) { d[k] = patch[k]; });
      Editor.render();
      Editor.wireWall();
      if (Editor.onChange) Editor.onChange("decor");
    }

    host.querySelectorAll("[data-decor-at]").forEach(function (input) {
      var i = parseInt(input.getAttribute("data-decor-at"), 10);
      var key = input.getAttribute("data-decor-prop");
      var out = host.querySelector('[data-decor-out="' + key + '"]');
      input.addEventListener("input", function () { if (out) out.textContent = this.value; });
      input.addEventListener("change", function () {
        var v = parseFloat(this.value);
        var patch = {};
        patch[key] = key === "opacity" ? v / 100 : v;
        setAt(i, patch);
      });
    });

    host.querySelectorAll("[data-decor-color]").forEach(function (input) {
      input.addEventListener("input", function () {
        setAt(parseInt(input.getAttribute("data-decor-color"), 10), { color: input.value });
      });
    });

    host.querySelectorAll("[data-decor-shape]").forEach(function (select) {
      select.addEventListener("change", function () {
        setAt(parseInt(select.getAttribute("data-decor-shape"), 10), { shape: select.value });
      });
    });

    host.querySelectorAll("[data-decor-layer]").forEach(function (button) {
      button.addEventListener("click", function () {
        var i = parseInt(button.getAttribute("data-decor-layer"), 10);
        var d = section.decor[i];
        if (d) setAt(i, { layer: d.layer === "over" ? "under" : "over" });
      });
    });

    host.querySelectorAll("[data-decor-del]").forEach(function (button) {
      button.addEventListener("click", function () {
        section.decor.splice(parseInt(button.getAttribute("data-decor-del"), 10), 1);
        Editor.render();
        Editor.wireWall();
        if (Editor.onChange) Editor.onChange("decor");
        EditorUI.blockPanel(host);
      });
    });

    var add = host.querySelector("#decorAdd");
    if (add) {
      add.addEventListener("click", function () {
        section.decor = Array.isArray(section.decor) ? section.decor : [];
        section.decor.push({
          shape: "circle", color: "#16283c", x: 6, y: 8, w: 34, h: 34,
          layer: "under", opacity: 1, rotate: 0
        });
        Editor.render();
        Editor.wireWall();
        if (Editor.onChange) Editor.onChange("decor");
        EditorUI.blockPanel(host);
      });
    }
  };

/* ------------------------------------------------------- photo settings */

  /* Shape and frame for one picture. Crop lives on the image itself
     (double click a picture, or the crop button), so this panel handles
     everything around it: how the picture is shaped and how it is framed. */
  EditorUI.photoPanel = function (host, sectionId, index) {
    var Editor = window.Editor;
    host.hidden = false;

    var section = Editor.wallSection(sectionId);
    var item = section && section.items ? section.items[index] : null;
    if (!item) {
      host.innerHTML = '<div class="panel-empty">' +
        '<i class="bi bi-image" aria-hidden="true"></i>' +
        "<p>That photo is gone. Pick one on the page.</p></div>";
      return;
    }

    function refresh() { EditorUI.photoPanel(host, sectionId, index); }
    function set(key, value) {
      if (value === null || value === "") delete item[key];
      else item[key] = value;
      Editor.render();
      Editor.wireWall();
      if (Editor.onChange) Editor.onChange("photo:" + key);
    }

    var shape = (window.SS.PHOTO_SHAPES || []).indexOf(item.shape) === -1 ? "rect" : item.shape;
    var frame = item.frame || {};

    var shapeButtons = (window.SS.PHOTO_SHAPES || []).map(function (key) {
      var label = window.SS.PHOTO_SHAPE_LABEL[key] || key;
      return '<button type="button" class="shape-btn' + (key === shape ? " is-on" : "") + '" ' +
        'data-shape-set="' + key + '" aria-pressed="' + (key === shape) + '">' +
        '<span class="shape-preview shape-preview--' + key + '" aria-hidden="true"></span>' +
        SS.esc(label) + "</button>";
    }).join("");

    host.innerHTML =
      '<div class="panel-section">' +
        "<h3>Photo " + (index + 1) + "</h3>" +
        '<div class="photo-preview">' +
          (item.img
            ? '<img src="' + SS.esc(item.img) + '" alt="">'
            : '<span class="hint">No picture chosen yet</span>') +
        "</div>" +
        '<div class="photo-actions">' +
          '<button type="button" class="btn btn-sm" id="photoPick">' +
            '<i class="bi bi-image" aria-hidden="true"></i> Picture</button>' +
          '<button type="button" class="btn btn-sm" id="photoCrop">' +
            '<i class="bi bi-crop" aria-hidden="true"></i> Crop</button>' +
        "</div>" +
        '<p class="hint">Crop trims the picture. Shape changes how it is cut out.</p>' +
      "</div>" +

      '<div class="panel-section">' +
        "<h3>Shape</h3>" +
        '<div class="shape-grid">' + shapeButtons + "</div>" +
        (shape === "rounded"
          ? '<label class="field"><span>Corner roundness</span>' +
            '<input type="range" id="shapeRadius" min="0" max="120" step="2" value="' +
              parseInt(item.radius || "28px", 10) + '">' +
            '<output id="radiusOut">' + SS.esc(item.radius || "28px") + "</output></label>"
          : "") +
      "</div>" +

      '<div class="panel-section">' +
        "<h3>Frame</h3>" +
        '<label class="field"><span>Frame width</span>' +
          '<input type="range" id="frameWidth" min="0" max="24" step="1" value="' +
            parseInt(frame.width || "0px", 10) + '">' +
          '<output id="frameWidthOut">' + SS.esc(frame.width || "none") + "</output></label>" +
        '<label class="field"><span>Frame colour</span>' +
          '<span class="colour-row">' +
            '<input type="color" id="frameColor" value="' + SS.esc(normHex(frame.color) || "#16283c") + '">' +
            '<button type="button" class="btn btn-sm" id="frameColorClear">None</button>' +
          "</span></label>" +
        '<label class="field"><span>Frame style</span>' +
          '<select id="frameStyle">' +
            (window.SS.PHOTO_FRAME_STYLES || ["solid"]).map(function (f) {
              return '<option value="' + f + '"' + ((frame.style || "solid") === f ? " selected" : "") + ">" +
                f.charAt(0).toUpperCase() + f.slice(1) + "</option>";
            }).join("") +
          "</select></label>" +
        '<label class="field"><span>Inset spacing</span>' +
          '<input type="range" id="framePad" min="0" max="32" step="1" value="' +
            parseInt(frame.padding || "0px", 10) + '">' +
          '<output id="framePadOut">' + SS.esc(frame.padding || "0px") + "</output></label>" +
        '<label class="field"><span>Drop shadow</span>' +
          '<select id="frameShadow">' +
            [["none", "None"], ["soft", "Soft"], ["hard", "Hard offset"]].map(function (p) {
              return '<option value="' + p[0] + '"' + ((frame.shadow || "none") === p[0] ? " selected" : "") + ">" +
                p[1] + "</option>";
            }).join("") +
          "</select></label>" +
      "</div>" +

      '<div class="panel-section">' +
        '<button type="button" class="btn btn-block" id="photoReset">Reset shape and frame</button>' +
      "</div>";

    host.querySelectorAll("[data-shape-set]").forEach(function (button) {
      button.addEventListener("click", function () {
        set("shape", button.getAttribute("data-shape-set") === "rect" ? null : button.getAttribute("data-shape-set"));
        refresh();
      });
    });

    var radius = host.querySelector("#shapeRadius");
    if (radius) {
      var radiusOut = host.querySelector("#radiusOut");
      radius.addEventListener("input", function () { radiusOut.textContent = this.value + "px"; });
      radius.addEventListener("change", function () { set("radius", this.value + "px"); });
    }

    /* frame values live in item.frame, one object per photo */
    function setFrame(key, value) {
      item.frame = item.frame || {};
      if (value === null || value === "") delete item.frame[key];
      else item.frame[key] = value;
      Editor.render();
      Editor.wireWall();
      if (Editor.onChange) Editor.onChange("photo:frame");
    }

    var fw = host.querySelector("#frameWidth");
    var fwOut = host.querySelector("#frameWidthOut");
    fw.addEventListener("input", function () { fwOut.textContent = this.value === "0" ? "none" : this.value + "px"; });
    fw.addEventListener("change", function () { setFrame("width", this.value === "0" ? null : this.value + "px"); });

    var fp = host.querySelector("#framePad");
    var fpOut = host.querySelector("#framePadOut");
    fp.addEventListener("input", function () { fpOut.textContent = this.value + "px"; });
    fp.addEventListener("change", function () { setFrame("padding", this.value + "px"); });

    host.querySelector("#frameColor").addEventListener("input", function () { setFrame("color", this.value); });
    host.querySelector("#frameColorClear").addEventListener("click", function () { setFrame("color", null); refresh(); });
    host.querySelector("#frameStyle").addEventListener("change", function () { setFrame("style", this.value); });
    host.querySelector("#frameShadow").addEventListener("change", function () {
      setFrame("shadow", this.value === "none" ? null : this.value);
    });

    host.querySelector("#photoPick").addEventListener("click", function () {
      EditorUI.openMedia(sectionId, "items:" + index + ":img");
    });
    host.querySelector("#photoCrop").addEventListener("click", function () {
      var src = item.img || Editor.imageFor(sectionId, "items:" + index + ":img");
      if (!src) { SS.toast("Choose a picture first", "bi-image"); return; }
      if (window.Crop) {
        Crop.open({
          sectionId: sectionId,
          slot: "items:" + index + ":img",
          src: src,
          crop: Editor.cropFor(sectionId, "items:" + index + ":img")
        });
      }
    });

    host.querySelector("#photoReset").addEventListener("click", function () {
      delete item.shape;
      delete item.radius;
      delete item.frame;
      Editor.render();
      Editor.wireWall();
      if (Editor.onChange) Editor.onChange("photo:reset");
      refresh();
    });
  };

  /* --------------------------------------------------------------- footer */

  /* Editing the footer is the same idea as editing a block: click the
     text and type. Social link URLs cannot be typed inline, so they get
     real inputs here. */
  /* The menu, edited as its own list rather than derived from the pages.

     Rename, reorder, hide, and nest one level. That is the whole set: a
     second level of nesting is where menus start becoming unmaintainable,
     and nobody's small business site needs it.

     An empty label means "use the page's own name", so renaming a page in
     the rail still updates the menu without anyone touching this panel. */
EditorUI.menuPanel = function (host) {
    var Editor = window.Editor;
    var plan = Editor.plan;
    var SSr = window.SS;

    /* The menu as a writable list, read fresh from the plan.

       Handlers used to close over an `items` array captured when the panel
       was built. The panel is rebuilt on every structural edit, and each
       rebuild added another set of listeners to the same persistent host
       element, so they accumulated: measured at 47 full page re-renders for
       a single keystroke after four edits. The saved menu still came out
       right, because the newest closure wrote last, which is exactly why it
       would have survived being looked at.

       Reading the list at event time instead means a stale closure cannot
       hold stale data, and the listeners below are installed once. */
    function items() {
      return SSr.navItems(plan).map(function (i) {
        return {
          pageId: i.pageId, label: i.label, visible: i.visible,
          /* sectionId has to survive the round trip for the same reason href
             does: navItems rebuilds each entry, and a panel that dropped it
             would quietly turn every section link back into a page link the
             moment you renamed something else. */
          sectionId: i.sectionId || "",
          /* href has to survive the round trip. It did not at first, and
             the symptom was odd enough to be worth writing down: the canvas
             navigation showed every custom link correctly, while the panel
             showed fewer rows than the menu had, and adding one more link
             left almost nothing. navItems drops any entry without a usable
             href, so every custom link was being deleted by the panel's own
             next read of the list. */
          href: i.href || "",
          children: (i.children || []).map(function (c) {
            return { pageId: c.pageId, label: c.label, href: c.href || "",
                     sectionId: c.sectionId || "" };
          })
        };
      });
    }

    /* Write the full menu back, so a page that was never in it stays out. */
    function write(list) {
      plan.nav = list;
      Editor.render();
      if (Editor.onChange) Editor.onChange("nav");
    }

    /* Structural changes rebuild the panel; typing does not.
       commit() re-rendering the list would pull focus out of the input on
       every keystroke, which makes the field unusable. write() persists
       without touching the panel. */
    function commit(list) {
      write(list);
      EditorUI.menuPanel(host);
    }

    var built = items();
    var pages = plan.pages || [];

    function pageName(id) {
      var p = pages.filter(function (x) { return x.id === id; })[0];
      return p ? p.name : "(deleted page)";
    }

    /* Pages not yet in the menu, so they can be added. */
    var inMenu = {};
    built.forEach(function (i) {
      inMenu[i.pageId] = true;
      (i.children || []).forEach(function (c) { inMenu[c.pageId] = true; });
    });
    var spare = pages.filter(function (p) { return !inMenu[p.id]; });

    /* Every section on the current page, minus those already in the menu. */
    var currentPage = pages.filter(function (p) { return p.id === Editor.pageId; })[0] || pages[0];
    var usedSections = {};
    built.forEach(function (i) {
      if (i.sectionId) usedSections[i.sectionId] = true;
      (i.children || []).forEach(function (c) {
        if (c.sectionId) usedSections[c.sectionId] = true;
      });
    });
    var spareSections = ((currentPage && currentPage.sections) || [])
      .filter(function (s) { return !s.hidden && !usedSections[s.id]; })
      .map(function (s) {
        return { id: s.id, pid: currentPage.id, title: s.title || "Untitled section" };
      });

    /* every section on the page, including ones already in the menu, so a
       row can still name itself after being added */
    var allSections = ((currentPage && currentPage.sections) || []).map(function (s) {
      return { id: s.id, title: s.title || "Untitled section" };
    });

    /* What a row calls itself: a section entry is named after its section,
       and saying "Home" for six rows would be useless. */
    function rowName(item) {
      if (item.label) return item.label;
      if (item.sectionId) {
        var hit = allSections.filter(function (s) { return s.id === item.sectionId; })[0];
        return hit ? hit.title : "Section";
      }
      return pageName(item.pageId);
    }

    function childRows(item) {
      return (item.children || []).map(function (c, ci) {
        return '<li class="menu-sub">' +
          '<input type="text" data-nav-child="' + item.pageId + ':' + ci +
            '" value="' + SSr.esc(c.label) + '" placeholder="' +
            SSr.esc(pageName(c.pageId)) + '" aria-label="Submenu label">' +
          '<button type="button" class="icon-btn" data-nav-child-up="' +
            item.pageId + ":" + ci + '" aria-label="Move up">' +
            '<i class="bi bi-arrow-up" aria-hidden="true"></i></button>' +
          '<button type="button" class="icon-btn danger" data-nav-child-rm="' +
            item.pageId + ":" + ci + '" aria-label="Remove from submenu">' +
            '<i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
        "</li>";
      }).join("");
    }

    var rows = built.map(function (item, i) {
      return '<li class="menu-row' + (item.visible ? "" : " is-hidden") + '">' +
        '<div class="menu-row-main">' +
          '<button type="button" class="icon-btn" data-nav-up="' + i +
            '" aria-label="Move up" title="Move up"' +
            (i === 0 ? " disabled" : "") + ">" +
            '<i class="bi bi-arrow-up" aria-hidden="true"></i></button>' +
          '<button type="button" class="icon-btn" data-nav-down="' + i +
            '" aria-label="Move down" title="Move down"' +
            (i === built.length - 1 ? " disabled" : "") + ">" +
            '<i class="bi bi-arrow-down" aria-hidden="true"></i></button>' +
          '<input type="text" data-nav-label="' + i + '" value="' +
            SSr.esc(item.label) + '" placeholder="' +
            (item.href ? SSr.esc(item.href) : SSr.esc(rowName(item))) +
            '" aria-label="Menu label for ' +
            (item.href ? SSr.esc(item.label || "custom link")
                       : SSr.esc(rowName(item))) + '">' +
          (item.href
            ? '<input type="text" class="menu-href" data-nav-href="' + i +
              '" value="' + SSr.esc(item.href) +
              '" aria-label="Address for ' +
              SSr.esc(item.label || "custom link") + '">'
            : "") +
          '<button type="button" class="icon-btn danger" data-nav-rm="' + i +
            '" title="Remove from menu" aria-label="Remove ' +
            SSr.esc(item.label || item.href || rowName(item)) +
            ' from the menu">' +
            '<i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
          '<button type="button" class="icon-btn" data-nav-toggle="' + i +
            '" aria-pressed="' + (item.visible ? "true" : "false") +
            '" title="' + (item.visible ? "Hide from menu" : "Show in menu") +
            '" aria-label="' + (item.visible ? "Hide from menu" : "Show in menu") + '">' +
            '<i class="bi bi-eye' + (item.visible ? "" : "-slash") +
            '" aria-hidden="true"></i></button>' +
        "</div>" +
        (item.children && item.children.length
          ? '<ul class="menu-sublist">' + childRows(item) + "</ul>" : "") +
        (spare.length
          ? '<label class="field menu-add"><span>Under this</span>' +
            '<select data-nav-add="' + i + '">' +
              '<option value="">Add a page…</option>' +
              spare.map(function (p) {
                return '<option value="' + p.id + '">' + SSr.esc(p.name) + "</option>";
              }).join("") +
            "</select></label>"
          : "") +
        /* Sections, as their own dropdown with a "sec:" prefix. Page ids and
           section ids are both bare strings, so an unprefixed option could
           not be told apart from a page on the way back in. */
        (spareSections.length
          ? '<label class="field menu-add"><span>Jump to a part</span>' +
            '<select data-nav-add-sec="' + i + '">' +
              '<option value="">Add a section…</option>' +
              spareSections.map(function (s) {
                return '<option value="sec:' + SSr.esc(s.pid) + ":" + SSr.esc(s.id) +
                  '">' + SSr.esc(s.title) + "</option>";
              }).join("") +
            "</select></label>"
          : "") +
      "</li>";
    }).join("");

    host.innerHTML =
      '<div class="panel-section">' +
        /* No <h3>Menu</h3> here: the panel header already says Menu, and
           this section was the only one in the panel, so the word appeared
           twice within three lines of the top. */
        '<p class="hint">What visitors see along the top. Leave a label empty to use the page name.</p>' +
        (built.length
          ? '<ul class="menu-list">' + rows + "</ul>"
          : '<p class="hint">No pages yet.</p>') +
        /* Both of these are always rendered.

           The page dropdown used to disappear entirely once every page was
           in the menu, so there was nothing left to click - reported as
           "you can't even add". A select with nothing selectable is worse
           than no select, so when there are no spare pages it stays and
           says why.

           Custom links are a separate small form rather than an option in
           that dropdown, for two reasons. A menu is the one place a user
           types a URL that goes straight into an href on a published
           document, so it wants its own labelled fields and its own
           validation rather than one more choice in a list. And putting it
           in the dropdown would mean the only way to add an Instagram link
           is the control that cannot be opened on a touchscreen - the bug
           fixed in commit 967f9a9. */
        '<label class="field"><span>Add a page</span>' +
          '<select id="navAddTop"' + (spare.length ? "" : " disabled") + ">" +
            '<option value="">' +
              (spare.length ? "Choose a page…" : "Every page is already in the menu") +
            "</option>" +
            spare.map(function (p) {
              return '<option value="' + p.id + '">' + SSr.esc(p.name) + "</option>";
            }).join("") +
          "</select></label>" +
        '<fieldset class="nav-custom">' +
          "<legend>Add a link</legend>" +
          '<label class="field"><span>Label</span>' +
            '<input type="text" id="navCustomLabel" maxlength="60" ' +
              'placeholder="Instagram" aria-label="Custom link label"></label>' +
          '<label class="field"><span>Address</span>' +
            '<input type="text" id="navCustomHref" maxlength="300" ' +
              'placeholder="https://instagram.com/yourshop" ' +
              'aria-label="Custom link address"></label>' +
          '<button class="btn btn-sm btn-block" id="navCustomAdd" type="button">' +
            "Add link</button>" +
          '<p class="hint">Any address: a website, a mailto: or a tel: number.</p>' +
        "</fieldset>" +
      "</div>";

    /* ---- wiring ---- */

    /* Delegated once, not on every rebuild.

       The panel is rebuilt after every structural edit, and these used to be
       re-registered each time on the same host element, so they piled up:
       four edits then one keystroke produced 47 full page re-renders. The
       menu still saved correctly because the newest closure wrote last,
       which is precisely why looking at the output would never show it.

       Each handler reads the list fresh, so a closure cannot hold stale
       state, and the host flag keeps exactly one set installed. */
    if (!host.__menuWired) {
      host.__menuWired = true;

      host.addEventListener("input", function (ev) {
        var t = ev.target;
        var list = items();
        var lab = t.closest("[data-nav-label]");
        if (lab) {
          var row = list[Number(lab.getAttribute("data-nav-label"))];
          if (!row) return;
          row.label = t.value;
          /* write(), not commit(): the panel must survive the keystroke or
             the field loses focus after one character. This is also what
             actually persists the menu - editing a label on a menu that had
             only ever been derived from the pages had nowhere to go. */
          write(list);
          return;
        }
        /* the address of a custom link, editable in place rather than
           delete-and-retype */
        var hrefField = t.closest("[data-nav-href]");
        if (hrefField) {
          var hrow = list[Number(hrefField.getAttribute("data-nav-href"))];
          if (!hrow) return;
          var safe = window.SS && SS.safeHref ? SS.safeHref(t.value) : t.value;
          if (!safe) return;
          hrow.href = safe;
          write(list);
          return;
        }
        var child = t.closest("[data-nav-child]");
        if (child) {
          var bits = child.getAttribute("data-nav-child").split(":");
          var owner = list.filter(function (x) { return x.pageId === bits[0]; })[0];
          if (owner && owner.children[Number(bits[1])]) {
            owner.children[Number(bits[1])].label = t.value;
            write(list);
          }
        }
      });

      host.addEventListener("change", function (ev) {
        var t = ev.target;
        var list = items();
        var addTop = t.closest("#navAddTop");
        if (addTop && addTop.value) {
          list.push({ pageId: addTop.value, label: "", visible: true, children: [] });
          commit(list);
          return;
        }
        var addSub = t.closest("[data-nav-add]");
        if (addSub && addSub.value) {
          var idx = Number(addSub.getAttribute("data-nav-add"));
          if (!list[idx]) return;
          list[idx].children = list[idx].children || [];
          list[idx].children.push({ pageId: addSub.value, label: "" });
          commit(list);
          return;
        }
        /* "sec:<pageId>:<sectionId>" - split from the right, because a page
           id can itself contain a colon and splitting on the first one
           silently truncated it. */
        var addSec = t.closest("[data-nav-add-sec]");
        if (addSec && addSec.value) {
          var raw = addSec.value.slice(4);
          var cut = raw.lastIndexOf(":");
          if (cut < 1) return;
          var secPage = raw.slice(0, cut);
          var secId = raw.slice(cut + 1);
          list.push({ pageId: secPage, sectionId: secId,
                     label: "", visible: true, children: [] });
          commit(list);
          return;
        }
      });

      host.addEventListener("click", function (ev) {
        var t = ev.target;
        var list = items();

        /* Add a custom link. The address is validated here as well as at
           render time, because the menu is the one place a user types a URL
           that lands in an href on a published document - and the panel is
           long gone by the time anyone visits that site. */
        var addCustom = t.closest("#navCustomAdd");
        if (addCustom) {
          var lab = (host.querySelector("#navCustomLabel").value || "").trim();
          var addr = (host.querySelector("#navCustomHref").value || "").trim();
          if (!addr) {
            SS.toast("Give the link an address", "bi-exclamation-triangle");
            host.querySelector("#navCustomHref").focus();
            return;
          }
          var safe = SS.safeHref(addr);
          if (!safe) {
            SS.toast("Use a web address, or a mailto: or tel: link",
                     "bi-exclamation-triangle");
            host.querySelector("#navCustomHref").focus();
            return;
          }
          if (!lab) {
            /* Without a label the menu shows the raw URL, which is not a
               navigation anyone can read. */
            lab = safe.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
          }
          list.push({ pageId: null, href: safe, label: lab, visible: true,
                      children: [] });
          commit(list);
          return;
        }

        function act(attr, fn) {
          var b = t.closest("[" + attr + "]");
          if (!b) return false;
          fn(Number(b.getAttribute(attr)));
          return true;
        }
        if (act("data-nav-up", function (i) {
          if (i <= 0) return;
          var tmp = list[i - 1]; list[i - 1] = list[i]; list[i] = tmp;
          commit(list);
        })) return;
        if (act("data-nav-down", function (i) {
          if (i >= list.length - 1) return;
          var tmp = list[i + 1]; list[i + 1] = list[i]; list[i] = tmp;
          commit(list);
        })) return;
        if (act("data-nav-toggle", function (i) {
          if (!list[i]) return;
          list[i].visible = !list[i].visible;
          commit(list);
        })) return;
        /* Removing a top-level row. There was no way to do this at all: a
           menu could be reordered and hidden but never taken out, which
           matters most now that a row can be a custom link somebody typed
           in by mistake. */
        if (act("data-nav-rm", function (i) {
          if (!list[i]) return;
          list.splice(i, 1);
          commit(list);
        })) return;
        /* Child buttons carry a "pageId:index" key rather than a plain
           number, so they are handled outside act(). */
        var rm = t.closest("[data-nav-child-rm]");
        var up = t.closest("[data-nav-child-up]");
        if (rm || up) {
          var bits = (rm || up).getAttribute(
            rm ? "data-nav-child-rm" : "data-nav-child-up").split(":");
          var owner = list.filter(function (x) { return x.pageId === bits[0]; })[0];
          if (owner) {
            var ci = Number(bits[1]);
            if (rm) owner.children.splice(ci, 1);
            else {
              var moved = owner.children.splice(ci, 1)[0];
              owner.children.splice(ci - 1, 0, moved);
            }
            commit(list);
          }
          return;
        }
      });
    }
  };

  /* Every remaining colour control, in one place.

   The brand swatches were rebuilt by hand, and the other seven - frame,
   footer background and link, block background/text/accent, decorative
   shapes - were still bare <input type="color">. Each would have opened the
   native dialog in the top-left corner with no Apply and a meaningless
   opacity slider.

   This adds a chip in front of every one of them and wires it, rather than
   editing seven call sites that each already have their own working change
   handler. Applying dispatches a plain "input" event on the original
   element, so the existing handler runs untouched - the point of doing it
   this way is that no panel needs to know the picker exists.

   The brand inputs carry .colour-native already and are skipped, so they
   never end up with two chips. */
function enhanceColourInputs(host) {
  var inputs = host.querySelectorAll('input[type="color"]:not(.colour-native)');
  Array.prototype.forEach.call(inputs, function (input) {
    if (input.dataset.chipReady) return;
    input.dataset.chipReady = "1";
    input.classList.add("colour-native");

    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "colour-chip";
    chip.style.setProperty("--chip", input.value || "#000000");
    chip.setAttribute("aria-label", "Choose a colour");
    chip.innerHTML = '<span class="colour-chip-inner"></span>';
    input.parentNode.insertBefore(chip, input);

    chip.addEventListener("click", function () {
      if (!window.SS || !SS.openColourPicker) return;
      SS.openColourPicker({
        anchor: chip,
        value: input.value,
        native: input,
        onApply: function (hex) {
          input.value = hex;
          chip.style.setProperty("--chip", hex);
          /* the panel's own handler, unchanged, is what persists it */
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    });

    input.addEventListener("input", function () {
      chip.style.setProperty("--chip", input.value);
    });
  });
}

EditorUI.enhanceColourInputs = enhanceColourInputs;

EditorUI.footerPanel = function (host) {
    var Editor = window.Editor;
    host.hidden = false;
    var plan = Editor.plan;
    plan.footer = plan.footer || {};
    var f = plan.footer;
    var data = window.SS.footerData(plan);
    var style = f.style || {};
    /* The swatch has to show the colour that is actually on screen. With
       "Use theme" there is no stored value, and these two used to fall back
       to hardcoded #ffffff and #1d4ed8 - so a footer inheriting a cream or
       navy theme showed a white square. paletteColor() resolves the real
       palette entry, which is what the section panel already does. */
    var spec = Editor.spec();

    function refresh() { EditorUI.footerPanel(host); }
    /* Only setStyle survives from the original pair: set() was never called
       here, and leaving dead helpers next to live ones is how the next
       person edits the wrong one. */
    function setStyle(key, value) {
      f.style = f.style || {};
      if (value === null || value === "") delete f.style[key];
      else f.style[key] = value;
      Editor.render();
      if (Editor.onChange) Editor.onChange("footer:style");
    }

    var socials = data.socials.map(function (s, i) {
      return '<div class="social-row">' +
        '<input type="text" class="social-label" data-social="' + i + '" value="' + SS.esc(s.label || "") +
          '" aria-label="Label for link ' + (i + 1) + '" placeholder="Label">' +
        '<input type="url" class="social-url" data-social="' + i + '" value="' + SS.esc(s.url || "") +
          '" aria-label="Address for link ' + (i + 1) + '" placeholder="https://">' +
        '<button type="button" class="icon-btn" data-remove-social="' + i + '" aria-label="Remove link ' + (i + 1) + '">' +
          '<i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
        "</div>";
    }).join("");

    host.innerHTML =
      '<div class="panel-section">' +
        /* as with the Menu panel: the header above already names it */
        '<p class="hint">Click any text in the footer on the page to edit it.</p>' +
        '<label class="field"><span>Columns</span>' +
          '<select id="footCols">' +
            ["1.4fr 1fr 1fr", "1fr 1fr", "1fr 1fr 1fr"].map(function (c) {
              return '<option value="' + c + '"' + ((style.columns || "1.4fr 1fr 1fr") === c ? " selected" : "") + ">" +
                c.split(" ").length + " columns</option>";
            }).join("") +
          "</select></label>" +
        '<label class="field"><span>Text alignment</span>' +
          '<select id="footAlign">' +
            ["", "left", "center"].map(function (a) {
              return '<option value="' + a + '"' + ((style.align || "") === a ? " selected" : "") + ">" +
                (a === "" ? "Default" : a) + "</option>";
            }).join("") +
          "</select></label>" +
      "</div>" +

      '<div class="panel-section">' +
        "<h3>Colours</h3>" +
        '<label class="field"><span>Background</span>' +
          '<span class="colour-row">' +
            '<input type="color" id="footBg" value="' + SS.esc(normHex(style.bg) || paletteColor(spec, "bg")) + '">' +
            '<button type="button" class="btn btn-sm" data-clear="bg">Use theme</button>' +
          "</span></label>" +
        '<label class="field"><span>Link colour</span>' +
          '<span class="colour-row">' +
            '<input type="color" id="footAccent" value="' + SS.esc(normHex(style.accent) || paletteColor(spec, "accent")) + '">' +
            '<button type="button" class="btn btn-sm" data-clear="accent">Use theme</button>' +
          "</span></label>" +
      "</div>" +

      '<div class="panel-section">' +
        "<h3>Social links</h3>" +
        '<div class="social-list">' + socials + "</div>" +
        '<button type="button" class="btn btn-block" id="addSocial">' +
          '<i class="bi bi-plus-lg" aria-hidden="true"></i> Add a link</button>' +
      "</div>" +

      '<div class="panel-section">' +
        '<button type="button" class="btn btn-block" id="footToggle">' +
          (data.hidden ? "Show the footer" : "Hide the footer") + "</button>" +
      "</div>";

    host.querySelector("#footCols").addEventListener("change", function () {
      setStyle("columns", this.value === "1.4fr 1fr 1fr" ? null : this.value);
    });
    host.querySelector("#footAlign").addEventListener("change", function () {
      setStyle("align", this.value || null);
    });
    var bgInput = host.querySelector("#footBg");
    if (bgInput) bgInput.addEventListener("input", function () { setStyle("bg", this.value); });
    var accentInput = host.querySelector("#footAccent");
    if (accentInput) accentInput.addEventListener("input", function () { setStyle("accent", this.value); });

    host.querySelectorAll("[data-clear]").forEach(function (button) {
      button.addEventListener("click", function () {
        setStyle(button.getAttribute("data-clear"), null);
        refresh();
      });
    });

    /* link labels are edited on the page; URLs live here because they
       cannot be typed into visible text */
    host.querySelectorAll(".social-url").forEach(function (input) {
      input.addEventListener("change", function () {
        var i = parseInt(input.getAttribute("data-social"), 10);
        plan.footer.socials = plan.footer.socials || data.socials;
        plan.footer.socials[i] = plan.footer.socials[i] || {};
        plan.footer.socials[i].url = input.value.trim();
        Editor.render();
        if (Editor.onChange) Editor.onChange("footer:social");
      });
    });
    host.querySelectorAll(".social-label").forEach(function (input) {
      input.addEventListener("change", function () {
        var i = parseInt(input.getAttribute("data-social"), 10);
        plan.footer.socials = plan.footer.socials || data.socials;
        plan.footer.socials[i] = plan.footer.socials[i] || {};
        plan.footer.socials[i].label = input.value.trim();
        Editor.render();
        if (Editor.onChange) Editor.onChange("footer:social");
      });
    });
    host.querySelectorAll("[data-remove-social]").forEach(function (button) {
      button.addEventListener("click", function () {
        var i = parseInt(button.getAttribute("data-remove-social"), 10);
        var list = (plan.footer.socials && plan.footer.socials.length) ? plan.footer.socials : data.socials;
        list.splice(i, 1);
        plan.footer.socials = list;
        Editor.render();
        if (Editor.onChange) Editor.onChange("footer:social");
        refresh();
      });
    });
    host.querySelector("#addSocial").addEventListener("click", function () {
      plan.footer.socials = (plan.footer.socials && plan.footer.socials.length) ? plan.footer.socials : data.socials;
      plan.footer.socials.push({ label: "New link", url: "https://" });
      Editor.render();
      if (Editor.onChange) Editor.onChange("footer:social");
      refresh();
    });
    host.querySelector("#footToggle").addEventListener("click", function () {
      f.hidden = !f.hidden;
      Editor.render();
      if (Editor.onChange) Editor.onChange("footer:hidden");
      refresh();
    });
  };

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

      (section.type === "images" ? decorPanel(section) : "") +

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

    /* background decoration lives on the images block */
    if (section.type === "images" && EditorUI.wireDecor) EditorUI.wireDecor(host, section);
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

    /* One labelled colour row: a swatch that opens the OS picker, a text
       field for pasting a hex, and both writing the same value.

       The text field is not redundant. Pasting "#B04A26" out of a brand
       guide is what people actually do, and a colour input alone makes
       that impossible. It takes rgb() and hsl() as well, because that is
       what Figma, a screenshot and every CSS rule hand you.

       The RGB readout is shown beside the swatch rather than left inside
       the browser's dialog: you should not have to open a system window to
       find out what colour you just set.

       An unset brand colour shows the colour the site is actually using
       right now, not black. Three solid black swatches beside empty text
       fields said "black", when the honest answer is "whatever the palette
       chose" - seen in a screenshot of the Design panel. The swatch is
       dimmed while unset so it still reads as not-yet-chosen.

       The swatch is a button that opens SiteSketch's own picker, not an
       <input type="color">. The native dialog opens in the top-left of the
       screen rather than beside the swatch, has no Apply, and shows an
       opacity slider for a design system with no transparency in it. The
       native input is still here, visually hidden, purely so the picker can
       offer "More colours" - the eyedropper is worth keeping. */
    function brandColour(key, label, current, effective) {
      var id = "colour_" + key;
      var value = window.DESIGN ? DESIGN.parseColour(current) : null;
      var rgbText = value ? "rgb(" + DESIGN.toRGB(value) + ")" : "";
      var shown = value || normHex(effective) || "#000000";
      return '<div class="brand-row">' +
        '<label class="field" for="' + id + '_hex"><span>' + label + "</span>" +
          '<span class="brand-inputs">' +
            '<button type="button" class="colour-chip" id="' + id + '_chip"' +
              ' style="--chip:' + shown + '"' +
              (value ? "" : " data-empty=\"1\"") +
              ' aria-label="Choose ' + label.toLowerCase() + ' colour">' +
              '<span class="colour-chip-inner"></span>' +
            "</button>" +
            '<input type="color" class="colour-native" id="' + id + '" value="' + shown + '"' +
              (value ? "" : ' data-empty="1"') +
              ' tabindex="-1" aria-hidden="true">' +
            '<input type="text" id="' + id + '_hex" class="hex-field" value="' +
              (value || "") + '"' +
              ' placeholder="hex, rgb() or hsl()" maxlength="40" spellcheck="false"' +
              ' aria-label="' + label + ' colour value">' +
            '<output class="rgb-readout" id="' + id + '_rgb"' +
              (rgbText ? "" : " hidden") + ">" + rgbText + "</output>" +
          "</span>" +
        "</label>" +
      "</div>";
    }

    host.innerHTML =
      '<div class="panel-section">' +
        '<h3>Colours</h3>' +
        '<div class="palette-current" id="paletteName"></div>' +
        '<div id="swatchHost"></div>' +
        /* Three inputs, not eight. A palette is eight interlocking
           colours and nobody picks eight sensible ones; what a shopkeeper
           has is a brand colour, a background and an ink. The other five
           are derived from these, because each exists only to keep the
           other three readable. */
        '<fieldset class="brand-colours">' +
          '<legend>Your brand colours</legend>' +
          brandColour("accent", "Accent", spec.tokens.colour && spec.tokens.colour.accent,
                       paletteColor(spec, "accent")) +
          brandColour("bg", "Background", spec.tokens.colour && spec.tokens.colour.bg,
                       paletteColor(spec, "bg")) +
          brandColour("text", "Text", spec.tokens.colour && spec.tokens.colour.text,
                      paletteColor(spec, "text")) +
          '<button class="btn btn-block btn-ghost btn-sm" id="colourReset">Clear brand colours</button>' +
        "</fieldset>" +
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
        /* Three sliders rather than nine dropdowns. Every size on the page
           is a calc() against --type-scale, so this one control is the
           whole type scale - and there is no way to set the heading size
           without also changing the small print. */
        typeSlider("scale", "Text size", 0.85, 1.3, 0.01,
          function (v) { return Math.round(v * 100) + "%"; },
          spec.tokens.type && spec.tokens.type.scale) +
        typeSlider("lh", "Line spacing", 0.85, 1.5, 0.01,
          function (v) { return v.toFixed(2); },
          spec.tokens.type && spec.tokens.type.lh) +
        typeSlider("ls", "Letter spacing", -0.02, 0.12, 0.005,
          function (v) { return (v > 0 ? "+" : "") + (v * 1000).toFixed(0) + "/1000em"; },
          spec.tokens.type && spec.tokens.type.ls) +
        '<button class="btn btn-block btn-ghost" id="typeReset">Reset type size</button>' +
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

    /* What the site is actually using for one brand colour right now, so an
       unset swatch previews the live colour instead of a flat black square
       that reads as "your brand is black". */
    function effectiveOf(key) { return paletteColor(spec, key); }

    /* ---------- brand colour bindings ---------- */
    ["accent", "bg", "text"].forEach(function (key) {
      var picker = host.querySelector("#colour_" + key);
      var chip = host.querySelector("#colour_" + key + "_chip");
      var hex = host.querySelector("#colour_" + key + "_hex");
      if (!picker || !hex || !chip) return;

      function write(value) {
        var spec2 = window.Editor.spec();
        var colour = spec2.tokens.colour || (spec2.tokens.colour = {});
        if (value) colour[key] = value;
        else delete colour[key];
        /* leaving nothing set should behave like never having touched it */
        if (!Object.keys(colour).length) delete spec2.tokens.colour;
        window.Editor.onChange("design:colour");
        refresh();
      }

      /* The swatch opens our picker. This is the whole of bugs 3, 4 and 5
         from KNOWN_BUGS.md: the native dialog lands in the top-left of the
         screen, has no Apply, and offers an opacity slider for a design
         system that has no transparency anywhere. */
      chip.addEventListener("click", function () {
        var live = (window.Editor.spec().tokens.colour || {})[key] ||
                   normHex(effectiveOf(key));
        SS.openColourPicker({
          anchor: chip,
          value: live,
          native: picker,
          onApply: function (hexValue) {
            picker.value = hexValue;
            picker.removeAttribute("data-empty");
            hex.value = hexValue.toUpperCase();
            chip.removeAttribute("data-empty");
            showRGB(hexValue);
            write(hexValue.toUpperCase());
          }
        });
      });

      function showRGB(hexValue) {
        var out = host.querySelector("#colour_" + key + "_rgb");
        if (!out) return;
        var text = DESIGN.toRGB(hexValue);
        out.textContent = text ? "rgb(" + text + ")" : "";
        out.hidden = !text;
      }

      picker.addEventListener("input", function () {
        hex.value = this.value.toUpperCase();
        this.removeAttribute("data-empty");
        chip.removeAttribute("data-empty");
        chip.style.setProperty("--chip", this.value);
        showRGB(this.value);
        write(this.value.toUpperCase());
      });

      /* Only a complete, valid hex is written. Taking the value on every
         keystroke would store "#B04" as a colour and blank the page while
         somebody is still typing the rest of it. */
      hex.addEventListener("change", function () {
        var raw = this.value.trim();
        if (!raw) { write(""); return; }
        var v = window.DESIGN ? DESIGN.parseColour(raw) : null;
        if (!v) {
          SS.toast("Use #B04A26, rgb(176, 74, 38) or hsl(20, 62%, 42%)",
                   "bi-exclamation-triangle");
          return;
        }
        picker.value = v;
        this.value = v.toUpperCase();
        picker.removeAttribute("data-empty");
        chip.removeAttribute("data-empty");
        chip.style.setProperty("--chip", v);
        /* typing rgb() must update the readout too, not just dragging the
           swatch - otherwise the value is right and the display lies */
        showRGB(v);
        write(v.toUpperCase());
      });
    });

    var colourReset = host.querySelector("#colourReset");
    if (colourReset) {
      colourReset.addEventListener("click", function () {
        delete window.Editor.spec().tokens.colour;
        window.Editor.onChange("design:colour");
        refresh();
        window.EditorUI.stylesPanel(host);
      });
    }

    /* One slider row for a type-scale token.

       `current` is undefined until someone touches it, which is not the
       same as zero: text size defaults to 1 (100%), line spacing to 1 and
       letter spacing to 0em. Reading a slider as 0 because nobody has
       touched it yet would silently shrink every site to nothing. */
    function typeSlider(key, label, min, max, step, format, value0) {
      var defaults = { scale: 1, lh: 1, ls: 0 };
      var value = value0 == null ? defaults[key] : value0;
      var id = "type_" + key;
      return '<label class="field" for="' + id + '">' +
        "<span>" + label +
          ' <output id="' + id + '_out">' + format(value) + "</output></span>" +
        '<input type="range" id="' + id + '" min="' + min + '" max="' + max +
          '" step="' + step + '" value="' + value + '">' +
      "</label>";
    }

    function bindTypeSlider(key, id) {
      var input = host.querySelector("#" + id);
      var out = host.querySelector("#" + id + "_out");
      if (!input) return;
      var spec2 = window.Editor.spec();
      var ty = spec2.tokens.type || (spec2.tokens.type = {});
      var format = key === "scale"
        ? function (v) { return Math.round(v * 100) + "%"; }
        : key === "lh"
          ? function (v) { return v.toFixed(2); }
          : function (v) { return (v > 0 ? "+" : "") + (v * 1000).toFixed(0) + "/1000em"; };
      input.addEventListener("input", function () {
        var v = parseFloat(this.value);
        ty[key] = v;
        if (out) out.textContent = format(v);
        refresh();
      });
      /* The control lives outside the rendered page, so it is not wiped
         by a repaint. Only the panel needs rebuilding, and only when the
         value actually lands somewhere new. */
      if (out) out.textContent = format(parseFloat(input.value));
    }

    bindTypeSlider("scale", "type_scale");
    bindTypeSlider("lh", "type_lh");
    bindTypeSlider("ls", "type_ls");

    var typeReset = host.querySelector("#typeReset");
    if (typeReset) {
      typeReset.addEventListener("click", function () {
        var s = window.Editor.spec();
        delete s.tokens.type;
        refresh();
        window.EditorUI.stylesPanel(host);
      });
    }

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

  /* `at` is the index to insert at. Omit it and the section goes at the end,
     which is what clicking a rail card always did - and why a section
     could only ever be appended, then dragged somewhere better afterwards.
     Dropping a card on the canvas passes the index it landed on.

     Everything else is unchanged on purpose: the same toast, the same
     selection, the same onChange. History and autosave go through onChange,
     so a dropped section is undoable exactly like a clicked one. */
  EditorUI.addSection = function (typeKey, at) {
    var plan = window.Editor.plan;
    var page = plan.pages.filter(function (p) { return p.id === window.Editor.pageId; })[0];
    if (!page) return;
    var def = API.SECTIONS[typeKey] || { name: typeKey, blurb: "" };
    /* A page can reasonably have three testimonials or two menus, but two
       heroes stacked full-width reads as a mistake - measured on a published
       site, which came out with g-hero twice and both rendered. Features
       and items stay repeatable; only the opener is a singleton. Refused
       out loud rather than silently, because a rail card that does nothing
       on click looks broken rather than deliberate. */
    if (typeKey === "hero" && page.sections.some(function (s) { return s.type === "hero"; })) {
      SS.toast("This page already has a hero at the top", "bi-exclamation-circle");
      return;
    }
    var section = {
      id: "s_" + Math.random().toString(36).slice(2, 9),
      type: typeKey,
      title: def.name,
      subtitle: def.blurb,
      fields: {},
      items: EditorUI.startersFor(typeKey)
    };
    /* clamped rather than trusted: a drop index past the end, or a negative
       one from an edge drag, would otherwise splice the section out of the
       page entirely */
    var index = (typeof at === "number" && isFinite(at))
      ? Math.max(0, Math.min(at, page.sections.length))
      : page.sections.length;
    page.sections.splice(index, 0, section);
    window.Editor.selectedId = section.id;
    if (window.Editor.onChange) window.Editor.onChange("structure");
    SS.toast(def.name + " added", "bi-plus-circle");
  };

  window.EditorUI = EditorUI;
})();