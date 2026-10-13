    (function () {
      var user = API.requireAuth();
      if (!user) return;
      document.getElementById("userName").textContent = user.name;
      document.querySelector("#userChip .av").textContent = user.name.charAt(0).toUpperCase();
      document.getElementById("logoutBtn").addEventListener("click", function () {
        API.logout();
        location.href = "index.html";
      });

      /* state */
      var state = { type: null, goal: null, selected: [], siteName: "", plan: null };

      /* ---------- steps ---------- */
      function goStep(n) {
        [1, 2, 3].forEach(function (i) {
          document.getElementById("step" + i).hidden = i !== n;
        });
        document.querySelectorAll("#steps li").forEach(function (li) {
          var s = +li.getAttribute("data-step");
          li.classList.toggle("done", s < n);
          if (s === n) li.setAttribute("aria-current", "step");
          else li.removeAttribute("aria-current");
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      /* ---------- step 1: types ---------- */
      var typeGrid = document.getElementById("typeGrid");
      API.TYPES.forEach(function (t) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "type-card";
        b.setAttribute("aria-pressed", "false");
        b.innerHTML =
          '<span class="ti"><i class="bi ' + t.icon + '" aria-hidden="true"></i></span>' +
          "<strong>" + SS.esc(t.name) + "</strong><span>" + SS.esc(t.desc) + "</span>";
        b.addEventListener("click", function () {
          state.type = t.id;
          state.goal = null;
          typeGrid.querySelectorAll(".type-card").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          setTimeout(function () { renderGoals(); goStep(2); }, 180);
        });
        typeGrid.appendChild(b);
      });

      /* ---------- step 2: goals ---------- */
      function renderGoals() {
        var typeName = API.TYPES.filter(function (t) { return t.id === state.type; })[0].name;
        document.getElementById("goalFor").textContent = "The one thing this " + typeName + " website should do.";
        var list = document.getElementById("goalList");
        list.innerHTML = "";
        API.goalsFor(state.type).forEach(function (g) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "goal-pill";
          b.setAttribute("aria-pressed", "false");
          b.innerHTML = '<span class="radio" aria-hidden="true"></span>' + SS.esc(g.name);
          b.addEventListener("click", function () {
            state.goal = g.id;
            list.querySelectorAll(".goal-pill").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
            b.setAttribute("aria-pressed", "true");
            document.getElementById("next2").disabled = false;
          });
          list.appendChild(b);
        });
        document.getElementById("next2").disabled = true;
      }

      document.getElementById("back2").addEventListener("click", function () { goStep(1); });
      document.getElementById("next2").addEventListener("click", function () { renderRecs(); goStep(3); });

      /* ---------- step 3: recommendations ---------- */
      function ensurePlan() {
        if (!state.plan) state.plan = makeStarterPlan();
        return state.plan;
      }

      function makeStarterPlan() {
        return {
          meta: { type: state.type, goal: state.goal, theme: "modern", siteName: state.siteName || "" },
          pages: [{ id: "home", name: "Home", sections: [] }]
        };
      }

      function renderRecs() {
        if (!state.siteName) {
          var guess = { business: "My Business", portfolio: "My Portfolio", restaurant: "My Restaurant", store: "My Store", school: "My Project", blog: "My Blog" };
          state.siteName = guess[state.type] || "My Website";
        }
        document.getElementById("siteName").value = state.siteName;

        var recs = API.recommendedFor(state.type);
        if (!state.selected.length) state.selected = recs.slice();

        var list = document.getElementById("recList");
        list.innerHTML = "";

        recs.forEach(function (key) {
          var s = API.SECTIONS[key];
          var checked = state.selected.indexOf(key) !== -1;
          var item = document.createElement("label");
          item.className = "rec-item";
          item.setAttribute("for", "sec_" + key);
          item.innerHTML =
            '<span class="ri"><i class="bi ' + s.icon + '" aria-hidden="true"></i></span>' +
            "<span><strong>" + SS.esc(s.name) + "</strong><small>" + SS.esc(s.blurb) + "</small></span>" +
            '<input type="checkbox" id="sec_' + key + '"' + (checked ? " checked" : "") +
            ' aria-label="Include ' + SS.esc(s.name) + '">';
          item.querySelector("input").addEventListener("change", function () {
            if (this.checked) { if (state.selected.indexOf(key) === -1) state.selected.push(key); }
            else state.selected = state.selected.filter(function (k) { return k !== key; });
            updateFinish();
          });
          list.appendChild(item);
        });

        updateFinish();
      }

      function updateFinish() {
        var nameOk = document.getElementById("siteName").value.trim().length > 0;
        document.getElementById("finish").disabled = !(state.selected.length && nameOk);
      }

      document.getElementById("siteName").addEventListener("input", function () {
        state.siteName = this.value;
        document.getElementById("fSiteName").classList.remove("invalid");
        updateFinish();
      });

      document.getElementById("back3").addEventListener("click", function () { goStep(2); });

      document.getElementById("finish").addEventListener("click", function () {
        if (!state.siteName.trim()) {
          document.getElementById("fSiteName").classList.add("invalid");
          return;
        }
        var plan = state.plan || makeStarterPlan();
        plan.meta.type = state.type;
        plan.meta.goal = state.goal;
        plan.meta.siteName = state.siteName.trim();

        /* keep AI-drafted sections, top them up with the selection */
        var home = plan.pages[0];
        var have = home.sections.map(function (s) { return s.type; });
        state.selected.forEach(function (key) {
          if (have.indexOf(key) === -1) {
            var s = API.SECTIONS[key];
            home.sections.push({
              id: "s_" + Math.random().toString(36).slice(2, 9),
              type: key,
              title: s.name,
              subtitle: s.blurb,
              fields: {},
              ready: 0
            });
          }
        });
        home.sections = home.sections.filter(function (s) { return state.selected.indexOf(s.type) !== -1; });

        API.createProject(plan.meta.siteName, state.type, state.goal).then(function (res) {
          if (!res.ok) {
            SS.toast(res.error || "Could not create the plan", "bi-exclamation-triangle");
            return;
          }
          var proj = res.project;
          return API.savePlan(proj.id, plan).then(function () {
            location.href = "builder.html?id=" + proj.id;
          });
        });
      });

      /* ---------- AI path ---------- */
      document.getElementById("aiBtn").addEventListener("click", function () {
        var desc = document.getElementById("aiDesc").value.trim();
        var btn = this;
        if (desc.length < 8) {
          SS.toast("Describe your site in a sentence first", "bi-lightning");
          document.getElementById("aiDesc").focus();
          return;
        }
        btn.disabled = true;
        btn.innerHTML = '<i class="bi bi-arrow-repeat spin" aria-hidden="true"></i> Generating…';
        document.getElementById("aiNote").hidden = false;

        API.generatePlan(desc).then(function (res) {
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-lightning" aria-hidden="true"></i> Generate my plan';
          document.getElementById("aiNote").hidden = true;

          if (!res.ok) {
            SS.toast(
              res.error === "ai_unavailable"
                ? "The writing service is unreachable right now — pick a type instead"
                : (res.error || "Could not draft that plan"),
              "bi-exclamation-triangle"
            );
            return;
          }

          var draft = res.result;
          state.type = draft.type;
          state.goal = draft.goal;
          state.plan = API.planFromDraft(draft);
          state.selected = state.plan.pages[0].sections.map(function (s) { return s.type; });
          state.siteName = state.plan.meta.siteName;

          typeGrid.querySelectorAll(".type-card").forEach(function (x, i) {
            x.setAttribute("aria-pressed", API.TYPES[i].id === draft.type ? "true" : "false");
          });

          renderRecs();
          goStep(3);

          /* Say which one it was. The writing service can be slow enough
             that the plan is served from our own copy library instead, and
             telling someone the model wrote words it did not write is not
             a small thing to get wrong. */
          if (draft.source === "fallback") {
            SS.toast(
              "The writing service was slow, so we drafted it from our templates — edit anything you like",
              "bi-info-circle"
            );
          } else {
            SS.toast("Drafted as a " + draft.type + " site — review it below", "bi-lightning");
          }
        });
      });
    })();
