/* =========================================================================
   road-label-zoom.js
   Gradually scales every "roadlabelN" text hotspot's font-size between
   MIN_FONT_PX (fully zoomed out) and MAX_FONT_PX (fully zoomed in), tied
   to the live camera FOV -- so labels like "7.20M WIDE ROAD" start small
   and grow crisper as the user zooms in, instead of jumping or staying a
   fixed size.

   REQUIRES:
   - window.krpano to be set to the krpano interface object (same
     convention as plot-popup.js / action-bar.js), e.g.:
         embedpano({..., onready: function(krpanoInterface){
             krpano = krpanoInterface;   // must be a global
         }});
   - The road label hotspots already defined in your XML, named
     "roadlabel0", "roadlabel1", ... (any numeric suffix) -- e.g.:
         <hotspot name="roadlabel16" type="text" ... css="font-family:Arial;
           font-size:5px; color:#ffff00; text-align:center;" .../>
     This script only rewrites the font-size portion of each hotspot's
     existing css string every frame -- font-family/color/text-align/etc.
     are read from each hotspot's own css ONCE at startup and kept as-is,
     so you don't need identical css across all labels.
   ========================================================================= */

(function () {
  "use strict";

  // ---- Config --------------------------------------------------------
  var MIN_FONT_PX = 6;   // font size at full zoom-out
  var MAX_FONT_PX = 15;   // font size at full zoom-in (max zoom)

  // Matches "roadlabel16", "roadlabel17", etc. Adjust if your road label
  // hotspots use a different naming scheme.
  var ROAD_LABEL_RE = /^roadlabel\d+$/;

  // Fallback FOV bounds, only used if the scene/view doesn't define
  // view.fovmin / view.fovmax (krpano normally does via <view fovmin=".."
  // fovmax=".." /> in tour.xml). Adjust these to match your tour if you
  // see labels not reaching MIN_FONT_PX/MAX_FONT_PX at the actual zoom
  // extremes -- e.g. console.log the real view.fov at min/max zoom and
  // set these to match.
  var FALLBACK_FOV_MIN = 10;   // smaller fov = more zoomed in
  var FALLBACK_FOV_MAX = 150;  // larger fov = more zoomed out

  // Set true temporarily to console.log the detected fov bounds and a
  // sampled fov/font-size reading every ~2s -- use this to check whether
  // FALLBACK_FOV_MIN/MAX (or your scene's own view.fovmin/fovmax) actually
  // match your real zoom range, and confirm the font size is changing.
  var DEBUG = false;
  var lastDebugLogTime = 0;

  var roadLabels = null; // [{name, baseCss}], built lazily once krpano + hotspots exist
  var rafId = null;
  var running = false;

  function kget(path) {
    return window.krpano ? window.krpano.get(path) : null;
  }
  function kset(path, val) {
    if (window.krpano) window.krpano.set(path, val);
  }

  // Scans every hotspot once for names matching ROAD_LABEL_RE, rather than
  // hardcoding a list -- picks up however many roadlabelN hotspots your
  // XML defines. Captures each one's current css as the "base" style to
  // preserve (font-family/color/text-align/etc.) while this script only
  // ever touches the font-size portion of it from here on.
  // Captures each hotspot's CURRENT css as the "base" style to preserve
  // (font-family/color/text-align/etc.) -- this script only ever touches
  // the font-size portion of it from here on, via withFontSize() below.
  //
  // IMPORTANT: does NOT touch hotspot[name].html. For these XML-defined
  // road label hotspots, .html is not an on/off flag -- it IS the actual
  // displayed text (e.g. "7.20M WIDE ROAD" lives in that exact property).
  // An earlier version of this script force-set it to "1" to try to force
  // html/css rendering, which silently replaced every road label's real
  // text with the literal string "1" -- the font-size scaling itself was
  // never the problem (confirmed by the debug log below), so that forcing
  // was both unnecessary and destructive. Don't reintroduce it.
  function collectRoadLabels() {
    var kr = window.krpano;
    if (!kr) return [];
    var count = parseInt(kr.get("hotspot.count"), 10);
    if (!count || isNaN(count)) return [];
    var list = [];
    for (var i = 0; i < count; i++) {
      var name = kr.get("hotspot[" + i + "].name");
      if (!name || !ROAD_LABEL_RE.test(name)) continue;
      var css = kr.get("hotspot[" + name + "].css") || "";
      list.push({ name: name, baseCss: css });
    }
    if (DEBUG && list.length) {
      var b = fovBounds();
      console.log("road-label-zoom: found", list.length, "road labels;",
        "view.fov bounds in use: min=" + b.min + " max=" + b.max,
        "(from view.fovmin/fovmax if set, else the FALLBACK_FOV_* constants)");
    }
    return list;
  }

  function fovBounds() {
    var kr = window.krpano;
    var min = kr ? parseFloat(kr.get("view.fovmin")) : NaN;
    var max = kr ? parseFloat(kr.get("view.fovmax")) : NaN;
    if (!isFinite(min) || min <= 0) min = FALLBACK_FOV_MIN;
    if (!isFinite(max) || max <= 0) max = FALLBACK_FOV_MAX;
    return { min: min, max: max };
  }

  // Replaces (or appends) the font-size declaration in a css string,
  // leaving every other declaration untouched.
  function withFontSize(css, px) {
    var decl = "font-size:" + px.toFixed(2) + "px;";
    var re = /font-size\s*:\s*[\d.]+\s*px\s*;?/i;
    if (re.test(css)) return css.replace(re, decl);
    var sep = css && !/;\s*$/.test(css.trim()) ? "; " : "";
    return css + sep + decl;
  }

  function update() {
    if (!running) return;
    var kr = window.krpano;
    if (kr) {
      if (!roadLabels) roadLabels = collectRoadLabels();
      if (roadLabels.length) {
        var fov = parseFloat(kr.get("view.fov"));
        if (isFinite(fov)) {
          var b = fovBounds();
          // fov SHRINKS as the user zooms in, so invert it: t=0 at
          // fovmax (zoomed all the way out) -> MIN_FONT_PX, t=1 at
          // fovmin (zoomed all the way in) -> MAX_FONT_PX.
          var t = (b.max - fov) / (b.max - b.min);
          if (t < 0) t = 0;
          if (t > 1) t = 1;
          var px = MIN_FONT_PX + t * (MAX_FONT_PX - MIN_FONT_PX);
          if (DEBUG) {
            var now = Date.now();
            if (now - lastDebugLogTime > 2000) {
              lastDebugLogTime = now;
              console.log("road-label-zoom: fov=" + fov.toFixed(2) +
                " -> t=" + t.toFixed(2) + " -> font-size=" + px.toFixed(2) + "px");
            }
          }
          for (var i = 0; i < roadLabels.length; i++) {
            var rl = roadLabels[i];
            kset("hotspot[" + rl.name + "].css", withFontSize(rl.baseCss, px));
          }
        }
      }
    }
    rafId = requestAnimationFrame(update);
  }

  function start() {
    if (running) return;
    running = true;
    roadLabels = null; // re-scan in case hotspots were added/reloaded since last start
    update();
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // Auto-start once krpano is available; if it isn't yet (script loaded
  // before embedpano's onready fires), poll a few times a second rather
  // than failing silently.
  function waitForKrpanoThenStart() {
    if (window.krpano) {
      start();
    } else {
      window.setTimeout(waitForKrpanoThenStart, 200);
    }
  }
  waitForKrpanoThenStart();

  // Exposed for manual control / debugging from the console, same
  // pattern as window.plotPopup / window.plotFilterPanel.
  window.roadLabelZoom = {
    start: start,
    stop: stop,
    // Force an immediate re-scan of hotspot names, e.g. after adding
    // more roadlabelN hotspots at runtime.
    refresh: function () { roadLabels = null; }
  };
})();
