/* =========================================================================
   brand-logo.js
   Small "Sunrise Valley" logo pinned to the corner of the page.

   - Desktop / mouse devices: top-left, level with the action bar pills.
   - Touch devices (phones/tablets): bottom-left, because the action bar
     already fills the width of the screen at the top there.

   The logo image is NOT stored here -- it reuses the one already on the
   loading screen (#loadingOverlay .mark img in index.html), so if you ever
   swap the logo there this one changes with it. It sits underneath the
   loading overlay (z-index 5000 vs the overlay's 9999), so it only appears
   once the loading screen has faded away.

   INCLUDE (anywhere in index.html's <body>, e.g. after action-bar.js):
     <script src="brand-logo.js?v=YYYYMMDDHHMM"></script>

   To remove it: delete that script tag.
   ========================================================================= */

(function () {
  "use strict";

  var LOGO_ID = "brandLogo";

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

    // Reuse the loading-screen logo so there is only one copy of the image.
    var source = document.querySelector("#loadingOverlay .mark img");
    if (!source || !source.getAttribute("src")) {
      console.warn("brand-logo: loading-screen logo not found, nothing to show");
      return;
    }

    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var box = document.createElement("div");
    box.id = LOGO_ID;
    var img = document.createElement("img");
    img.src = source.getAttribute("src");
    img.alt = "Sunrise Valley";
    box.appendChild(img);
    document.body.appendChild(box);

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
