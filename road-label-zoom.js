/* =========================================================================
   road-label-zoom.js  (visibility only)

   roadlabel16, roadlabel17 and roadlabel18 stay hidden until the user
   zooms in closer, and hide again when zooming out.

   Nothing else is changed: font size, colour and text stay exactly as
   set in your XML. All other road labels are untouched.

   A tiny check runs every 200 ms and only touches krpano when the state
   flips. Requires window.krpano (same as plot-popup.js).
   ========================================================================= */

(function () {
  "use strict";

  var NAMES = ["roadlabel16", "roadlabel17", "roadlabel18"];

  // Labels show when view.fov is at or below this (smaller = more zoomed in).
  // Zoomed out is about 140, max zoom is about 12.
  // Raise it to show labels earlier, lower it to show them only closer in.
  var SHOW_BELOW_FOV = 60;
  var HIDE_ABOVE_FOV = 63; // small gap so they don't flicker

  var ready = false, shown = false, lastCount = -1, timer = null;

  function K() { return window.krpano; }

  // Start hidden (only sets visibility, nothing else).
  function setup() {
    var kr = K();
    lastCount = parseInt(kr.get("hotspot.count"), 10);
    var found = 0;
    for (var i = 0; i < NAMES.length; i++) {
      var base = "hotspot[" + NAMES[i] + "]";
      if (!kr.get(base + ".name")) continue;
      kr.set(base + ".visible", false);
      found++;
    }
    shown = false;
    ready = found > 0;
  }

  function setVisible(v) {
    var kr = K();
    for (var i = 0; i < NAMES.length; i++) {
      kr.set("hotspot[" + NAMES[i] + "].visible", v);
    }
    shown = v;
  }

  function check() {
    var kr = K();
    if (!kr) return;
    // (Re)run setup if not done yet or if hotspots were reloaded.
    if (!ready || parseInt(kr.get("hotspot.count"), 10) !== lastCount) setup();
    if (!ready) return;

    var fov = parseFloat(kr.get("view.fov"));
    if (!isFinite(fov)) return;

    if (!shown && fov <= SHOW_BELOW_FOV) setVisible(true);
    else if (shown && fov > HIDE_ABOVE_FOV) setVisible(false);
  }

  function start() {
    if (timer) return;
    timer = window.setInterval(check, 200);
  }

  (function wait() { if (K()) start(); else window.setTimeout(wait, 200); })();

  // Console helpers: roadLabelZoom.show(true/false)
  window.roadLabelZoom = {
    show: function (v) { setVisible(!!v); },
    stop: function () { if (timer) { clearInterval(timer); timer = null; } }
  };
})();
