/* =========================================================================
   road-label-zoom.js

   1) VISIBILITY (all devices): roadlabel16, roadlabel17, roadlabel18 stay
      hidden until the user zooms in closer, and hide again when zooming out.

   2) FONT SCALING WITH ZOOM (MOBILE ONLY): on phones, every roadlabelN
      font grows as you zoom in and shrinks as you zoom out. On desktop
      this does nothing at all -- fonts stay exactly as set in the XML.

   Lightweight: one check every 150 ms. It only writes to krpano when a
   label's font size actually changes by a 0.5px step (or when visibility
   flips), so it doesn't rewrite every label every frame like the old
   version did.

   Requires window.krpano (same as plot-popup.js).
   ========================================================================= */

(function () {
  "use strict";

  // ---- Visibility (3 labels, all devices) ------------------------------
  var VIS_NAMES = ["roadlabel16", "roadlabel17", "roadlabel18"];
  var SHOW_BELOW_FOV = 40;   // show when view.fov <= this (smaller = closer)
  var HIDE_ABOVE_FOV = 43;   // hide again above this (gap avoids flicker)

  // ---- Mobile font scaling (all roadlabelN) ----------------------------
  // The font-size written in your XML is treated as the "normal" size and
  // multiplied by a factor that goes from MIN_SCALE (zoomed out) to
  // MAX_SCALE (zoomed in). e.g. 12px label -> 6px zoomed out, 15px zoomed in.
  var MOBILE_MIN_SCALE = 0.5;
  var MOBILE_MAX_SCALE = 1.25;
  // Hard limits so a label can never get absurdly small/large
  // (also protects against leftover font-size:100px in the XML).
  var MOBILE_MIN_PX = 5;
  var MOBILE_MAX_PX = 16;

  var ALL_ROADS_RE = /^roadlabel\d+$/;

  // Used only if the view doesn't define view.fovmin / view.fovmax.
  var FALLBACK_FOV_MIN = 10;
  var FALLBACK_FOV_MAX = 150;

  var CHECK_INTERVAL_MS = 150;

  // ---- State -----------------------------------------------------------
  var timer = null;
  var visReady = false, shown = false, visCount = -1;
  var fontEntries = {};   // name -> { baseCss, baseFont, lastPx }
  var fontCount = -1;

  function K() { return window.krpano; }

  // device.mobile is a real true/false from krpano; only fall back to
  // screen width if krpano doesn't report it.
  function isMobile(kr) {
    var v = String(kr.get("device.mobile"));
    if (v === "true") return true;
    if (v === "false") return false;
    return !!(window.matchMedia && window.matchMedia("(max-width: 768px)").matches);
  }

  function fovBounds(kr) {
    var min = parseFloat(kr.get("view.fovmin"));
    var max = parseFloat(kr.get("view.fovmax"));
    if (!isFinite(min) || min <= 0) min = FALLBACK_FOV_MIN;
    if (!isFinite(max) || max <= 0) max = FALLBACK_FOV_MAX;
    return { min: min, max: max };
  }

  // ---------------- Visibility ----------------
  function setupVisibility(kr) {
    visCount = parseInt(kr.get("hotspot.count"), 10);
    var found = 0;
    for (var i = 0; i < VIS_NAMES.length; i++) {
      var base = "hotspot[" + VIS_NAMES[i] + "]";
      if (!kr.get(base + ".name")) continue;
      kr.set(base + ".visible", false);
      found++;
    }
    shown = false;
    visReady = found > 0;
  }

  function setVisible(kr, v) {
    for (var i = 0; i < VIS_NAMES.length; i++) {
      kr.set("hotspot[" + VIS_NAMES[i] + "].visible", v);
    }
    shown = v;
  }

  // ---------------- Mobile font scaling ----------------
  // Records each road label's original XML font-size. Labels we've already
  // scaled are recognised (current size == the size we last set) and kept,
  // so the base never drifts if this runs again.
  function collectFontLabels(kr) {
    var count = parseInt(kr.get("hotspot.count"), 10);
    fontCount = count;
    if (!count || isNaN(count)) return;
    for (var i = 0; i < count; i++) {
      var name = kr.get("hotspot[" + i + "].name");
      if (!name || !ALL_ROADS_RE.test(name)) continue;
      var css = kr.get("hotspot[" + name + "].css") || "";
      var m = /font-size\s*:\s*([\d.]+)px/i.exec(css);
      if (!m) continue;
      var cur = parseFloat(m[1]);
      var e = fontEntries[name];
      if (e && e.lastPx === cur) continue; // already ours, keep original base
      fontEntries[name] = { baseCss: css, baseFont: cur, lastPx: null };
    }
  }

  function scaleFonts(kr, t) {
    var scale = MOBILE_MIN_SCALE + t * (MOBILE_MAX_SCALE - MOBILE_MIN_SCALE);
    for (var name in fontEntries) {
      if (!fontEntries.hasOwnProperty(name)) continue;
      var e = fontEntries[name];
      var px = Math.round(e.baseFont * scale * 2) / 2;      // 0.5px steps
      if (px < MOBILE_MIN_PX) px = MOBILE_MIN_PX;
      if (px > MOBILE_MAX_PX) px = MOBILE_MAX_PX;
      if (px === e.lastPx) continue;                          // no change, no write
      kr.set("hotspot[" + name + "].css",
        e.baseCss.replace(/font-size\s*:\s*[\d.]+px;*/i, "font-size:" + px + "px;"));
      e.lastPx = px;
    }
  }

  // ---------------- Main loop ----------------
  function check() {
    var kr = K();
    if (!kr) return;

    var count = parseInt(kr.get("hotspot.count"), 10);
    var fov = parseFloat(kr.get("view.fov"));
    if (!isFinite(fov)) return;

    // Visibility (all devices)
    if (!visReady || count !== visCount) setupVisibility(kr);
    if (visReady) {
      if (!shown && fov <= SHOW_BELOW_FOV) setVisible(kr, true);
      else if (shown && fov > HIDE_ABOVE_FOV) setVisible(kr, false);
    }

    // Font scaling (mobile only)
    if (isMobile(kr)) {
      if (count !== fontCount) collectFontLabels(kr);
      var b = fovBounds(kr);
      var t = (b.max - fov) / (b.max - b.min);   // 0 = zoomed out, 1 = zoomed in
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      scaleFonts(kr, t);
    }
  }

  function start() {
    if (timer) return;
    timer = window.setInterval(check, CHECK_INTERVAL_MS);
  }

  (function wait() { if (K()) start(); else window.setTimeout(wait, 200); })();

  // Console helpers: roadLabelZoom.show(true/false), roadLabelZoom.stop()
  window.roadLabelZoom = {
    show: function (v) { var kr = K(); if (kr) setVisible(kr, !!v); },
    stop: function () { if (timer) { clearInterval(timer); timer = null; } }
  };
})();
