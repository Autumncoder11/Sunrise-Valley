/* =========================================================================
   road-label-zoom.js  (lightweight version)

   - Road labels ("roadlabelN" text hotspots) are HIDDEN normally and only
     become visible when the user is zoomed in close to max zoom.
   - Each road width gets its own colour (7.20M, 9M, 10M, 12M ...).
   - No per-frame work: the css (colour + font-size) is written ONCE per
     label, and afterwards we only touch hotspot.visible when the zoom
     state actually flips (hidden <-> shown). This removes the lag caused
     by the old version, which rewrote every label's css on every frame.

   REQUIRES:
   - window.krpano set to the krpano interface object (same as
     plot-popup.js), e.g.
         embedpano({..., onready: function(k){ krpano = k; }});
   - Hotspots named roadlabel0, roadlabel1, ... whose html text contains
     the width, e.g. "7.20M WIDE ROAD", "12.0M WIDE LAYOUT ROAD".
   ========================================================================= */

(function () {
  "use strict";

  // ---- Config --------------------------------------------------------

  // Font size used when the labels are visible.
  var LABEL_FONT_PX = 15;

  // Labels appear when the zoom is within this fraction of the way to max
  // zoom. 0.90 = show once you are 90% of the way zoomed in.
  // Set to 1.0 to show only at the exact maximum zoom.
  var SHOW_AT = 0.90;
  // Hide again only when zoom drops below this (gap avoids flicker).
  var HIDE_BELOW = 0.85;

  // OPTIONAL: show labels when view.fov is at or below this value
  // (smaller fov = more zoomed in). If set (a number), it is used INSTEAD
  // of SHOW_AT / HIDE_BELOW. Leave as null to use the percentage method.
  // Turn DEBUG on, zoom in fully, read the logged fov, then set this to
  // a bit above that number (e.g. logged 30 -> set 35).
  var SHOW_BELOW_FOV = null;
  var HIDE_ABOVE_FOV_EXTRA = 3; // hysteresis for the fov method

  // Logs fov / bounds / label count to the console every ~1.5s.
  var DEBUG = true;
  var lastLog = 0;

  // How often (ms) to check the zoom. Cheap (one krpano.get), so 150ms is fine.
  var CHECK_INTERVAL_MS = 150;

  // Colour per road width (in metres). Add / change as you like.
  var WIDTH_COLORS = {
    "7.2":  "#ffff00", // yellow
    "9":    "#00e5ff", // cyan
    "10":   "#7CFC00", // green
    "12":   "#ff8c00"  // orange
  };
  var DEFAULT_COLOR = "#ffffff"; // any width not listed above

  var ROAD_LABEL_RE = /^roadlabel\d+$/;

  // Used only if the view doesn't define view.fovmin / view.fovmax.
  var FALLBACK_FOV_MIN = 10;
  var FALLBACK_FOV_MAX = 150;

  // ---- State ---------------------------------------------------------
  var labelNames = [];
  var lastCount = -1;
  var shown = null; // null = unknown, true/false = current state
  var timer = null;

  function K() { return window.krpano; }

  // Replace a css declaration if present, otherwise append it.
  // Also cleans up accidental double semicolons (e.g. "100px;;").
  function setCssProp(css, prop, value) {
    var re = new RegExp("(^|;)\\s*" + prop + "\\s*:[^;]*;*", "i");
    var decl = prop + ":" + value + ";";
    var out;
    if (re.test(css)) {
      out = css.replace(re, function (m, pre) { return pre + " " + decl; });
    } else {
      out = css + (css && !/;\s*$/.test(css) ? ";" : "") + " " + decl;
    }
    return out.replace(/;{2,}/g, ";").trim();
  }

  // "7.20M WIDE ROAD" -> "7.2",  "12.0M WIDE LAYOUT ROAD" -> "12"
  function widthKey(text) {
    var m = /(\d+(?:\.\d+)?)\s*M/i.exec(text || "");
    if (!m) return null;
    return String(parseFloat(m[1]));
  }

  function fovBounds() {
    var kr = K();
    var min = parseFloat(kr.get("view.fovmin"));
    var max = parseFloat(kr.get("view.fovmax"));
    if (!isFinite(min) || min <= 0) min = FALLBACK_FOV_MIN;
    if (!isFinite(max) || max <= 0) max = FALLBACK_FOV_MAX;
    return { min: min, max: max };
  }

  // Finds all road labels, styles them ONCE (colour + font size), and
  // makes sure they start hidden.
  function setupLabels() {
    var kr = K();
    var count = parseInt(kr.get("hotspot.count"), 10);
    lastCount = count;
    labelNames = [];
    if (!count || isNaN(count)) return;

    for (var i = 0; i < count; i++) {
      var name = kr.get("hotspot[" + i + "].name");
      if (!name || !ROAD_LABEL_RE.test(name)) continue;

      var base = "hotspot[" + name + "]";
      var css = kr.get(base + ".css") || "";
      var color = WIDTH_COLORS[widthKey(kr.get(base + ".html"))] || DEFAULT_COLOR;

      css = setCssProp(css, "color", color);
      css = setCssProp(css, "font-size", LABEL_FONT_PX + "px");
      kr.set(base + ".css", css);
      kr.set(base + ".visible", false);
      labelNames.push(name);
    }
    shown = false;
  }

  function setVisible(v) {
    var kr = K();
    for (var i = 0; i < labelNames.length; i++) {
      kr.set("hotspot[" + labelNames[i] + "].visible", v);
    }
    shown = v;
  }

  function check() {
    var kr = K();
    if (!kr) return;

    // Re-scan only if the number of hotspots changed (scene reload etc.)
    var count = parseInt(kr.get("hotspot.count"), 10);
    if (count !== lastCount) setupLabels();
    if (!labelNames.length) return;

    var fov = parseFloat(kr.get("view.fov"));
    if (!isFinite(fov)) return;

    var b = fovBounds();
    var t = (b.max - fov) / (b.max - b.min); // 0 = zoomed out, 1 = max zoom
    if (t < 0) t = 0;
    if (t > 1) t = 1;

    if (DEBUG) {
      var now = Date.now();
      if (now - lastLog > 1500) {
        lastLog = now;
        console.log("road-label-zoom: labels=" + labelNames.length +
          " fov=" + fov.toFixed(2) + " fovmin=" + b.min + " fovmax=" + b.max +
          " t=" + t.toFixed(2) + " shown=" + shown);
      }
    }

    var wantShow, wantHide;
    if (typeof SHOW_BELOW_FOV === "number") {
      wantShow = fov <= SHOW_BELOW_FOV;
      wantHide = fov > SHOW_BELOW_FOV + HIDE_ABOVE_FOV_EXTRA;
    } else {
      wantShow = t >= SHOW_AT;
      wantHide = t < HIDE_BELOW;
    }

    // Only touch krpano when the state actually changes.
    if (!shown && wantShow) setVisible(true);
    else if (shown && wantHide) setVisible(false);
  }

  function start() {
    if (timer) return;
    setupLabels();
    timer = window.setInterval(check, CHECK_INTERVAL_MS);
  }

  function stop() {
    if (timer) { window.clearInterval(timer); timer = null; }
  }

  function waitForKrpanoThenStart() {
    if (K()) start();
    else window.setTimeout(waitForKrpanoThenStart, 200);
  }
  waitForKrpanoThenStart();

  // Manual control from the console.
  window.roadLabelZoom = {
    start: start,
    stop: stop,
    refresh: function () { setupLabels(); },
    // Console test: roadLabelZoom.show(true) forces labels on, (false) off.
    show: function (v) { setVisible(!!v); }
  };
})();
