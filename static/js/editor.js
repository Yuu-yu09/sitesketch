/* ============================================================
   editor.js - direct page editing, the WordPress way.

   One page, edited in place:
     * click a section  -> it is selected, a toolbar floats above it
     * click any text   -> type straight into the page, saved on blur
     * click an image   -> pick from the library or upload your own
     * the Styles panel -> colours, typography and layout for the whole site

   Every change is written back into plan_json through one callback,
   so saving, history and undo all live in one place.
   ============================================================ */
(function () {
  "use strict";

  var SS = window.SS || (window.SS = {});

  var Editor = {
    root: null,
    plan: null,
    pageId: null,
    selectedId: null,
    onChange: null,        /* called after every mutation */
    onSelectionChange: null,
    editing: false,
  };

  /* ---------------- path helpers ----------------
     A data-edit path is relative to the section it sits in:
       "title" | "subtitle" | "body" | "fields:buttonText" | "items:2:title"
     so the owning section is always needed alongside the path.          */

  function sectionOf(plan, pageId, sectionId) {
    var page = (plan.pages || []).filter(function (p) { return p.id === pageId; })[0];
    if (!page) return null;
    /* the footer is edited like a block but lives outside the page sections */
    if (sectionId === "footer") return plan.footer || (plan.footer = {});
    if (!sectionId) return page.sections[0] || null;
    return page.sections.filter(function (s) { return s.id === sectionId; })[0] || null;
  }

  function resolve(plan, pageId, sectionId, path) {
    var section = sectionOf(plan, pageId, sectionId);
    if (!section) return null;
    var parts = String(path).split(":");

    if (parts[0] === "socials") {
      var si = parseInt(parts[1], 10);
      if (isNaN(si)) return { section: section, key: "socials" };
      section.socials = section.socials || [];
      if (!section.socials[si]) section.socials[si] = { label: "Link", url: "#" };
      return { section: section, socials: true, index: si, field: parts[2] || "label" };
    }

    if (parts.length === 1) return { section: section, key: parts[0] };
    if (parts[0] === "fields") return { section: section, key: "fields", field: parts[1] };

    var index = parseInt(parts[0], 10);
    if (isNaN(index)) return { section: section, key: parts[0] };
    if (!section.items) section.items = [];
    if (!section.items[index]) section.items[index] = { title: "", text: "" };
    return { section: section, items: true, index: index, field: parts[1] || "title" };
  }

  function readValue(plan, pageId, sectionId, path) {
    var t = resolve(plan, pageId, sectionId, path);
    if (!t) return "";
    if (t.key === "fields") return (t.section.fields || {})[t.field] || "";
    if (t.socials) return (t.section.socials[t.index] || {})[t.field] || "";
    if (t.items) return (t.section.items[t.index] || {})[t.field] || "";
    return t.section[t.key] || "";
  }

  function writeValue(plan, pageId, sectionId, path, value) {
    var t = resolve(plan, pageId, sectionId, path);
    if (!t) return false;
    if (t.key === "fields") {
      t.section.fields = t.section.fields || {};
      t.section.fields[t.field] = value;
    } else if (t.socials) {
      t.section.socials = t.section.socials || [];
      t.section.socials[t.index] = t.section.socials[t.index] || { label: "", url: "" };
      t.section.socials[t.index][t.field] = value;
    } else if (t.items) {
      t.section.items[t.index][t.field] = value;
    } else {
      t.section[t.key] = value;
    }
    return true;
  }

  /* the block a DOM node belongs to: a section, or the footer */
  function sectionIdOf(node) {
    if (!node || !node.closest) return null;
    var host = node.closest(".ss-sec");
    if (host) return host.dataset.sect;
    var foot = node.closest("[data-foot]");
    return foot ? "footer" : null;
  }

  /* the footer node for a block id, so the toolbar can sit above it */
  function nodeFor(blockId) {
    if (!Editor.root) return null;
    if (blockId === "footer") return Editor.root.querySelector("[data-foot]");
    return Editor.root.querySelector('.ss-sec[data-sect="' + cssEscape(blockId) + '"]');
  }

  /* the section the block toolbar/panel is acting on */
  Editor.currentSection = function () {
    var page = (Editor.plan.pages || []).filter(function (p) { return p.id === Editor.pageId; })[0];
    if (!page || !Editor.selectedId) return null;
    return page.sections.filter(function (s) { return s.id === Editor.selectedId; })[0] || null;
  };

  Editor.readValue = readValue;
  Editor.writeValue = writeValue;
  Editor.sectionIdOf = sectionIdOf;

  /* ---------------- rendering ---------------- */

  Editor.render = function () {
    var host = Editor.root;
    if (!host || !Editor.plan) return;
    host.innerHTML = SS.renderPage(Editor.plan, Editor.pageId, { editable: true });
    SS.observeMotion(host);
    Editor.restoreText();
    Editor.markSelection();
    wireWall();
  };

  /* contenteditable text is authoritative while typing; after a re-render we
     put the stored value back so nothing is lost mid-edit.

     Keys must include the section id: every section has a "title" path,
     so keying on the path alone would restore one section's wording onto
     another. */
  var pendingText = {};

  function textKey(sectionId, path) {
    return (sectionId || "?") + "|" + path;
  }

  Editor.captureText = function (sectionId, path) {
    var node = Editor.root.querySelector(
      '.ss-sec[data-sect="' + cssEscape(sectionId) + '"] [data-edit="' + cssEscape(path) + '"]');
    if (node) pendingText[textKey(sectionId, path)] = node.innerHTML;
  };

  Editor.restoreText = function () {
    Object.keys(pendingText).forEach(function (key) {
      var split = key.indexOf("|");
      var sectionId = key.slice(0, split);
      var path = key.slice(split + 1);
      var node = Editor.root.querySelector(
        '.ss-sec[data-sect="' + cssEscape(sectionId) + '"] [data-edit="' + cssEscape(path) + '"]');
      if (node && node.innerHTML !== pendingText[key]) node.innerHTML = pendingText[key];
    });
  };

  /* Drop the buffer wholesale.

     restoreText() re-applies this on every render, which is what stops a
     half-typed sentence vanishing mid-edit. It is also a trap for undo:
     the buffer holds text from *before* the step being undone, so
     re-applying it would quietly put the old wording back on top of the
     restored one and undo would look like it half-worked. */
  Editor.forgetText = function () {
    Object.keys(pendingText).forEach(function (key) { delete pendingText[key]; });
  };

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, "\\$&");
  }

  Editor.markSelection = function () {
    Array.prototype.forEach.call(Editor.root.querySelectorAll(".ss-sec"), function (node) {
      node.classList.toggle("is-selected", node.dataset.sect === Editor.selectedId);
    });
    var foot = Editor.root.querySelector("[data-foot]");
    if (foot) foot.classList.toggle("is-selected", Editor.selectedId === "footer");
  };

  Editor.select = function (id) {
    Editor.selectedId = id;
    Editor.markSelection();
    ensureToolbar().updateFor(id);
    positionToolbar();
    if (Editor.onSelectionChange) Editor.onSelectionChange(id);
  };

  /* ---------------- inline text ---------------- */

  function startEditing(node) {
    if (Editor.editing) return;
    Editor.editing = true;
    node.setAttribute("contenteditable", "true");
    node.spellcheck = false;
    node.focus();

    var range = window.getSelection();
    if (range && range.rangeCount) {
      range.selectAllChildren(node);
    }

    function finish() {
      node.removeAttribute("contenteditable");
      Editor.editing = false;
      var html = node.innerHTML.replace(/<br\s*\?>/gi, "");
      writeValue(Editor.plan, Editor.pageId, sectionIdOf(node), node.dataset.edit, html);
      pendingText[textKey(sectionIdOf(node), node.dataset.edit)] = html;
      if (Editor.onChange) Editor.onChange(node.dataset.edit);
    }

    node.addEventListener("blur", finish, { once: true });
    node.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); node.blur(); }
      if (event.key === "Enter" && node.tagName !== "DIV" && !event.shiftKey) {
        event.preventDefault();
        node.blur();
      }
    });
  }

  /* ---------------- image slots ---------------- */

  function slotNode(sectionId, slot) {
    var scope = sectionId
      ? Editor.root.querySelector('.ss-sec[data-sect="' + cssEscape(sectionId) + '"]')
      : Editor.root;
    if (!scope) return null;
    return scope.querySelector('[data-img-slot="' + cssEscape(slot) + '"]');
  }

  Editor.imageFor = function (sectionId, slot) {
    var node = slotNode(sectionId, slot);
    return node ? (node.getAttribute("src") || "") : "";
  };

  Editor.setImage = function (sectionId, slot, url) {
    /* slot is "img" for a whole section, or "items:2:img" for a list entry */
    writeValue(Editor.plan, Editor.pageId, sectionId, slot, url || "");
    /* a new image has no crop yet */
    var section = sectionOf(Editor.plan, Editor.pageId, sectionId);
    if (section && section.crops) delete section.crops[slot];
    if (Editor.onChange) Editor.onChange(slot);
  };

  /* Non-destructive crop: stored on the section as fractions of the image. */
  Editor.setCrop = function (sectionId, slot, crop) {
    var section = sectionOf(Editor.plan, Editor.pageId, sectionId);
    if (!section) return;
    if (!crop) {
      if (section.crops) delete section.crops[slot];
    } else {
      section.crops = section.crops || {};
      section.crops[slot] = {
        x: Math.round(crop.x * 1e4) / 1e4,
        y: Math.round(crop.y * 1e4) / 1e4,
        w: Math.round(crop.w * 1e4) / 1e4,
        h: Math.round(crop.h * 1e4) / 1e4
      };
    }
    if (Editor.onChange) Editor.onChange("crop:" + slot);
    /* repaint so the new framing is visible straight away */
    Editor.render();
  };

  Editor.cropFor = function (sectionId, slot) {
    var section = sectionOf(Editor.plan, Editor.pageId, sectionId);
    if (!section || !section.crops) return null;
    return section.crops[slot] || null;
  };

  /* ---------------- styles (the theme.json equivalent) ---------------- */

  Editor.spec = function () { return SS.specFor(Editor.plan); };

  Editor.setToken = function (key, value) {
    var spec = Editor.spec();
    spec.tokens[key] = value;
    if (Editor.onChange) Editor.onChange("design:" + key);
  };

  Editor.redesign = function (spec) {
    Editor.plan.design = spec;
    if (Editor.onChange) Editor.onChange("design:all");
  };

  /* ---------------- the floating block toolbar ---------------- */

  var toolbar = null;

  function ensureToolbar() {
    if (toolbar) return toolbar;
    toolbar = document.createElement("div");
    toolbar.className = "block-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Section actions");
    toolbar.hidden = true;
    toolbar.innerHTML =
      '<button class="icon-btn" data-do="up" title="Move up" aria-label="Move up"><i class="bi bi-arrow-up" aria-hidden="true"></i></button>' +
      '<button class="icon-btn" data-do="down" title="Move down" aria-label="Move down"><i class="bi bi-arrow-down" aria-hidden="true"></i></button>' +
      '<span class="toolbar-sep" aria-hidden="true"></span>' +
      '<button class="icon-btn" data-do="layout" title="Change layout" aria-label="Change layout"><i class="bi bi-layout-text-window" aria-hidden="true"></i></button>' +
      '<button class="icon-btn" data-do="image" title="Change image" aria-label="Change image"><i class="bi bi-image" aria-hidden="true"></i></button>' +
      '<button class="icon-btn" data-do="crop" title="Crop image" aria-label="Crop image"><i class="bi bi-crop" aria-hidden="true"></i></button>' +
      '<button class="icon-btn" data-do="settings" title="Section settings" aria-label="Section settings"><i class="bi bi-sliders" aria-hidden="true"></i></button>' +
      '<button class="icon-btn" data-do="ai" title="Rewrite with AI" aria-label="Rewrite with AI"><i class="bi bi-lightning" aria-hidden="true"></i></button>' +
      '<span class="toolbar-sep" aria-hidden="true"></span>' +
      '<button class="icon-btn" data-do="dup" title="Duplicate" aria-label="Duplicate section"><i class="bi bi-copy" aria-hidden="true"></i></button>' +
      '<button class="icon-btn danger" data-do="del" title="Remove" aria-label="Remove section"><i class="bi bi-trash3" aria-hidden="true"></i></button>';
    document.body.appendChild(toolbar);

    toolbar.addEventListener("click", function (event) {
      var button = event.target.closest("[data-do]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      Editor.command(button.dataset.do);
    });

    /* the footer supports fewer actions than a section */
    toolbar.updateFor = function (blockId) {
      var isFooter = blockId === "footer";
      ["up", "down", "layout", "image", "crop", "ai", "dup", "del"].forEach(function (action) {
        var button = toolbar.querySelector('[data-do="' + action + '"]');
        if (button) button.hidden = isFooter;
      });
      toolbar.querySelectorAll(".toolbar-sep").forEach(function (sep) { sep.hidden = isFooter; });
    };
    return toolbar;
  }

  function positionToolbar() {
    var bar = ensureToolbar();
    if (!Editor.selectedId || !Editor.root) { bar.hidden = true; return; }
    var section = nodeFor(Editor.selectedId);
    if (!section) { bar.hidden = true; return; }
    var box = section.getBoundingClientRect();
    bar.hidden = false;
    var top = box.top - 44;
    if (top < 8) top = box.bottom + 6;
    bar.style.top = Math.round(top + window.scrollY) + "px";
    bar.style.left = Math.round(box.left + window.scrollX) + "px";
  }
  Editor.positionToolbar = positionToolbar;

  Editor.command = function (what) {
    var page = Editor.plan.pages.filter(function (p) { return p.id === Editor.pageId; })[0];
    if (!page) return;

    /* the footer is editable, but it cannot be reordered, duplicated
       or AI-rewritten like a section */
    if (Editor.selectedId === "footer") {
      if (what === "settings" && Editor.onOpenSettings) Editor.onOpenSettings("footer");
      return;
    }

    var index = page.sections.findIndex(function (s) { return s.id === Editor.selectedId; });
    if (index === -1) return;
    var section = page.sections[index];

    if (what === "up" && index > 0) {
      page.sections.splice(index, 1);
      page.sections.splice(index - 1, 0, section);
    } else if (what === "down" && index < page.sections.length - 1) {
      page.sections.splice(index, 1);
      page.sections.splice(index + 1, 0, section);
    } else if (what === "dup") {
      var copy = JSON.parse(JSON.stringify(section));
      copy.id = "s_" + Math.random().toString(36).slice(2, 9);
      page.sections.splice(index + 1, 0, copy);
      Editor.selectedId = copy.id;
    } else if (what === "del") {
      if (page.sections.length === 1) {
        SS.toast("A page needs at least one section", "bi-info-circle");
        return;
      }
      page.sections.splice(index, 1);
      Editor.selectedId = null;
      /* drop any buffered wording belonging to the removed section */
      Object.keys(pendingText).forEach(function (key) {
        if (key.slice(0, key.indexOf("|")) === section.id) delete pendingText[key];
      });
    } else if (what === "layout") {
      var spec = Editor.spec();
      var next = window.DESIGN.cycleVariant(spec, section);
      SS.toast("Layout: " + next, "bi-layout-text-window");
    } else if (what === "image") {
      if (window.EditorUI) EditorUI.openMedia(section.id, "img");
      return;
    } else if (what === "crop") {
      var cropSlot = Editor.selectedImageSlot || "img";
      var src = Editor.imageFor(section.id, cropSlot);
      if (window.Crop) {
        Crop.open({
          sectionId: section.id,
          slot: cropSlot,
          src: src,
          crop: Editor.cropFor(section.id, cropSlot)
        });
      }
      return;
    } else if (what === "settings") {
      if (Editor.onOpenSettings) Editor.onOpenSettings(section.id);
      return;
    } else if (what === "ai") {
      if (Editor.onAI) Editor.onAI(section);
      return;
    }
    /* structure changed: repaint the page, then let the host save */
    Editor.render();
    positionToolbar();
    if (Editor.onChange) Editor.onChange("structure");
  };

  /* ---------------- the photo wall ----------------
     Adding, sizing, removing and reordering pictures is deliberately
     free-form. There is no layout picker here on purpose: a preset is
     what makes every generated site look the same. */

  var wallSortable = null;

  function currentWall(sectionId) {
    var root = Editor.root;
    if (!root) return null;
    if (sectionId) return root.querySelector('.ss-sec[data-sect="' + cssEscape(sectionId) + '"] [data-wall]');
    return root.querySelector("[data-wall]");
  }

  /* A page can hold more than one photo wall, so every lookup is scoped
     to a section id rather than taking the first one it finds. */
  function wallSection(sectionId) {
    if (!Editor.plan) return null;
    var page = (Editor.plan.pages || []).filter(function (p) { return p.id === Editor.pageId; })[0];
    if (!page) return null;
    var list = page.sections.filter(function (s) { return s.type === "images"; });
    if (!sectionId) return list[0] || null;
    return list.filter(function (s) { return s.id === sectionId; })[0] || null;
  }

  function wallItems(sectionId) {
    var section = wallSection(sectionId);
    if (!section) return [];
    if (!Array.isArray(section.items)) section.items = [];
    return section.items;
  }

  Editor.wallSection = wallSection;

  /* asks the host to show the shape/frame panel for one picture */
  Editor.openPhotoSettings = function (sectionId, index) {
    if (Editor.onOpenPhoto) Editor.onOpenPhoto(sectionId, index);
    else if (window.EditorUI) EditorUI.photoPanel(document.getElementById("panelBody"), sectionId, index);
  };

  Editor.wallChanged = function (reason) {
    Editor.render();
    wireWall();
    if (Editor.onChange) Editor.onChange(reason || "wall");
  };

  function wireWall() {
    if (wallSortable) { wallSortable.destroy(); wallSortable = null; }
    var wall = currentWall();
    if (!wall || typeof Sortable === "undefined") return;

    /* each wall on the page gets its own instance, scoped to its section */
    var sectionId = wall.closest(".ss-sec") ? wall.closest(".ss-sec").dataset.sect : null;

    /* dragging a picture reorders it. The grip appears on hover so a
       click on the picture itself can still open the media picker. */
    wallSortable = Sortable.create(wall, {
      draggable: "[data-tile]",
      handle: ".ss-tile-grip",
      ghostClass: "is-ghost",
      animation: 160,
      forceFallback: true,
      fallbackTolerance: 4,
      onEnd: function (event) {
        var list = wallItems(sectionId);
        var from = event.oldIndex, to = event.newIndex;
        if (from === to || from === undefined || to === undefined) return;
        var moved = list.splice(from, 1)[0];
        list.splice(to, 0, moved);
        Editor.wallChanged("wall:reorder");
      }
    });
  }
  Editor.wireWall = wireWall;

  Editor.addPhoto = function (sectionId, index) {
    var list = wallItems(sectionId);
    if (!list.length && !sectionId) return;
    var at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
    list.splice(at, 0, { img: "", size: "s", text: "" });
    Editor.wallChanged("wall:add");

    /* open the picker straight away for the picture we just made */
    var section = wallSection(sectionId);
    var wall = currentWall(sectionId);
    var tile = wall ? wall.querySelector('[data-tile="' + at + '"]') : null;
    if (section && window.EditorUI) EditorUI.openMedia(section.id, "items:" + at + ":img");
    return tile;
  };

  Editor.removePhoto = function (sectionId, index) {
    var list = wallItems(sectionId);
    if (index < 0 || index >= list.length) return;
    list.splice(index, 1);
    Editor.wallChanged("wall:remove");
  };

  Editor.cyclePhotoSize = function (sectionId, index) {
    var list = wallItems(sectionId);
    var item = list[index];
    if (!item) return;
    var sizes = window.SS.PHOTO_SIZES || ["s", "w", "t", "l"];
    var at = sizes.indexOf(item.size);
    item.size = sizes[(at + 1) % sizes.length];
    Editor.wallChanged("wall:size");
    if (window.SS) {
      SS.toast("Size: " + (SS.PHOTO_SIZE_LABEL[item.size] || item.size), "bi-aspect-ratio");
    }
  };

  /* the section a photo tile belongs to, for add/size/remove */
  Editor.wallSectionOfTile = function (tile) {
    if (!tile) return null;
    var host = tile.closest ? tile.closest(".ss-sec") : null;
    return host ? host.dataset.sect : null;
  };

  Editor.wallIndexOf = function (tile) {
    return tile ? parseInt(tile.dataset.tile, 10) : -1;
  };

  /* ---------------- wiring ---------------- */

  Editor.mount = function (options) {
    Editor.root = options.root;
    Editor.plan = options.plan;
    Editor.pageId = options.pageId;
    Editor.onChange = options.onChange || null;
    Editor.onSelectionChange = options.onSelectionChange || null;
    Editor.onAI = options.onAI || null;
    Editor.onOpenSettings = options.onOpenSettings || null;
    Editor.onOpenPhoto = options.onOpenPhoto || null;

    /* select a section when its padding area is clicked */
    Editor.root.addEventListener("click", function (event) {
      var textNode = event.target.closest("[data-edit]");
      if (textNode && !Editor.editing) {
        event.preventDefault();
        event.stopPropagation();
        var owner = textNode.closest(".ss-sec");
        if (owner) Editor.select(owner.dataset.sect);
        startEditing(textNode);
        return;
      }

      var imageSlot = event.target.closest("[data-img-slot]");
      if (imageSlot) {
        event.preventDefault();
        var host = imageSlot.closest(".ss-sec");
        if (host) Editor.select(host.dataset.sect);
        /* remember which image the toolbar's crop button should act on */
        Editor.selectedImageSlot = imageSlot.dataset.imgSlot || "img";
        /* clicking a picture you already chose crops it; otherwise pick one */
        var hasImage = imageSlot.tagName === "IMG";
        if (hasImage && event.detail === 2 && window.Crop) {
          Crop.open({
            sectionId: host ? host.dataset.sect : null,
            slot: Editor.selectedImageSlot,
            src: imageSlot.getAttribute("src"),
            crop: Editor.cropFor(host ? host.dataset.sect : null, Editor.selectedImageSlot)
          });
          return;
        }
        if (window.EditorUI) EditorUI.openMedia(host ? host.dataset.sect : null, Editor.selectedImageSlot);
        return;
      }

      var section = event.target.closest(".ss-sec");
      if (section) {
        Editor.select(section.dataset.sect);
        return;
      }
      var footer = event.target.closest("[data-foot]");
      if (footer) {
        Editor.select("footer");
      }
    });

    /* photo wall: add, resize and remove pictures.
       These sit on top of the tiles, so they are handled first. */
    Editor.root.addEventListener("click", function (event) {
      var add = event.target.closest("[data-add-tile]");
      if (add) {
        event.preventDefault();
        event.stopPropagation();
        var host = add.closest(".ss-sec");
        Editor.addPhoto(host ? host.dataset.sect : null);
        return;
      }
      var styleBtn = event.target.closest("[data-tile-style]");
      if (styleBtn) {
        event.preventDefault();
        event.stopPropagation();
        var styleTile = styleBtn.closest("[data-tile]");
        Editor.openPhotoSettings(
          Editor.wallSectionOfTile(styleTile),
          Editor.wallIndexOf(styleTile)
        );
        return;
      }
      var sizeBtn = event.target.closest("[data-tile-size]");
      if (sizeBtn) {
        event.preventDefault();
        event.stopPropagation();
        var tile = sizeBtn.closest("[data-tile]");
        Editor.cyclePhotoSize(Editor.wallSectionOfTile(tile), Editor.wallIndexOf(tile));
        return;
      }
      var delBtn = event.target.closest("[data-tile-del]");
      if (delBtn) {
        event.preventDefault();
        event.stopPropagation();
        var gone = delBtn.closest("[data-tile]");
        Editor.removePhoto(Editor.wallSectionOfTile(gone), Editor.wallIndexOf(gone));
        return;
      }
      /* clicking anywhere else on a tile selects its block */
      var anyTile = event.target.closest("[data-tile]");
      if (anyTile) {
        var owner = anyTile.closest(".ss-sec");
        if (owner) Editor.select(owner.dataset.sect);
      }
    });

    /* the grip: click selects, keyboard arrows move the block.
       Dragging is not the only way to reorder - that would lock out
       anyone using a keyboard or a screen reader. */
    Editor.root.addEventListener("click", function (event) {
      var grip = event.target.closest("[data-grip]");
      if (!grip) return;
      var host = grip.closest(".ss-sec");
      if (host) Editor.select(host.dataset.sect);
    });

    Editor.root.addEventListener("keydown", function (event) {
      var grip = event.target.closest("[data-grip]");
      if (!grip) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        /* select first: a keyboard user tabs to the grip and presses an
           arrow without ever clicking, so selectedId may still be stale */
        var host = grip.closest(".ss-sec");
        if (host) Editor.select(host.dataset.sect);
        Editor.command(event.key === "ArrowUp" ? "up" : "down");
        /* keep focus on the grip of the block we just moved */
        var moved = Editor.root.querySelector('.ss-sec[data-sect="' + cssEscape(Editor.selectedId) + '"] [data-grip]');
        if (moved) moved.focus();
      }
    });

    /* clicking away from a selected section clears the toolbar */
    document.addEventListener("click", function (event) {
      if (event.target.closest(".ss-sec") || event.target.closest(".block-toolbar")) return;
      Editor.select(null);
    });

    window.addEventListener("scroll", positionToolbar, { passive: true });
    window.addEventListener("resize", positionToolbar);

    Editor.render();
  };

  Editor.destroy = function () {
    window.removeEventListener("scroll", positionToolbar);
    window.removeEventListener("resize", positionToolbar);
    if (toolbar) { toolbar.remove(); toolbar = null; }
  };

  SS.Editor = Editor;
  window.Editor = Editor;
})();