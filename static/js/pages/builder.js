    (function () {
      var user = API.requireAuth();
      if (!user) return;

      var params = new URLSearchParams(location.search);
      var wantedId = params.get("id");
      var plan = null;
      var pageIndex = 0;
      var saveTimer = null;

      var canvas = document.getElementById("canvas");
      var saveState = document.getElementById("saveState");

      function currentPage() { return plan.pages[pageIndex]; }

      /* ---------------- live site freshness ----------------
         Publishing stores a finished copy of the page, because a published
         site runs no JavaScript and cannot be recompiled in the browser of
         whoever visits it. That is the right design, but it means an edit
         here does not reach visitors until the next publish - and the
         builder said nothing at all about it. Someone changed their brand
         colour, opened their live site, and found the old colour there.

         So the editor says so. The comparison is updated_at against
         published_at, both of which the API already returns. */
      var liveStale = document.getElementById("liveStale");
      var livePublishedAt = null;
      var liveIsPublished = false;

      function refreshLiveState(project) {
        if (!project) return;
        liveIsPublished = !!project.is_published;
        livePublishedAt = project.published_at || null;
        paintLiveState(project.updated_at);
      }

      function paintLiveState(updatedAt) {
        if (!liveStale) return;
        var behind = liveIsPublished && !!livePublishedAt &&
                     updatedAt > livePublishedAt;
        liveStale.hidden = !behind;
        if (behind) {
          liveStale.setAttribute("title",
            "Your live site still shows the version from " +
            new Date(livePublishedAt).toLocaleString() +
            ". Republishing sends these edits to visitors.");
        }
      }

      if (liveStale) {
        liveStale.addEventListener("click", function (e) {
          e.preventDefault();
          location.href = "publish.html?id=" + plan.id;
        });
      }

      /* ---------------- saving ---------------- */
      function markDirty() {
        saveState.classList.add("dirty");
        saveState.innerHTML = '<span class="pip"></span> Saving…';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
          API.savePlan(plan.id, plan).then(function (res) {
            saveState.classList.remove("dirty");
            if (!res.ok) {
              saveState.innerHTML = '<span class="pip"></span> Not saved';
              SS.toast(res.error || "Could not save", "bi-exclamation-triangle");
              return;
            }
            saveState.innerHTML = '<span class="pip"></span> Saved';
            /* the save moved updated_at forward, so a published site is now
               behind the editor */
            if (res.project) refreshLiveState(res.project);
          });
        }, 700);
      }

      function changed() {
        markDirty();
        pushPreview();
        /* recorded after the write, but before the next one, so the
           snapshot it keeps is always "where we were before this step" */
        History.record(plan);
      }

      /* ---------------- undo and redo ----------------
         Restoring is deliberately not routed through changed(): that
         would record the undo as a new edit and immediately make redo
         impossible. It saves and previews, but it does not re-enter
         history. */

      function restore() {
        /* Buffered contenteditable text belongs to the step we just
           discarded. Left in place it is re-applied on the next render
           and quietly overwrites what undo restored. */
        Editor.forgetText();

        /* the undone state may have fewer pages, or none of the section
           that was selected */
        pageIndex = Math.max(0, Math.min(pageIndex, plan.pages.length - 1));
        var page = currentPage();
        if (page) {
          Editor.pageId = page.id;
          var stillThere = Editor.selectedId &&
            (Editor.selectedId === "footer" ||
             page.sections.some(function (s) { return s.id === Editor.selectedId; }));
          if (!stillThere) Editor.selectedId = null;
        }

        render();
        markDirty();
        pushPreview();
        Editor.positionToolbar();
      }

      function undo() {
        if (History.undo(plan)) {
          restore();
          SS.toast("Undone", "bi-arrow-counterclockwise");
        }
      }

      function redo() {
        if (History.redo(plan)) {
          restore();
          SS.toast("Redone", "bi-arrow-clockwise");
        }
      }

      document.getElementById("undoBtn").addEventListener("click", undo);
      document.getElementById("redoBtn").addEventListener("click", redo);

      /* Ctrl+Z / Ctrl+Shift+Z, plus the Cmd variants for macOS.
         Skipped while typing: the browser's own text undo is the right
         one inside a contenteditable, and hijacking it there would
         make a half-finished sentence un-undoable. */
      document.addEventListener("keydown", function (event) {
        var key = (event.key || "").toLowerCase();
        if (key !== "z" && key !== "y") return;
        if (!(event.ctrlKey || event.metaKey)) return;
        if (Editor.editing) return;
        if (document.activeElement && /^(input|textarea|select)$/i.test(document.activeElement.tagName)) return;

        /* redo is Ctrl+Shift+Z, and Ctrl+Y for people whose keyboards
           have no second Z worth reaching */
        var isRedo = key === "y" || event.shiftKey;
        if (key === "y" && !event.ctrlKey) return;
        event.preventDefault();
        if (isRedo) redo(); else undo();
      });

      /* ---------------- pages ---------------- */
      function renderTabs() {
        var host = document.getElementById("pageTabs");
        host.innerHTML = "";
        plan.pages.forEach(function (page, i) {
          var tab = document.createElement("button");
          tab.type = "button";
          tab.className = "tab" + (i === pageIndex ? " is-on" : "");
          tab.setAttribute("role", "tab");
          tab.setAttribute("aria-selected", String(i === pageIndex));
          tab.innerHTML = SS.esc(page.name) +
            (plan.pages.length > 1 ? '<i class="bi bi-x-lg tab-del" data-del="' + i + '" aria-label="Delete page"></i>' : "");
          tab.addEventListener("click", function (event) {
            if (event.target.closest("[data-del]")) return;
            pageIndex = i;
            render();
          });
          tab.addEventListener("dblclick", function () { renameTab(tab, i); });
          host.appendChild(tab);
        });
        host.querySelectorAll("[data-del]").forEach(function (icon) {
          icon.addEventListener("click", function (event) {
            event.stopPropagation();
            var i = parseInt(icon.getAttribute("data-del"), 10);
            deletePage(i);
          });
        });
      }

      function renameTab(tab, i) {
        var page = plan.pages[i];
        var input = document.createElement("input");
        input.className = "tab-rename";
        input.value = page.name;
        tab.replaceWith(input);
        input.focus();
        input.select();
        var done = false;
        function commit(save) {
          if (done) return;
          done = true;
          if (save && input.value.trim()) page.name = input.value.trim().slice(0, 40);
          render();
          changed();
        }
        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter") commit(true);
          if (event.key === "Escape") commit(false);
        });
        input.addEventListener("blur", function () { commit(true); });
      }

      function deletePage(i) {
        if (plan.pages.length === 1) { SS.toast("A site needs at least one page", "bi-info-circle"); return; }
        plan.pages.splice(i, 1);
        pageIndex = Math.max(0, pageIndex - 1);
        render();
        changed();
        SS.toast("Page deleted", "bi-trash3");
      }

      document.getElementById("addPage").addEventListener("click", function () {
        plan.pages.push({ id: "p_" + Math.random().toString(36).slice(2, 7), name: "Page " + (plan.pages.length + 1), sections: [] });
        pageIndex = plan.pages.length - 1;
        render();
        changed();
      });

      /* ---------------- section library ---------------- */
      var GROUPS = {
        structure: ["hero", "about", "cta", "contact", "faq", "hours", "newsletter"],
        content: ["images", "features", "gallery", "products", "menu", "testimonials", "team", "blog"]
      };

      function buildPalette(host, keys) {
        host.innerHTML = "";
        keys.forEach(function (key) {
          var def = API.SECTIONS[key];
          if (!def) return;
          var button = document.createElement("button");
          button.type = "button";
          button.className = "rec-item palette-item";
          button.innerHTML = '<span class="ri"><i class="bi ' + def.icon + '" aria-hidden="true"></i></span>' +
            "<span><strong>" + SS.esc(def.name) + "</strong><small>" + SS.esc(def.blurb) + "</small></span>";
          button.addEventListener("click", function () { EditorUI.addSection(key); render(); });
          host.appendChild(button);
        });
      }

      /* ---------------- AI ---------------- */
      function aiSection(section) {
        section.title = "";
        section.subtitle = "";
        API.fillSection(section, plan.meta).then(function () {
          render();
          changed();
          SS.toast("Written with AI", "bi-lightning");
        });
      }

      /* ---------------- styles panel ---------------- */
      document.getElementById("stylesBtn").addEventListener("click", function () {
        if (!shell.classList.contains("panel-closed") && panelMode === "styles") closePanel();
        else openPanel("styles");
      });
      document.getElementById("footerBtn").addEventListener("click", function () {
        if (!shell.classList.contains("panel-closed") && panelMode === "footer") closePanel();
        else openPanel("footer");
      });
      document.getElementById("menuBtn").addEventListener("click", function () {
        if (!shell.classList.contains("panel-closed") && panelMode === "menu") closePanel();
        else openPanel("menu");
      });
      document.getElementById("panelClose").addEventListener("click", closePanel);

      /* the left rail collapses too, so the page can use the whole screen */
      var railToggle = document.getElementById("railToggle");
      railToggle.addEventListener("click", function () {
        var closed = shell.classList.toggle("rail-closed");
        this.setAttribute("aria-expanded", String(!closed));
        this.setAttribute("aria-label", closed ? "Show the sidebar" : "Hide the sidebar");
        this.title = closed ? "Show the sidebar" : "Hide the sidebar";
        Editor.positionToolbar();
      });

      /* preview mode: every bit of editor chrome out of the way */
      var focusBtn = document.getElementById("focusBtn");
      function setFocus(on) {
        document.body.classList.toggle("is-focus", on);
        focusBtn.setAttribute("aria-pressed", String(on));
        focusBtn.innerHTML = on
          ? '<i class="bi bi-pencil" aria-hidden="true"></i> Edit'
          : '<i class="bi bi-arrows-fullscreen" aria-hidden="true"></i> Preview';
        if (on) {
          var exit = document.createElement("button");
          exit.className = "btn btn-sm focus-exit";
          exit.type = "button";
          exit.innerHTML = '<i class="bi bi-pencil" aria-hidden="true"></i> Back to editing';
          exit.addEventListener("click", function () { setFocus(false); });
          document.body.appendChild(exit);
          window.__focusExit = exit;
        } else if (window.__focusExit) {
          window.__focusExit.remove();
          window.__focusExit = null;
        }
        Editor.positionToolbar();
      }
      focusBtn.addEventListener("click", function () {
        setFocus(!document.body.classList.contains("is-focus"));
      });
      document.getElementById("publishBtn").addEventListener("click", function () {
        location.href = "publish.html?id=" + plan.id;
      });

      document.getElementById("siteName").addEventListener("input", function () {
        plan.meta.siteName = this.value;
        changed();
      });

      /* ---------------- drag to reorder sections ----------------
         Sortable must be attached to the element that directly contains
         the sections (main inside the rendered site), not the canvas -
         otherwise it measures the nav and footer as draggable slots. */
      var sortable = null;
      function sectionList() {
        return canvas.querySelector(".ss-site main") || canvas;
      }
      function wireSortable() {
        if (sortable) { sortable.destroy(); sortable = null; }
        if (typeof Sortable === "undefined") return;
        var list = sectionList();
        if (!list.querySelector(".ss-sec")) return;
        sortable = Sortable.create(list, {
          handle: ".sec-grip",
          draggable: ".ss-sec",
          ghostClass: "is-ghost",
          chosenClass: "is-chosen",
          dragClass: "is-dragging",
          animation: 160,
          /* mouse-event dragging rather than HTML5 drag-and-drop:
             works with touch and pen, and behaves the same everywhere */
          forceFallback: true,
          fallbackTolerance: 4,
          fallbackOnBody: true,
          scroll: true,
          /* clicking the grip selects the block, matching the page */
          onStart: function () {
            var el = this.el;
            if (el && el.dataset.sect) Editor.select(el.dataset.sect);
          },
          onEnd: function (event) {
            var page = currentPage();
            var from = event.oldIndex, to = event.newIndex;
            if (from === to || from === undefined || to === undefined) return;
            var moved = page.sections.splice(from, 1)[0];
            page.sections.splice(to, 0, moved);
            render();
            changed();
          }
        });
      }

      /* ---------------- the right-hand panel ----------------
         One sidebar with three modes: site-wide Design, the settings for
         whichever block is selected, and the footer. It lives on the right
         and starts open, and can be closed to see the whole site. */
      var panelMode = "styles";
      var photoTarget = null;
      var panelBody = document.getElementById("panelBody");
      var panelTitle = document.getElementById("panelTitle");
      var shell = document.getElementById("shell");
      var PANEL_TITLES = { styles: "Design", block: "This section", footer: "Footer", menu: "Menu" };

      function openPanel(mode) {
        panelMode = mode;
        shell.classList.remove("panel-closed");
        panelTitle.textContent = PANEL_TITLES[mode] || "Design";
        document.getElementById("stylesBtn").setAttribute("aria-pressed", String(mode === "styles"));
        document.getElementById("footerBtn").setAttribute("aria-pressed", String(mode === "footer"));
        document.getElementById("menuBtn").setAttribute("aria-pressed", String(mode === "menu"));
        renderPanel();
      }

      function closePanel() {
        shell.classList.add("panel-closed");
        ["stylesBtn", "footerBtn", "menuBtn"].forEach(function (id) {
          document.getElementById(id).setAttribute("aria-pressed", String(false));
        });
      }

      function renderPanel() {
        if (shell.classList.contains("panel-closed")) return;
        if (panelMode === "photo") {
          panelTitle.textContent = "Photo";
          EditorUI.photoPanel(panelBody, photoTarget && photoTarget.sectionId, photoTarget && photoTarget.index);
        } else if (panelMode === "footer") EditorUI.footerPanel(panelBody);
        else if (panelMode === "menu") EditorUI.menuPanel(panelBody);
        else if (panelMode === "block") EditorUI.blockPanel(panelBody);
        else EditorUI.stylesPanel(panelBody);

        /* Whichever panel just rendered, give every colour control in it a
           chip that opens SiteSketch's picker. Done here rather than in
           each panel so no panel has to know the picker exists, and so a
           panel added later gets it for free. */
        EditorUI.enhanceColourInputs(panelBody);
      }

      /* ---------------- render ---------------- */
      function render() {
        renderTabs();
        document.getElementById("siteName").value = plan.meta.siteName;
        var page = currentPage();
        Editor.pageId = page.id;
        Editor.render();
        wireSortable();
        renderPanel();
        pushPreview();
      }

      /* ---------------- device preview ----------------
         A phone-sized column has to be a real iframe, not a narrow div:
         the generated site collapses itself with media queries, and those
         only fire against the document width. */
      var DEVICES = {
        mobile: { w: 390, h: 780, label: "iPhone 390 px" },
        tablet: { w: 820, h: 1000, label: "Tablet 820 px" },
        desktop: { w: 0, h: 0, label: "Desktop" }
      };
      var device = "desktop";

      var deviceFrame = document.getElementById("deviceFrame");
      var deviceChrome = document.getElementById("deviceChrome");
      var previewFrame = document.getElementById("previewFrame");

      function setDevice(next) {
        device = DEVICES[next] ? next : "desktop";
        var info = DEVICES[device];

        document.querySelectorAll(".device-btn").forEach(function (b) {
          var on = b.dataset.device === device;
          b.classList.toggle("is-on", on);
          b.setAttribute("aria-pressed", String(on));
        });

        var isDesktop = device === "desktop";
        deviceFrame.hidden = isDesktop;
        canvas.hidden = !isDesktop;

        if (!isDesktop) {
          deviceFrame.style.setProperty("--device-w", info.w + "px");
          deviceFrame.style.setProperty("--device-h", info.h + "px");
          deviceChrome.textContent = info.w + " \u00d7 " + info.h;
          pushPreview();
        }
        Editor.positionToolbar();
      }

      function pushPreview() {
        if (!plan || deviceFrame.hidden) return;
        var frame = previewFrame.contentWindow;
        if (!frame) return;
        try {
          frame.postMessage(
            { type: "render", plan: plan, pageId: Editor.pageId },
            location.origin
          );
        } catch (e) { /* the frame may still be loading */ }
      }

      document.querySelectorAll(".device-btn").forEach(function (button) {
        button.addEventListener("click", function () { setDevice(button.dataset.device); });
      });

      window.addEventListener("message", function (event) {
        if (event.data && event.data.type === "preview-ready") pushPreview();
      });

      previewFrame.addEventListener("load", pushPreview);

      /* ---------------- first-run hints ----------------
         Drag handles, inline editing and preview are all invisible until
         you happen to hover the right pixel, so we say them once. */
      var HINT_KEY = "sitesketch_builder_hints_v1";
      function showHints() {
        var seen = false;
        try { seen = localStorage.getItem(HINT_KEY) === "1"; } catch (e) { /* ignore */ }
        if (seen) return;

        var bar = document.createElement("div");
        bar.className = "builder-hints";
        bar.innerHTML =
          '<span class="hint-item"><i class="bi bi-grip-vertical" aria-hidden="true"></i> ' +
            "Drag a handle to move a block</span>" +
          '<span class="hint-item"><i class="bi bi-fonts" aria-hidden="true"></i> ' +
            "Click any text to type</span>" +
          '<span class="hint-item"><i class="bi bi-image" aria-hidden="true"></i> ' +
            "Click a photo to swap or crop it</span>" +
          '<span class="hint-item"><i class="bi bi-arrows-fullscreen" aria-hidden="true"></i> ' +
            "Preview shows the whole site</span>" +
          '<button type="button" class="hint-dismiss" aria-label="Hide these tips">Got it</button>';
        document.body.appendChild(bar);
        bar.querySelector(".hint-dismiss").addEventListener("click", function () {
          bar.remove();
          try { localStorage.setItem(HINT_KEY, "1"); } catch (e) { /* ignore */ }
        });
      }

      /* ---------------- boot ----------------
         The builder is reachable from the plan flow, but also directly by
         url, so it must survive a project whose plan_json is empty or
         half-written. Anything missing is rebuilt from the project row. */

      function sectionFrom(key, i) {
        var def = API.SECTIONS[key] || {};
        return {
          id: "s_" + Math.random().toString(36).slice(2, 9),
          type: key,
          title: def.name || "Section",
          subtitle: def.blurb || "",
          fields: {},
          items: window.EditorUI ? EditorUI.startersFor(key) : [],
          ready: 0
        };
      }

      function normalise(project) {
        var p = (project.plan_json && typeof project.plan_json === "object") ? project.plan_json : {};
        p.id = project.id;
        p.meta = p.meta || {};
        p.meta.type = p.meta.type || project.type || "business";
        p.meta.goal = p.meta.goal || project.goal || "";
        p.meta.theme = p.meta.theme || project.theme || "modern";
        p.meta.siteName = p.meta.siteName || project.name || "My Website";
        p.pages = Array.isArray(p.pages) ? p.pages.filter(function (page) { return page && page.id; }) : [];

        if (!p.pages.length) {
          var keys = API.recommendedFor(p.meta.type);
          p.pages = [{
            id: "home",
            name: "Home",
            sections: keys.map(sectionFrom)
          }];
        }
        p.pages.forEach(function (page) {
          page.name = page.name || "Page";
          page.sections = Array.isArray(page.sections) ? page.sections : [];
          page.sections.forEach(function (s) {
            if (!s || !s.type) return;
            s.fields = s.fields || {};
            s.id = s.id || "s_" + Math.random().toString(36).slice(2, 9);
            /* list blocks are unusable when empty */
            if (!Array.isArray(s.items) || !s.items.length) {
              s.items = window.EditorUI ? EditorUI.startersFor(s.type) : [];
            }
          });
        });
        return p;
      }

      function start(project) {
        plan = normalise(project);
        refreshLiveState(project);

        /* history is seeded with the state as it was on arrival, so the
           very first edit can be taken back */
        History.onRestore = restore;
        History.reset(plan);

        Editor.mount({
          root: canvas,
          plan: plan,
          pageId: plan.pages[0].id,
          onChange: changed,
          onSelectionChange: function () { renderPanel(); },
          onOpenSettings: function (id) {
            Editor.select(id);
            openPanel(id === "footer" ? "footer" : "block");
          },
          onOpenPhoto: function (sectionId, index) {
            Editor.select(sectionId);
            openPanel("photo");
            photoTarget = { sectionId: sectionId, index: index };
            renderPanel();
          },
          onAI: aiSection
        });

        buildPalette(document.getElementById("paletteStructure"), GROUPS.structure);
        buildPalette(document.getElementById("paletteContent"), GROUPS.content);
        render();
        /* design controls live on the right and start open, so the page is
           the first thing you see rather than a wall of buttons */
        openPanel("styles");
        showHints();
      }

      if (wantedId) {
        API.getProject(wantedId).then(function (res) {
          if (res.ok && res.project) start(res.project);
          else location.href = "dashboard.html";
        });
      } else {
        API.listProjects().then(function (res) {
          if (res.ok && res.projects.length) start(res.projects[0]);
          else location.href = "plan.html";
        });
      }
    })();
