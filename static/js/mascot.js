/* ============================================================
   mascot.js - the SiteSketch greeter

   A hand-drawn notebook character that appears once the user is
   signed in. It matches the user's name (boy / girl / neutral),
   blinks on its own, tilts toward the pointer, waves when tapped
   and says something different each time.

   Drawn in the app's own language: ink strokes, pencil-red accents,
   warm paper, Caveat annotation.

   window.Mascot.mount(container, { name, greeting })
   ============================================================ */
(function () {
  "use strict";

  /* ---------- name -> which character ---------- */
  /* Curated common names (Filipino and international). An unknown name gets
     the neutral character rather than a wrong guess, and names that are
     genuinely unisex (Alex, Kim, Pat, Jordan...) are left out on purpose. */
  var BOY = ("juan miguel angel jose rafael gabriel daniel carlo roger jomar mark "
    + "david paul john peter james robert richard martin thomas andrew kevin brian "
    + "jerome alan benedict christopher javier manuel antonio eduardo gregorio "
    + "hector ismael joel lemuel narciso ramon roderick salvador vicente abel "
    + "bartolome danilo emilio felipe jerico lino marlon oscar paolo renzo "
    + "sebastian toni mateo santiago alfonso ivan leonard mathew noel paco rene "
    + "enzo adrian baste calvin darwin emanuel fredo gerald").split(" ");

  var GIRL = ("maria ann anne claire sophia grace angelica gabriela kimberly "
    + "jessica danielle emily sarah amanda angel janice mae clara michelle "
    + "nicole juliana andrea patricia carla monica rosa marissa katrina "
    + "valentina gabrielle isabella elena natalia julia bea liezel "
    + "michelle angela paula rosario marisol luz gisela jazmin cheryl mylenne "
    + "sharon connie beth rachelle jeremie jhoanna kyla trisha yna allyza "
    + "chloe olivia ava mia ella lily nora jade faith hope joy mercy divine "
    + "blessing princess queen star tina lina maya luna sofia ines irene "
    + "jasmine jasmine mae anna liza nina tessa rhea dela cruz ramirez "
    + "ximara joanna teresita consuelo eugenia pilar marta luisa carmen rosa").split(" ");

  /* honorifics carry no gender signal and would block the real name */
  var TITLES = ("dr mr mrs ms prof sir madam maam st san sr jr");

  var CACHE = {};

  function detect(name) {
    if (!name) return "neutral";
    var key = String(name).toLowerCase().trim();
    if (CACHE[key]) return CACHE[key];
    var parts = key.split(/[\s._-]+/).filter(function (part) {
      return part && TITLES.indexOf(part.replace(/\./g, "")) === -1;
    });
    var found = "neutral";
    parts.forEach(function (part) {
      if (found !== "neutral") return;
      if (BOY.indexOf(part) !== -1) found = "boy";
      else if (GIRL.indexOf(part) !== -1) found = "girl";
    });
    CACHE[key] = found;
    return found;
  }

  /* ---------- what it says ---------- */
  var LINES = {
    boy: ["Ready when you are.", "Let's sketch something good.", "Another plan in the making?", "Pencil's sharpened. Go ahead."],
    girl: ["Ready when you are.", "Let's sketch something lovely.", "What are we building today?", "Pencil's sharpened. Go ahead."],
    neutral: ["Welcome back.", "What are we sketching today?", "The page is yours.", "Pencil's sharpened. Go ahead."]
  };

  /* ---------- the drawing ----------
     One body, two hair silhouettes. Same ink, same face; only the
     hair and a small accessory change, so it reads as one family. */
  function svg(kind) {
    var hair = kind === "boy"
      ? '<path d="M34 40c1-13 9-20 20-20s19 7 20 20c-4-5-11-7-20-7s-16 2-20 7z" fill="#1f2a37"/>'
        + '<path d="M33 39c-2-6-1-13 3-17" stroke="#1f2a37" stroke-width="3" fill="none" stroke-linecap="round"/>'
      : kind === "girl"
        ? '<path d="M33 40c0-13 9-21 21-21s21 8 21 21c0 7-1 13-2 18-2-7-3-11-5-14-8 4-22 4-30 0-2 3-3 7-5 14-1-5-2-11-2-18z" fill="#1f2a37"/>'
        + '<path d="M54 20c-4 3-6 8-6 13" stroke="#33404f" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
        + '<circle cx="76" cy="27" r="3.4" fill="#d6452f"/>'
        + '<path d="M31 45c-1 6-1 12 1 18" stroke="#1f2a37" stroke-width="3" fill="none" stroke-linecap="round"/>'
        + '<path d="M77 45c1 6 1 12-1 18" stroke="#1f2a37" stroke-width="3" fill="none" stroke-linecap="round"/>'
        : '<path d="M34 40c0-12 9-20 20-20s20 8 20 20c-3-4-9-6-20-6s-17 2-20 6z" fill="#1f2a37"/>'
          + '<path d="M40 30c4-6 12-8 18-6" stroke="#1f2a37" stroke-width="3" fill="none" stroke-linecap="round"/>';

    var accent = kind === "girl"
      ? '<path d="M46 74c5 3 11 3 16 0" stroke="#d6452f" stroke-width="2.5" fill="none" stroke-linecap="round"/>'
      : '<path d="M46 74c5 2 11 2 16 0" stroke="#1f2a37" stroke-width="2.5" fill="none" stroke-linecap="round"/>';

    return '' +
      '<svg class="mascot-art" viewBox="0 0 108 104" role="img" aria-hidden="true" focusable="false">' +
        '<ellipse cx="54" cy="95" rx="26" ry="4.5" fill="rgba(22,40,60,.10)"/>' +
        /* body: notebook-blue overalls with a red pencil in the pocket */
        '<path d="M30 66c0-4 3-6 6-6h36c3 0 6 2 6 6v22c0 3-2 5-5 5H35c-3 0-5-2-5-5V66z" fill="#2f4b6e"/>' +
        '<path d="M40 60l14 12 14-12" stroke="#f6f3ec" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
        '<rect x="66" y="76" width="4" height="14" rx="1.5" fill="#d6452f" transform="rotate(12 68 83)"/>' +
        /* head */
        '<circle cx="54" cy="41" r="21" fill="#fbf8f1" stroke="#16283c" stroke-width="2.5"/>' +
        hair +
        /* face */
        '<g class="mascot-eyes"><circle cx="46" cy="42" r="2.6" fill="#16283c"/><circle cx="62" cy="42" r="2.6" fill="#16283c"/></g>' +
        '<path d="M50 52q4 4 8 0" stroke="#16283c" stroke-width="2" fill="none" stroke-linecap="round"/>' +
        accent +
        /* cheeks */
        '<circle cx="42" cy="50" r="3.2" fill="#e8a99b" opacity=".55"/>' +
        '<circle cx="66" cy="50" r="3.2" fill="#e8a99b" opacity=".55"/>' +
        /* waving arm, animated on tap */
        '<g class="mascot-arm"><path d="M32 70c-6 2-9 8-8 15" stroke="#16283c" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
        '<circle cx="23" cy="86" r="4" fill="#fbf8f1" stroke="#16283c" stroke-width="2.5"/></g>' +
        '<path d="M76 70c5 3 7 8 6 14" stroke="#16283c" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
        '<circle cx="82" cy="85" r="4" fill="#fbf8f1" stroke="#16283c" stroke-width="2.5"/>' +
      '</svg>';
  }

  /* ---------- mount ---------- */
  var current = null;

  function mount(container, options) {
    if (!container) return null;
    options = options || {};

    var kind = options.kind || detect(options.name);
    current = { kind: kind, name: options.name || "" };

    container.innerHTML =
      '<button class="mascot" type="button" aria-label="SiteSketch greeter. Tap for a greeting.">' +
        '<span class="mascot-bubble" role="status"></span>' +
        svg(kind) +
        '<span class="mascot-note hand" aria-hidden="true">tap me</span>' +
      '</button>';

    var root = container.querySelector(".mascot");
    var bubble = root.querySelector(".mascot-bubble");
    var pool = (LINES[kind] || LINES.neutral).slice();

    function say() {
      var line = pool.length ? pool.pop() : pick(kind);
      bubble.textContent = line;
      root.classList.add("is-talking");
      setTimeout(function () { root.classList.remove("is-talking"); }, 2600);
    }

    root.addEventListener("click", function () {
      root.classList.remove("is-waving");
      /* restart the animation */
      void root.offsetWidth;
      root.classList.add("is-waving");
      say();
    });

    root.addEventListener("pointermove", function (event) {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      var box = root.getBoundingClientRect();
      var dx = (event.clientX - box.left) / box.width - 0.5;
      var dy = (event.clientY - box.top) / box.height - 0.5;
      root.style.setProperty("--tilt-x", (dy * -6).toFixed(2) + "deg");
      root.style.setProperty("--tilt-y", (dx * 8).toFixed(2) + "deg");
    });

    root.addEventListener("pointerleave", function () {
      root.style.setProperty("--tilt-x", "0deg");
      root.style.setProperty("--tilt-y", "0deg");
    });

    /* blink on its own, so it feels alive on arrival */
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInterval(function () {
        var eyes = root.querySelector(".mascot-eyes");
        if (!eyes) return;
        eyes.style.transform = "scaleY(0.1)";
        setTimeout(function () { eyes.style.transform = ""; }, 130);
      }, 4200);
    }

    /* greet shortly after landing */
    setTimeout(function () {
      if (options.greeting !== false) say();
    }, 700);

    return current;
  }

  function pick(kind) {
    var pool = LINES[kind] || LINES.neutral;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  window.Mascot = { mount: mount, detect: detect };
})();