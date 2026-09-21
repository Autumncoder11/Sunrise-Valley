/* =========================================================================
   brand-logo.js
   Small "Sunrise Valley" logo pinned to the corner of the page.

   - Desktop / mouse devices: top-left, level with the action bar pills.
   - Touch devices (phones/tablets): bottom-left, because the action bar
     already fills the width of the screen at the top there.

   The logo image is embedded below (LOGO_SRC), the same picture as the
   loading screen's, so this file works on its own -- nothing else has to
   be present. It sits underneath the loading overlay (z-index 5000 vs the
   overlay's 9999), so it only appears once the loading screen has faded.

   INCLUDE (anywhere in index.html's <body>, e.g. after action-bar.js):
     <script src="brand-logo.js?v=YYYYMMDDHHMM"></script>

   To remove it: delete that script tag.
   ========================================================================= */

(function () {
  "use strict";

  var LOGO_ID = "brandLogo";

  var LOGO_SRC = "data:image/png;base64,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";

  var CSS = [
    "#" + LOGO_ID + " {",
    "  position: fixed;",
    "  top: 22px;",
    "  left: 20px;",
    "  z-index: 5000;",
    "  display: flex;",
    "  align-items: center;",
    "  height: 54px;",
    "  box-sizing: border-box;",
    "  padding: 0 14px;",
    "  border-radius: 999px;",
    /* The logo's lettering is dark navy, so it sits on a light frosted-glass
       pill (same family as the action bar pills) to stay readable over the
       dark tree canopy behind it. */
    "  background: rgba(255, 255, 255, 0.88);",
    "  -webkit-backdrop-filter: blur(14px) saturate(160%);",
    "  backdrop-filter: blur(14px) saturate(160%);",
    "  border: 1px solid rgba(255, 255, 255, 0.7);",
    "  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);",
    "  pointer-events: none;", /* never blocks dragging the panorama */
    "}",
    "#" + LOGO_ID + " img {",
    "  display: block;",
    "  height: 42px;",
    "  width: auto;",
    "}",
    "html.is-touch-device #" + LOGO_ID + " {",
    "  top: auto;",
    "  left: calc(10px + env(safe-area-inset-left, 0px));",
    "  bottom: calc(12px + env(safe-area-inset-bottom, 0px));",
    "  height: 44px;",
    "  padding: 0 12px;",
    "}",
    "html.is-touch-device #" + LOGO_ID + " img {",
    "  height: 30px;",
    "}"
  ].join("\n");

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
      document.mozFullScreenElement || document.msFullscreenElement || null;
  }

  // Same idea as the overlay-moving code in index.html: while krpano has an
  // element fullscreen, only that element's descendants are painted, so the
  // logo has to live inside it for as long as fullscreen lasts.
  function onFullscreenChange() {
    var logo = document.getElementById(LOGO_ID);
    if (!logo) return;
    var fs = fullscreenElement();
    if (fs && fs !== document.documentElement) {
      var r = fs.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && logo.parentNode !== fs) fs.appendChild(logo);
    } else if (logo.parentNode !== document.body) {
      document.body.appendChild(logo);
    }
  }

  function init() {
    if (document.getElementById(LOGO_ID)) return;

    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var box = document.createElement("div");
    box.id = LOGO_ID;
    var img = document.createElement("img");
    img.src = LOGO_SRC;
    img.alt = "Sunrise Valley";
    box.appendChild(img);
    document.body.appendChild(box);
    console.log("brand-logo: logo added");

    ["fullscreenchange", "webkitfullscreenchange",
      "mozfullscreenchange", "MSFullscreenChange"].forEach(function (evt) {
        document.addEventListener(evt, onFullscreenChange);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
