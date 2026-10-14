/* An in-panel colour picker.

   Why this exists at all, since every colour control in SiteSketch is an
   <input type="color"> and that is normally the right thing to use:

   - The native dialog opens in the top-left corner of the screen, not next
     to the swatch. Measured, not assumed: the swatch sits correctly at
     x=1148 y=367 with no transformed ancestors, but #stylesPanel is
     position:sticky with overflow:auto and Chrome anchors the popup to the
     viewport for an input inside one. This is the browser's decision and
     cannot be styled, scrolled or focused into place.
   - It has no Apply. You pick a colour and either it lands or you have no
     idea whether it did.
   - It shows an opacity slider. SiteSketch has no transparency anywhere -
     brand, section and footer colours are all opaque - so the control can
     only produce a value the design system cannot express. (parseColour
     does now accept and discard the alpha rather than refusing the colour
     outright, but the slider still means nothing.)

   So this is the primary route and the native dialog is kept only as a
   secondary "more colours" escape hatch.

   Colours are held as hue/saturation/value and converted on the way in and
   out, because a saturation square is what you drag. There is no alpha
   anywhere in this file, deliberately. */

(function () {
  "use strict";

  var SS = (window.SS = window.SS || {});

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  /* ---- colour maths: all of it local, so this file has no dependencies ---- */

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360; s /= 100; v /= 100;
    var c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255),
            Math.round((b + m) * 255)];
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0;
    if (d) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return [h, max ? (d / max) * 100 : 0, max * 100];
  }

  function toHex(r, g, b) {
    function h(n) {
      var s = clamp(Math.round(n), 0, 255).toString(16);
      return s.length === 1 ? "0" + s : s;
    }
    return "#" + h(r) + h(g) + h(b);
  }

  function fromHex(value) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || "").trim());
    if (!m) return null;
    var hx = m[1];
    if (hx.length === 3) hx = hx[0] + hx[0] + hx[1] + hx[1] + hx[2] + hx[2];
    return [parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16),
            parseInt(hx.slice(4, 6), 16)];
  }

  /* ---- drag helper -------------------------------------------------------

     One pointer gesture, from press to release, on one element. Pointer
     capture rather than window listeners: the element being dragged is
     replaced by nothing here, but a window listener that survives an
     interrupted gesture is the classic source of "the drag sticks". */
  function draggable(el, onMove) {
    el.addEventListener("pointerdown", function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      var active = true;
      try { el.setPointerCapture(event.pointerId); } catch (_) { /* older */ }
      onMove(event);

      function move(e) { if (active) onMove(e); }
      function up(e) {
        active = false;
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        try { el.releasePointerCapture(e.pointerId); } catch (_) { /* gone */ }
      }
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
  }

  function positionOf(node) {
    var r = node.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  /* ---- the picker --------------------------------------------------------

     openColourPicker({ anchor, value, onApply, onCancel, native })

     `native` is an optional <input type="color">; when given, the picker
     offers "More colours" which opens the browser's own dialog and keeps
     writing through onNative. That is the escape hatch for people who want
     the eyedropper. */
  SS.openColourPicker = function (options) {
    SS.closeColourPicker();

    var opts = options || {};
    var start = fromHex(opts.value) || [30, 30, 30];
    var hsv = rgbToHsv(start[0], start[1], start[2]);

    var wrap = document.createElement("div");
    wrap.className = "ss-picker";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Choose a colour");

    wrap.innerHTML =
      '<div class="ss-picker-sv" tabindex="0" role="slider" aria-label="Saturation and brightness">' +
        '<div class="ss-picker-sv-dot"></div>' +
      "</div>" +
      '<div class="ss-picker-hue" tabindex="0" role="slider" aria-label="Hue">' +
        '<div class="ss-picker-hue-dot"></div>' +
      "</div>" +
      '<div class="ss-picker-fields">' +
        '<label class="ss-picker-field"><span>Hex</span>' +
          '<input type="text" class="ss-picker-hex" maxlength="7" spellcheck="false" ' +
            'aria-label="Hex colour value"></label>' +
        '<label class="ss-picker-field"><span>R</span>' +
          '<input type="number" class="ss-picker-r" min="0" max="255" aria-label="Red"></label>' +
        '<label class="ss-picker-field"><span>G</span>' +
          '<input type="number" class="ss-picker-g" min="0" max="255" aria-label="Green"></label>' +
        '<label class="ss-picker-field"><span>B</span>' +
          '<input type="number" class="ss-picker-b" min="0" max="255" aria-label="Blue"></label>' +
      "</div>" +
      '<div class="ss-picker-actions">' +
        (opts.native
          ? '<button type="button" class="btn btn-sm btn-ghost ss-picker-more">More colours</button>'
          : "") +
        '<button type="button" class="btn btn-sm ss-picker-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-sm btn-primary ss-picker-apply">Apply</button>' +
      "</div>";

    document.body.appendChild(wrap);

    var sv = wrap.querySelector(".ss-picker-sv");
    var svDot = wrap.querySelector(".ss-picker-sv-dot");
    var hue = wrap.querySelector(".ss-picker-hue");
    var hueDot = wrap.querySelector(".ss-picker-hue-dot");
    var hexInput = wrap.querySelector(".ss-picker-hex");
    var rIn = wrap.querySelector(".ss-picker-r");
    var gIn = wrap.querySelector(".ss-picker-g");
    var bIn = wrap.querySelector(".ss-picker-b");
    var applyBtn = wrap.querySelector(".ss-picker-apply");
    var moreBtn = wrap.querySelector(".ss-picker-more");

    function currentHex() {
      return toHex.apply(null, hsvToRgb(hsv[0], hsv[1], hsv[2]));
    }

    /* Paint everything from the single hsv state. One source of truth, or
       the square and the hex field drift apart the moment anything is typed
       by hand. */
    function paint() {
      var rgb = hsvToRgb(hsv[0], hsv[1], hsv[2]);
      sv.style.background = "hsl(" + hsv[0] + ", 100%, 50%)";

      var s = positionOf(sv);
      var dx = (hsv[1] / 100) * s.w;
      var dy = (1 - hsv[2] / 100) * s.h;
      svDot.style.left = dx + "px";
      svDot.style.top = dy + "px";
      /* white on light backgrounds is invisible, so the ring flips */
      svDot.classList.toggle("ss-picker-dot--dark", hsv[2] > 62);

      var hp = positionOf(hue);
      hueDot.style.top = ((hsv[0] / 360) * hp.h) + "px";

      var hex = toHex(rgb[0], rgb[1], rgb[2]);
      if (document.activeElement !== hexInput) hexInput.value = hex.toUpperCase();
      if (document.activeElement !== rIn) rIn.value = rgb[0];
      if (document.activeElement !== gIn) gIn.value = rgb[1];
      if (document.activeElement !== bIn) bIn.value = rgb[2];
    }

    function setFromHexField() {
      var rgb = fromHex(hexInput.value);
      if (!rgb) return false;
      hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
      return true;
    }

    function setFromRgbFields() {
      var parts = [rIn, gIn, bIn].map(function (n) {
        return clamp(parseInt(n.value, 10) || 0, 0, 255);
      });
      hsv = rgbToHsv(parts[0], parts[1], parts[2]);
    }

    /* ---- dragging ---- */
    draggable(sv, function (event) {
      var r = sv.getBoundingClientRect();
      hsv[1] = clamp(((event.clientX - r.left) / r.width) * 100, 0, 100);
      hsv[2] = clamp((1 - (event.clientY - r.top) / r.height) * 100, 0, 100);
      paint();
    });

    draggable(hue, function (event) {
      var r = hue.getBoundingClientRect();
      hsv[0] = clamp(((event.clientY - r.top) / r.height) * 360, 0, 359.999);
      paint();
    });

    /* Keyboard, because a colour slider that cannot be reached without a
       mouse is not finished. Step is 1 for the square, 5 for hue: 360 one
       degree at a time is unusable. */
    sv.addEventListener("keydown", function (e) {
      var d = e.shiftKey ? 10 : 1, used = true;
      if (e.key === "ArrowLeft") hsv[1] = clamp(hsv[1] - d, 0, 100);
      else if (e.key === "ArrowRight") hsv[1] = clamp(hsv[1] + d, 0, 100);
      else if (e.key === "ArrowUp") hsv[2] = clamp(hsv[2] + d, 0, 100);
      else if (e.key === "ArrowDown") hsv[2] = clamp(hsv[2] - d, 0, 100);
      else used = false;
      if (used) { e.preventDefault(); paint(); }
    });
    hue.addEventListener("keydown", function (e) {
      var d = e.shiftKey ? 30 : 5, used = true;
      if (e.key === "ArrowUp") hsv[0] = (hsv[0] - d + 360) % 360;
      else if (e.key === "ArrowDown") hsv[0] = (hsv[0] + d) % 360;
      else used = false;
      if (used) { e.preventDefault(); paint(); }
    });

    hexInput.addEventListener("input", function () { if (setFromHexField()) paint(); });
    hexInput.addEventListener("blur", function () {
      if (!setFromHexField()) hexInput.value = currentHex().toUpperCase();
    });
    [rIn, gIn, bIn].forEach(function (n) {
      n.addEventListener("input", function () { setFromRgbFields(); paint(); });
      n.addEventListener("blur", function () { setFromRgbFields(); paint(); });
    });

    /* ---- positioning: next to the swatch, not the corner of the screen ---- */
    function place() {
      var a = opts.anchor && opts.anchor.getBoundingClientRect();
      if (!a) { wrap.style.left = "50%"; wrap.style.top = "12vh"; return; }
      var p = wrap.getBoundingClientRect();
      var pad = 8;
      var left = a.left;
      var top = a.bottom + 6;
      /* flip above when there is no room below */
      if (top + p.height + pad > window.innerHeight &&
          a.top - p.height - 6 > 0) {
        top = a.top - p.height - 6;
      }
      /* clamp horizontally so it is never off-screen on a narrow window */
      left = clamp(left, pad, Math.max(pad, window.innerWidth - p.width - pad));
      top = clamp(top, pad, Math.max(pad, window.innerHeight - p.height - pad));
      wrap.style.left = Math.round(left) + "px";
      wrap.style.top = Math.round(top) + "px";
    }
    wrap.style.position = "fixed";
    wrap.style.visibility = "hidden";
    place();
    wrap.style.visibility = "";
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);

    /* ---- closing ---- */
    function close(applied) {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", onKey, true);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      SS.currentColourPicker = null;
      if (applied) {
        if (opts.onApply) opts.onApply(currentHex());
      } else if (opts.onCancel) {
        opts.onCancel();
      }
    }

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
      else if (e.key === "Enter") {
        /* Enter applies, but not while typing in a field where Enter is
           ambiguous - it is, there, so only handle it outside them */
        var tag = (e.target.tagName || "").toLowerCase();
        if (tag !== "input" && tag !== "textarea") {
          e.preventDefault(); e.stopPropagation(); close(true);
        }
      }
    }
    document.addEventListener("keydown", onKey, true);

    wrap.querySelector(".ss-picker-cancel").addEventListener("click", function () {
      close(false);
    });
    applyBtn.addEventListener("click", function () { close(true); });

    if (moreBtn) {
      moreBtn.addEventListener("click", function () {
        var native = opts.native;
        if (!native) return;
        /* hand the current value to the native dialog, close ours, and let
           the native input's own listener write the result */
        native.value = currentHex();
        close(false);
        try { native.click(); } catch (_) { native.focus(); }
      });
    }

    /* Clicking away closes without applying. Bound on pointerdown in the
       capture phase so it runs before the click reaches whatever opened us,
       and only for presses that started outside the picker. */
    function onAway(e) {
      if (wrap.contains(e.target)) return;
      if (opts.anchor && opts.anchor.contains(e.target)) return;
      document.removeEventListener("pointerdown", onAway, true);
      close(false);
    }
    setTimeout(function () {
      document.addEventListener("pointerdown", onAway, true);
    }, 0);

    paint();
    sv.focus();
    SS.currentColourPicker = close;
    return { close: close, hex: currentHex };
  };

  SS.closeColourPicker = function () {
    if (SS.currentColourPicker) SS.currentColourPicker(false);
  };
})();