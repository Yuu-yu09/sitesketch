    /* Renders a plan handed over by the builder.
       This has to live in its own document so the page's own media queries
       respond to the frame width - squeezing a div inside the builder would
       never trigger them, so "mobile preview" would just be a narrow desktop. */
    (function () {
      var host = document.getElementById("host");
      var pageId = "home";

      function render(plan, id) {
        if (!plan || !plan.pages || !plan.pages.length) {
          host.innerHTML = '<p style="padding:2rem;font-family:system-ui">Nothing to preview yet.</p>';
          return;
        }
        var page = id || pageId;
        var found = plan.pages.filter(function (p) { return p.id === page; })[0];
        pageId = found ? page.id : plan.pages[0].id;

        host.innerHTML = SS.renderPage(plan, pageId, { editable: false });
        SS.observeMotion(host);
      }

      window.addEventListener("message", function (event) {
        var data = event.data || {};
        if (data.type === "render") render(data.plan, data.pageId);
      });

      /* let the parent know we are ready for the first paint */
      parent.postMessage({ type: "preview-ready" }, "*");

      /* a page opened on its own can render a sample plan */
      if (location.search.indexOf("sample") !== -1 && window.SS && window.SS.renderPage) {
        render({
          meta: { type: "business", goal: "get-contact", theme: "modern", siteName: "Preview" },
          pages: [{ id: "home", name: "Home", sections: [] }]
        });
      }
    })();
