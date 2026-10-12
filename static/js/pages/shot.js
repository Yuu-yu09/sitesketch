    var qs = new URLSearchParams(location.search);
    var page = qs.get("page") || "index.html";
    var walk = qs.get("walk");
    var signin = qs.get("signin");
    var w = parseInt(qs.get("w") || "390", 10);
    var h = parseInt(qs.get("h") || "844", 10);
    var f = document.getElementById("f");
    f.style.width = w + "px";
    f.style.height = h + "px";

    /* signin=1: get a real session so authenticated pages can be captured.
       There is no demo door - this registers a dedicated capture account
       (shot@local.test) and signs in with it, exactly like a person would. */
    var CAPTURE = { username: "shot", email: "shot@local.test", password: "capture-account-1" };

    function signIn() {
      return fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(CAPTURE)
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (created) {
          if (created && created.token) return created;
          return fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: CAPTURE.email, password: CAPTURE.password })
          }).then(function (r) { return r.ok ? r.json() : null; });
        })
        .then(function (session) {
          if (!session || !session.token) return false;
          localStorage.setItem("sitesketch_token_v1", session.token);
          localStorage.setItem("sitesketch_user_v1", JSON.stringify(Object.assign({}, session.user, {
            name: session.user.name || session.user.username
          })));
          return true;
        })
        .catch(function () { return false; });
    }

    /* walk=plan: click through the wizard (type -> goal -> step 3) after load,
       so captures can show step 3 instead of the landing step.

       walk=block: in the builder, select a section and open its settings,
       so captures show the block settings panel in action. */
    function maybeWalk() {
      if (walk === "block") return walkBuilder();
      if (walk === "footer") return walkFooter();
      if (walk !== "plan") return;
      var doc;
      try { doc = f.contentDocument; } catch (e) { return; }
      if (!doc || !doc.getElementById("typeGrid")) return; // not on plan yet
      if (window.__walk) return;
      window.__walk = true;
      (function step() {
        var d;
        try { d = f.contentDocument; } catch (e) { return; }
        if (!d) return;
        var s1 = d.getElementById("step1"), s2 = d.getElementById("step2"), s3 = d.getElementById("step3");
        if (s1 && !s1.hidden && !window.__w1) {
          window.__w1 = true;
          var tc = d.querySelector("#typeGrid .type-card");
          if (tc) tc.click();
        } else if (s2 && !s2.hidden && !window.__w2) {
          window.__w2 = true;
          var gp = d.querySelector("#goalList .goal-pill");
          if (gp) gp.click();
          var n2 = d.getElementById("next2");
          if (n2) n2.click();
        } else if (s3 && !s3.hidden) {
          return; // done
        }
        setTimeout(step, 40);
      })();
    }
    /* walk=block: select a section and open the block settings panel */
    function walkBuilder() {
      var tries = 0;
      (function step() {
        if (++tries > 60) return;
        var d;
        try { d = f.contentDocument; } catch (e) { return; }
        if (!d || !d.body) { setTimeout(step, 80); return; }
        var Editor = d.defaultView && d.defaultView.Editor;
        if (!Editor || !Editor.plan) { setTimeout(step, 80); return; }

        var sections = Editor.plan.pages[0].sections;
        var pick = sections.filter(function (s) { return s.type === "about"; })[0] || sections[1];
        Editor.select(pick.id);
        Editor.command("settings");
        /* give it a colour override so the panel shows real values */
        var bg = d.getElementById("blockBg");
        if (bg) { bg.value = "#F3EDE2"; bg.dispatchEvent(new Event("input", { bubbles: true })); }
        Editor.select(pick.id);
        Editor.command("settings");
        var pad = d.getElementById("blockPadTop");
        if (pad) { pad.value = "96"; pad.dispatchEvent(new Event("change", { bubbles: true })); }
        Editor.select(pick.id);
        Editor.command("settings");
      })();
    }

    /* walk=footer: scroll to the footer and open its settings panel */
    function walkFooter() {
      var tries = 0;
      (function step() {
        if (++tries > 80) return;
        var d;
        try { d = f.contentDocument; } catch (e) { return; }
        if (!d || !d.body) { setTimeout(step, 100); return; }
        var Editor = d.defaultView && d.defaultView.Editor;
        if (!Editor || !Editor.plan) { setTimeout(step, 100); return; }
        /* wait until the page has actually rendered its blocks */
        if (!d.querySelector(".ss-sec")) { setTimeout(step, 100); return; }

        var foot = d.querySelector("[data-foot]");
        if (!foot) { setTimeout(step, 100); return; }

        var btn = d.getElementById("footerBtn");
        if (btn) btn.click();
        foot.scrollIntoView({ block: "end" });
        Editor.select("footer");
      })();
    }

    f.addEventListener("load", maybeWalk);

    if (signin === "1") {
      signIn().then(function () { f.src = page; });
    } else {
      f.src = page;
    }
