/* ============================================================
   SiteSketch — privacy & preference centre

   Renders the policy tables from /api/privacy/summary, which is generated
   from cookies.py and privacy.py. Writing these tables out by hand in the
   HTML would be the same list in two places, and two lists always disagree.
   ============================================================ */
(function () {
  "use strict";

  function esc(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function table(headings, rows, emptyMessage) {
    if (!rows.length) return "<p class=\"legal-note\">" + esc(emptyMessage) + "</p>";
    return "<table class=\"legal-table\"><thead><tr>" +
      headings.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      rows.map(function (cells) {
        return "<tr>" + cells.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
      }).join("") +
      "</tbody></table>";
  }

  function renderStatus() {
    var el = document.getElementById("prefStatus");
    if (!el) return;
    var record = window.Consent && Consent.record();
    if (!record) {
      el.textContent = "You have not made a choice yet. Nothing optional is in use, so any option works.";
      return;
    }
    var when = record.decidedAt ? new Date(record.decidedAt).toLocaleDateString() : "";
    var what = (record.categories && record.categories.length)
      ? record.categories.join(", ")
      : "Essential only";
    el.textContent = "Saved " + when + " — you agreed to: " + what +
      ". Essential cookies are always on, because the site cannot work without them.";
  }

  function bind() {
    var essential = document.getElementById("prefEssential");
    var minimal = document.getElementById("prefMinimal");
    var withdraw = document.getElementById("prefWithdraw");
    if (essential) essential.addEventListener("click", function () {
      Consent.save(["Functional", "Analytics", "Advertising"]);
      renderStatus();
      flash("Saved. Nothing optional is in use today, so this changes nothing yet.");
    });
    if (minimal) minimal.addEventListener("click", function () {
      Consent.save([]);
      renderStatus();
      flash("Saved as essential only. This is the site as you would get it by default.");
    });
    if (withdraw) withdraw.addEventListener("click", function () {
      Consent.withdraw();
      renderStatus();
      flash("Consent withdrawn. The notice is back at the bottom of the screen.");
    });
  }

  function flash(message) {
    var el = document.getElementById("prefFlash");
    if (!el) {
      el = document.createElement("p");
      el.id = "prefFlash";
      el.className = "legal-note legal-flash";
      el.setAttribute("role", "status");
      var panel = document.querySelector(".pref-panel");
      if (panel) panel.appendChild(el);
    }
    el.textContent = message;
  }

  function load() {
    fetch("/api/privacy/summary")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var date = document.getElementById("legalDate");
        if (date) date.textContent = new Date().toLocaleDateString(undefined,
          { year: "numeric", month: "long", day: "numeric" });
        if (!data) {
          document.querySelectorAll(".legal-note").forEach(function (n) {
            n.textContent = "This information could not be loaded.";
          });
          return;
        }

        document.getElementById("retentionTable").innerHTML = table(
          ["What", "Why", "How long"],
          data.retention.map(function (r) {
            return [esc(r.data), esc(r.why), esc(r.kept)];
          }),
          "Nothing is stored."
        );

        document.getElementById("cookieTable").innerHTML = table(
          ["Name", "Category", "Purpose", "How long", "Can scripts read it?"],
          data.cookies.map(function (c) {
            return [
              "<code>" + esc(c.name) + "</code>",
              "<span class=\"chip chip--cat\">" + esc(c.category) + "</span>",
              esc(c.purpose) +
                (c.details ? "<br><span class=\"legal-note\">" + esc(c.details) + "</span>" : ""),
              esc(c.lifespan),
              c.script_readable ? "Yes" : "<strong>No</strong> (HttpOnly)"
            ];
          }),
          "No cookies are set."
        );

        document.getElementById("thirdPartyList").innerHTML =
          "<ul class=\"legal-list\">" +
          data.third_parties.map(function (t) {
            return "<li><strong>" + esc(t.name) + "</strong> — " + esc(t.why) +
              "<br><span class=\"legal-note\">Sends: " + esc(t.what_leaves) +
              " · Required: " + (t.optional ? "no" : "yes") +
              (t.note ? "<br>" + esc(t.note) : "") + "</span></li>";
          }).join("") +
          "</ul>";
      })
      .catch(function () {
        document.querySelectorAll(".legal-note").forEach(function (n) {
          n.textContent = "This information could not be loaded.";
        });
      });
  }

  bind();
  renderStatus();
  load();
})();
