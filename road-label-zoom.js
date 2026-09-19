/* =========================================================================
   road-label-zoom.js  (minimal version)

   Only roadlabel16, roadlabel17 and roadlabel18 are handled:
   they stay hidden until the user zooms in a bit closer to max zoom,
   and hide again when zooming out. All other road labels are untouched
   (always visible).

   No font scaling, no colours, no per-frame work: a tiny check runs
   every 200 ms and only touches krpano when the state flips.

   Requires window.krpano (same as plot-popup.js).
   ========================================================================= */

(function () {
  "use strict";

  var NAMES = ["roadlabel16", "roadlabel17", "roadlabel18"];

  // Labels show when view.fov is at or below this (smaller = more zoomed in).
  // Your tour's max zoom is about fov 12, zoomed out is 140.
  // Raise this number to show labels EARLIER (less zoom needed),
  // lower it to show them only closer to max zoom.
  var SHOW_BELOW_FOV = 40;
  var HIDE_ABOVE_FOV = 43; // small gap so they don't flicker

  // Font size once visible (your XML has 100px, which is far too big).
  var FONT_PX = 15;

  var ready = false, shown = false, lastCount = -1, timer = null;

  function K() { return window.krpano; }

  function setup() {
    var kr = K();
    lastCount = parseInt(kr.get("hotspot.count"), 10);
    var found = 0;
    for (var i = 0; i < NAMES.length; i++) {
      var base = "hotspot[" + NAMES[i] + "]";
      if (!kr.get(base + ".name")) continue;
      var css = kr.get(base + ".css") || "";
      css = /font-size\s*:[^;]*;*/i.test(css)
        ? css.replace(/font-size\s*:[^;]*;*/i, "font-size:" + FONT_PX + "px;")
        : css + "; font-size:" + FONT_PX + "px;";
      kr.set(base + ".css", css.replace(/;{2,}/g, ";"));
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
