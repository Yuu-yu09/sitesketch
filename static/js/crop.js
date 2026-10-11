/* ============================================================
   crop.js - non-destructive image cropping.

   WordPress crops without touching the original file: it stores a
   rectangle and shows that part of the image. We do exactly that,
   storing fractions (0-1) of the image on the block, so a crop can be
   undone, changed, and applied to library photos we do not own.

   Interaction is pointer based (mouse, touch and pen) and the whole
   thing is operable from the keyboard too.
   ============================================================ */
(function () {
  "use strict";

  var SS = window.SS || (window.SS = {});
  var Crop = {};

  var state = null;

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function buildModal() {
    var host = document.getElementById("cropHost") || (function () {
      var h = document.createElement("div");
      h.id = "cropHost";
      document.body.appendChild(h);
      return h;
    })();

    host.innerHTML =
      '<div class="modal" id="cropModal" hidden role="dialog" aria-modal="true" aria-labelledby="cropTitle">' +
        '<div class="modal-card modal-card--crop">' +
          '<header class="modal-head"><h2 id="cropTitle">Crop image</h2>' +
            '<button class="icon-btn" data-crop-close aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
          "</header>" +
          '<div class="modal-body">' +
            '<div class="crop-stage" id="cropStage">' +
              '<img id="cropImage" alt="">' +
              '<div class="crop-box" id="cropBox" tabindex="0" role="group" ' +
                'aria-label="Crop area. Use the arrow keys to move, shift plus arrows to resize.">' +
                '<span class="crop-handle crop-handle--nw" data-corner="nw"></span>' +
                '<span class="crop-handle crop-handle--ne" data-corner="ne"></span>' +
                '<span class="crop-handle crop-handle--sw" data-corner="sw"></span>' +
                '<span class="crop-handle crop-handle--se" data-corner="se"></span>' +
              "</div>" +
            "</div>" +
            '<div class="crop-presets" role="group" aria-label="Crop shape">' +
              '<button type="button" class="chip is-on" data-shape="free">Free</button>' +
              '<button type="button" class="chip" data-shape="square">Square</button>' +
              '<button type="button" class="chip" data-shape="wide">Landscape</button>' +
              '<button type="button" class="chip" data-shape="tall">Portrait</button>' +
            "</div>" +
            '<p class="hint" id="cropHint">Drag the box to choose what stays visible.</p>' +
          "</div>" +
          '<footer class="modal-foot">' +
            '<button type="button" class="btn" data-crop-reset>Reset crop</button>' +
            '<div class="crop-foot-right">' +
              '<button type="button" class="btn" data-crop-close>Cancel</button>' +
              '<button type="button" class="btn btn-primary" data-crop-apply>Apply crop</button>' +
            "</div>" +
          "</footer>" +
        "</div>" +
      "</div>";

    var modal = host.querySelector("#cropModal");
    modal.addEventListener("click", function (event) {
      if (event.target === modal || event.target.closest("[data-crop-close]")) close();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !modal.hidden && state) close();
    });

    host.querySelectorAll("[data-shape]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        host.querySelectorAll("[data-shape]").forEach(function (c) { c.classList.toggle("is-on", c === chip); });
        applyShape(chip.dataset.shape);
      });
    });
    host.querySelector("[data-crop-apply]").addEventListener("click", apply);
    host.querySelector("[data-crop-reset]").addEventListener("click", function () {
      setCrop({ x: 0, y: 0, w: 1, h: 1 });
      paint();
    });

    return modal;
  }

  /* open the cropper for one image slot */
  Crop.open = function (options) {
    var src = options.src;
    if (!src) { SS.toast("No image to crop yet", "bi-image"); return; }

    var modal = buildModal();
    state = {
      sectionId: options.sectionId,
      slot: options.slot,
      src: src,
      crop: normalise(options.crop) || { x: 0, y: 0, w: 1, h: 1 },
      shape: "free",
      stage: modal.querySelector("#cropStage"),
      box: modal.querySelector("#cropBox"),
      img: modal.querySelector("#cropImage"),
      hint: modal.querySelector("#cropHint")
    };

    modal.hidden = false;
    state.img.onload = function () { paint(); };
    state.img.src = src;

    wirePointer();
    wireKeys();
    paint();
  };

  function normalise(crop) {
    if (!crop || typeof crop !== "object") return null;
    var x = Number(crop.x), y = Number(crop.y), w = Number(crop.w), h = Number(crop.h);
    if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return null;
    if (w <= 0 || h <= 0) return null;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1), w: clamp(w, 0.02, 1), h: clamp(h, 0.02, 1) };
  }

  function paint() {
    if (!state) return;
    var c = state.crop;
    state.box.style.left = (c.x * 100) + "%";
    state.box.style.top = (c.y * 100) + "%";
    state.box.style.width = (c.w * 100) + "%";
    state.box.style.height = (c.h * 100) + "%";
    var full = c.w >= 0.999 && c.h >= 0.999;
    state.hint.textContent = full
      ? "Drag the box to choose what stays visible."
      : Math.round(c.w * 100) + "% \u00d7 " + Math.round(c.h * 100) + "% of the image is shown.";
  }

  function setCrop(next) {
    var c = state.crop;
    c.x = clamp(next.x, 0, 1 - c.w);
    c.y = clamp(next.y, 0, 1 - c.h);
    c.w = clamp(next.w, 0.05, 1);
    c.h = clamp(next.h, 0.05, 1);
    if (c.x + c.w > 1) c.w = 1 - c.x;
    if (c.y + c.h > 1) c.h = 1 - c.y;
    paint();
  }

  function applyShape(shape) {
    state.shape = shape;
    if (shape === "free") return;

    var img = state.img;
    var iw = img.naturalWidth || 1;
    var ih = img.naturalHeight || 1;

    /* The crop window is stored as fractions of the image, so to land on a
       target shape R (width/height in real pixels) we need
         (w * iw) / (h * ih) = R     =>     h = w * (iw / ih) / R
       Ignoring the image's own ratio turns a "landscape" preset into a
       portrait one, which is exactly the bug this avoids. */
    var R = shape === "square" ? 1 : shape === "wide" ? 16 / 9 : 4 / 5;
    var imageRatio = iw / ih;

    var c = state.crop;
    var cx = c.x + c.w / 2;
    var cy = c.y + c.h / 2;

    var w = c.w;
    var h = w * imageRatio / R;
    if (h > 1) { h = 1; w = h * R / imageRatio; }
    if (w > 1) { w = 1; h = w * imageRatio / R; }

    setCrop({ x: cx - w / 2, y: cy - h / 2, w: w, h: h });
  }

  /* ---------- pointer dragging ---------- */

  function pointInStage(event) {
    var r = state.stage.getBoundingClientRect();
    return {
      x: clamp((event.clientX - r.left) / r.width, 0, 1),
      y: clamp((event.clientY - r.top) / r.height, 0, 1)
    };
  }

  function wirePointer() {
    var mode = null;         /* "move" | corner name */
    var start = null;
    var origin = null;

    function down(event) {
      var corner = event.target.closest("[data-corner]");
      mode = corner ? corner.dataset.corner : "move";
      start = pointInStage(event);
      origin = Object.assign({}, state.crop);
      state.box.setPointerCapture && state.box.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    function move(event) {
      if (!mode) return;
      var p = pointInStage(event);
      var dx = p.x - start.x;
      var dy = p.y - start.y;

      if (mode === "move") {
        setCrop({ x: origin.x + dx, y: origin.y + dy, w: origin.w, h: origin.h });
      } else {
        var right = origin.x + origin.w;
        var bottom = origin.y + origin.h;
        var left = origin.x, top = origin.y;
        if (mode.indexOf("w") !== -1) left = origin.x + dx;
        if (mode.indexOf("e") !== -1) right = origin.x + origin.w + dx;
        if (mode.indexOf("n") !== -1) top = origin.y + dy;
        if (mode.indexOf("s") !== -1) bottom = origin.y + origin.h + dy;

        var w = clamp(right - left, 0.05, 1);
        var h = clamp(bottom - top, 0.05, 1);
        /* keep the preset's shape while dragging a corner */
        if (state.shape !== "free") {
          var img = state.img;
          var imageRatio = (img.naturalWidth || 1) / (img.naturalHeight || 1);
          var R = state.shape === "square" ? 1 : state.shape === "wide" ? 16 / 9 : 4 / 5;
          h = w * imageRatio / R;
          if (top + h > 1) { h = 1 - top; w = h * R / imageRatio; }
        }
        setCrop({ x: left, y: top, w: w, h: h });
      }
      event.preventDefault();
    }

    function up(event) {
      if (!mode) return;
      mode = null;
      state.box.releasePointerCapture && event.pointerId !== undefined &&
        state.box.releasePointerCapture(event.pointerId);
    }

    state.box.addEventListener("pointerdown", down);
    state.box.addEventListener("pointermove", move);
    state.box.addEventListener("pointerup", up);
    state.box.addEventListener("pointercancel", up);
  }

  /* ---------- keyboard ---------- */

  function wireKeys() {
    var modal = document.getElementById("cropModal");
    modal.addEventListener("keydown", function (event) {
      if (!state) return;
      var box = state.box;
      if (event.target !== box) return;
      var step = event.shiftKey ? 0.08 : 0.02;
      var c = state.crop;
      var dx = 0, dy = 0;
      if (event.key === "ArrowLeft") dx = -step;
      else if (event.key === "ArrowRight") dx = step;
      else if (event.key === "ArrowUp") dy = -step;
      else if (event.key === "ArrowDown") dy = step;
      else return;

      event.preventDefault();
      if (event.altKey) {
        /* alt resizes from the centre, so the box never runs out of room
           and both arrow directions stay useful at the edges */
        var cx = c.x + c.w / 2;
        var cy = c.y + c.h / 2;
        var nw = clamp(c.w + dx, 0.05, 1);
        var nh = clamp(c.h + dy, 0.05, 1);
        setCrop({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh });
      } else {
        setCrop({ x: c.x + dx, y: c.y + dy, w: c.w, h: c.h });
      }
      paint();
    });
  }

  function apply() {
    if (!state) return;
    var c = state.crop;
    var untouched = c.x <= 0.001 && c.y <= 0.001 && c.w >= 0.999 && c.h >= 0.999;
    if (window.Editor && window.Editor.setCrop) {
      window.Editor.setCrop(state.sectionId, state.slot, untouched ? null : { x: c.x, y: c.y, w: c.w, h: c.h });
    }
    close();
  }

  function close() {
    var modal = document.getElementById("cropModal");
    if (modal) modal.hidden = true;
    state = null;
  }

  Crop.close = close;
  window.Crop = Crop;
  window.SS.Crop = Crop;
})();