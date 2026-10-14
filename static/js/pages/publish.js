    (function () {
      var user = API.requireAuth();
      if (!user) return;

      var params = new URLSearchParams(location.search);
      var wantedId = params.get("id");

      function start(proj) {
        var baseUrl = API.baseUrl();
        var slugInput = document.getElementById("slug");
        var pubBtn = document.getElementById("pubBtn");
        var liveBox = document.getElementById("liveBox");

        document.getElementById("projTitle").textContent = proj.name;
        document.getElementById("backToBuilder").href = "builder.html?id=" + proj.id;

        /* ---------- summary ---------- */
        function typeName(id) {
          var t = API.TYPES.filter(function (x) { return x.id === id; })[0];
          return t ? t.name : id;
        }
        var plan = proj.plan_json;
        var secCount = plan.pages.reduce(function (n, p) { return n + p.sections.length; }, 0);
        document.getElementById("kvName").textContent = proj.name;
        document.getElementById("kvType").textContent = typeName(proj.type);
        document.getElementById("kvPages").textContent = plan.pages.length;
        document.getElementById("kvSections").textContent = secCount;
        document.getElementById("kvEdited").textContent = SS.fmtDate(proj.updated_at);

        /* ---------- pre-publish checklist (derived, honest) ---------- */
        function fillChecklist() {
          var items = [];
          items.push({ ok: plan.pages.length > 0, text: "At least one page exists" });
          items.push({ ok: secCount >= 3, text: "At least 3 sections on your pages" });
          var hero = plan.pages[0].sections[0];
          items.push({ ok: !hero || (hero.title && hero.title.length > 3), text: "Homepage headline is written" });
          var empties = 0;
          plan.pages.forEach(function (p) {
            p.sections.forEach(function (s) { if (!s.title || s.title.length < 2) empties++; });
          });
          items.push({ ok: empties === 0, text: empties === 0 ? "Every section has a title" : empties + " section(s) still need a title" });
          document.getElementById("preCheck").innerHTML = items.map(function (i) {
            return '<li class="' + (i.ok ? "done" : "") + '"><span class="box">' +
              (i.ok ? '<i class="bi bi-check-lg" aria-hidden="true"></i>' : "") + "</span>" +
              SS.esc(i.text) + "</li>";
          }).join("");
          return items.every(function (i) { return i.ok; });
        }

        /* ---------- slug ---------- */
        function slugify(v) {
          return v.toLowerCase().trim().replace(/[^a-z0-9-\s]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
        }
        var slugTouched = false;
        slugInput.addEventListener("input", function () {
          slugTouched = true;
          this.value = slugify(this.value);
          document.getElementById("fSlug").classList.remove("invalid");
        });
        function validSlug() { return /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(slugInput.value); }

        /* ---------- status render ---------- */
        function render() {
          document.title = "Publish";
          if (!slugTouched) {
            slugInput.value = proj.slug || slugify(proj.name);
          }

          if (proj.is_published) {
            var url = baseUrl + "/site/" + proj.slug;
            document.getElementById("statusHead").textContent = "Your site is live";
            document.getElementById("statusBlurb").textContent = "Anyone with this link can see it. Republish after edits to push them live.";
            document.getElementById("liveUrl").textContent = url.replace(/\//g, "/\u200B");
            document.getElementById("openLink").href = url;
            document.getElementById("viewCount").textContent = "Demo · " + proj.view_count + " view" + (proj.view_count === 1 ? "" : "s");
            liveBox.hidden = false;
            pubBtn.innerHTML = '<i class="bi bi-arrow-repeat" aria-hidden="true"></i> Republish changes';
            slugInput.disabled = false;
          } else {
            document.getElementById("statusHead").textContent = "Not published yet";
            document.getElementById("statusBlurb").textContent = "Your plan compiles into a real website; it just needs an address.";
            liveBox.hidden = true;
            pubBtn.innerHTML = '<i class="bi bi-rocket-takeoff" aria-hidden="true"></i> Publish site';
            slugInput.disabled = false;
          }
          fillChecklist();
        }

        /* ---------- compile ----------
           The plan is turned into finished HTML here, in the browser, because
           site.js is the only renderer we have and it is written in
           JavaScript. Doing it at publish time rather than per request means
           the server never has to run it and the visitor gets a static file.

           generated.css is fetched once and inlined into every page so a
           published page is one self-contained document. */
        var siteCss = null;
        function loadSiteCss() {
          if (siteCss) return Promise.resolve(siteCss);
          return fetch("static/css/generated.css")
            .then(function (r) {
              if (!r.ok) throw new Error("could not load the site stylesheet");
              return r.text();
            })
            .then(function (text) { siteCss = text; return text; });
        }

        function compile() {
          var slug = slugInput.value;
          return loadSiteCss().then(function (css) {
            var built = SS.compileSite(plan, {
              pageBase: "/site/" + slug,
              css: css
            });
            var keys = Object.keys(built.pages || {});
            if (!keys.length) throw new Error("this plan has no pages to publish");
            return built;
          });
        }

        /* ---------- publish flow ---------- */
        pubBtn.addEventListener("click", function () {
          var f = document.getElementById("fSlug");
          if (!validSlug()) {
            f.classList.add("invalid");
            slugInput.focus();
            return;
          }
          var republish = proj.is_published;
          pubBtn.disabled = true;
          pubBtn.innerHTML = '<i class="bi bi-arrow-repeat spin" aria-hidden="true"></i> ' +
            (republish ? "Republishing…" : "Compiling…");

          compile().then(function (built) {
            return API.setPublished(proj.id, true, slugInput.value, built.pages, built.home);
          }).then(function (res) {
            if (!res.ok) {
              pubBtn.disabled = false;
              render();
              SS.toast(res.error || "Could not publish", "bi-exclamation-triangle");
              return;
            }
            proj = res.project;
            pubBtn.disabled = false;
            render();
            SS.toast(republish ? "Changes pushed live" : "Published! Your site is live", "bi-rocket-takeoff");
          }).catch(function (err) {
            pubBtn.disabled = false;
            render();
            SS.toast(err.message || "Could not publish", "bi-exclamation-triangle");
          });
        });

        document.getElementById("unpubBtn").addEventListener("click", function () {
          /* two-step confirm: first press arms the button */
          if (this.dataset.armed !== "1") {
            var el = this;
            el.dataset.armed = "1";
            el.classList.add("is-armed");
            SS.toast("Click Unpublish again to take the site offline", "bi-exclamation-triangle");
            setTimeout(function () {
              if (el.dataset.armed === "1") { el.dataset.armed = "0"; el.classList.remove("is-armed"); }
            }, 3000);
            return;
          }
          this.dataset.armed = "0";
          this.classList.remove("is-armed");
          API.setPublished(proj.id, false).then(function (res) {
            if (!res.ok) {
              SS.toast(res.error || "Could not take the site offline", "bi-exclamation-triangle");
              return;
            }
            proj = res.project;
            render();
            SS.toast("Site taken offline", "bi-cloud-slash");
          });
        });

        function fallbackCopy(url) {
          var ta = document.createElement("textarea");
          ta.value = url;
          ta.style.cssText = "position:fixed;opacity:0;top:0;left:0;";
          document.body.appendChild(ta);
          ta.select();
          var ok = false;
          try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
          document.body.removeChild(ta);
          SS.toast(ok ? "Link copied" : "Press Ctrl+C to copy the link shown above", ok ? "bi-copy" : "bi-link-45deg");
        }

        document.getElementById("copyBtn").addEventListener("click", function () {
          var url = baseUrl + "/site/" + proj.slug;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(
              function () { SS.toast("Link copied", "bi-copy"); },
              function () { fallbackCopy(url); }
            );
          } else fallbackCopy(url);
        });

        /* Export is not built. The button is disabled and says so in publish.html,
           and this listener only exists for the case where it somehow fires
           anyway - in which case the honest sentence is better than the old
           one, which mentioned a backend and a phase and left a person
           none the wiser about whether anything was going to happen. */
        document.getElementById("zipBtn").addEventListener("click", function () {
          SS.toast("A downloadable copy is not built yet. Your site is live at the address above.",
                   "bi-info-circle");
        });

        render();
      }

      function noProject() {
        SS.toast("That plan could not be found", "bi-exclamation-triangle");
        location.href = "dashboard.html";
      }

      if (wantedId) {
        API.getProject(wantedId).then(function (res) {
          if (!res.ok || !res.project) return noProject();
          start(res.project);
        });
      } else {
        API.listProjects().then(function (res) {
          if (!res.projects || !res.projects.length) return noProject();
          start(res.projects[0]);
        });
      }
    })();
