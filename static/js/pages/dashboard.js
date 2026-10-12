    (function () {
      var user = API.requireAuth();
      if (!user) return;

      document.getElementById("userName").textContent = user.name;
      document.querySelector("#userChip .av").textContent = user.name.charAt(0).toUpperCase();

      var h = new Date().getHours();
      var part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
      document.getElementById("greeting").textContent = part + ", " + user.name;

      /* greeter: matches the signed-in user's name */
      if (window.Mascot) {
        Mascot.mount(document.getElementById("mascotSlot"), { name: user.name });
      }

      document.getElementById("logoutBtn").addEventListener("click", function () {
        API.logout();
        location.href = "index.html";
      });

      var grid = document.getElementById("grid");

      function typeName(id) {
        var t = API.TYPES.filter(function (x) { return x.id === id; })[0];
        return t ? t.name : id;
      }

      function render() {
        API.listProjects().then(function (res) {
        var projects = res.projects || [];
        grid.innerHTML = "";

        if (!projects.length) {
          var empty = document.createElement("div");
          empty.className = "empty";
          empty.style.gridColumn = "1 / -1";
          empty.innerHTML =
            '<h2 class="h-sub">No plans yet</h2>' +
            "<p>Every website starts as a blank page — sketch your first plan and SiteSketch will fill in the structure.</p>";
          grid.appendChild(empty);
        }

        projects.forEach(function (p) {
          var live = p.is_published;
          var card = document.createElement("article");
          card.className = "card proj-card";
          card.innerHTML =
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem;">' +
              "<h2 class=\"h-sub\"><a href=\"builder.html?id=" + p.id + "\" style=\"text-decoration:none;\">" + SS.esc(p.name) + "</a></h2>" +
              '<button class="icon-btn danger" data-del="' + p.id + '" aria-label="Delete ' + SS.esc(p.name) + '"><i class="bi bi-trash3" aria-hidden="true"></i></button>' +
            "</div>" +
            '<div class="proj-meta">' +
              '<span class="chip">' + SS.esc(typeName(p.type)) + "</span>" +
              '<span class="status ' + (live ? "live" : "") + '"><span class="line"></span>' + (live ? "Live" : "Draft") + "</span>" +
            "</div>" +
            '<div class="proj-foot">' +
              "<span>Edited " + SS.fmtDate(p.updated_at) + "</span>" +
              (live
                ? '<a href="publish.html?id=' + p.id + '" style="color:inherit;">View live ↗</a>'
                : '<a href="builder.html?id=' + p.id + '" style="color:inherit;">Open builder →</a>') +
            "</div>";
          grid.appendChild(card);
        });

        var add = document.createElement("a");
        add.className = "card proj-card proj-new";
        add.href = "plan.html";
        add.innerHTML =
          '<span class="plus"><i class="bi bi-plus-lg" aria-hidden="true"></i></span>' +
          "<strong>New plan</strong><span style=\"font-size:.85rem;\">Start from a website type</span>";
        grid.appendChild(add);

        var liveCount = projects.filter(function (p) { return p.is_published; }).length;
        document.getElementById("subline").textContent = projects.length
          ? projects.length + " plan" + (projects.length > 1 ? "s" : "") + " · " + liveCount + " live"
          : "Let's fix that.";

        grid.querySelectorAll("[data-del]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            /* two-step confirm — first press arms the button, second deletes */
            if (this.dataset.armed !== "1") {
              var el = this;
              el.dataset.armed = "1";
              el.classList.add("is-armed");
              el.title = "Click again to confirm";
              setTimeout(function () {
                if (el.dataset.armed === "1") { el.dataset.armed = "0"; el.classList.remove("is-armed"); el.title = "Delete"; }
              }, 3000);
              return;
            }
            this.dataset.armed = "0";
            this.classList.remove("is-armed");
            API.deleteProject(this.getAttribute("data-del")).then(function () {
              render();
              SS.toast("Plan deleted", "bi-trash3");
            });
          });
        });
        });
      }

      render();
    })();
