/* ============================================================
   SiteSketch — legal page footer dates

   Two lines of shared behaviour for /privacy and /terms. In its own file
   because the pages' own scripts are all about their content; a page that
   cannot load its main script should still be able to say when it was last
   changed rather than showing an em dash forever.
   ============================================================ */
(function () {
  "use strict";
  var el = document.getElementById("legalDate");
  if (!el) return;
  el.textContent = new Date().toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric"
  });
})();
