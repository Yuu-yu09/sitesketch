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
    if (!sectionId) return page.sections[0] || null;
    return page.sections.filter(function (s) { return s.id === sectionId; })[0] || null;
  }

  function resolve(plan, pageId, sectionId, path) {
    var section = sectionOf(plan, pageId, sectionId);
    if (!section) return null;
    var parts = String(path).split(":");

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
    if (t.items) return (t.section.items[t.index] || {})[t.field] || "";
    return t.section[t.key] || "";
  }

  function writeValue(plan, pageId, sectionId, path, value) {
    var t = resolve(plan, pageId, sectionId, path);
    if (!t) return false;
    if (t.key === "fields") {
      t.section.fields = t.section.fields || {};
      t.section.fields[t.field] = value;
    } else if (t.items) {
      t.section.items[t.index][t.field] = value;
    } else {
      t.section[t.key] = value;
    }
    return true;
  }

  /* the section a DOM node belongs to */
  function sectionIdOf(node) {
    var host = node && node.closest ? node.closest(".ss-sec") : null;
    return host ? host.dataset.sect : null;
  }

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

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, "\\$&");
  }

  Editor.markSelection = function () {
    Array.prototype.forEach.call(Editor.root.querySelectorAll(".ss-sec"), function (node) {
      node.classList.toggle("is-selected", node.dataset.sect === Editor.selectedId);
    });
  };

  Editor.select = function (id) {
    Editor.selectedId = id;
    Editor.markSelection();
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
    if (Editor.onChange) Editor.onChange(slot);
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
    return toolbar;
  }

  function positionToolbar() {
    var bar = ensureToolbar();
    if (!Editor.selectedId || !Editor.root) { bar.hidden = true; return; }
    var section = Editor.root.querySelector('.ss-sec[data-sect="' + cssEscape(Editor.selectedId) + '"]');
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
    } else if (what === "ai") {
      if (Editor.onAI) Editor.onAI(section);
      return;
    }
    /* structure changed: repaint the page, then let the host save */
    Editor.render();
    positionToolbar();
    if (Editor.onChange) Editor.onChange("structure");
  };

  /* ---------------- wiring ---------------- */

  Editor.mount = function (options) {
    Editor.root = options.root;
    Editor.plan = options.plan;
    Editor.pageId = options.pageId;
    Editor.onChange = options.onChange || null;
    Editor.onSelectionChange = options.onSelectionChange || null;
    Editor.onAI = options.onAI || null;

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
        if (window.EditorUI) EditorUI.openMedia(host ? host.dataset.sect : null, imageSlot.dataset.imgSlot);
        return;
      }

      var section = event.target.closest(".ss-sec");
      if (section) {
        Editor.select(section.dataset.sect);
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