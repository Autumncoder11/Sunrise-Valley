/* ============================================================
   plot-popup-mobile.js
   Adds tap-to-collapse/expand on the plot popup's header, so on
   mobile the user can shrink the sheet down to a thin strip
   (just the plot name + status) to see the full CAD map, then
   tap again to bring back the side dimensions.

   INCLUDE THIS AFTER plot-popup.js (and plot-popup-mobile.css):
     <script src="plot-popup.js"></script>
     <script src="plot-popup-mobile.js"></script>

   Implementation note: renderPopup() in plot-popup.js rewrites
   #plotPopupRoot's innerHTML every time a plot is clicked, which
   would wipe out any listener attached directly to the header.
   So instead this attaches ONE delegated listener on the root
   container itself (which is never replaced, only its contents),
   and matches clicks that land on .plot-popup-header.
   ============================================================ */

(function () {
  "use strict";

  function onRootClick(e) {
    var header = e.target.closest && e.target.closest(".plot-popup-header");
    if (!header) return;
    // Don't toggle collapse when the tap was on the close (×) button.
    if (e.target.closest(".plot-popup-close")) return;

    var card = header.closest(".plot-popup-card");
    if (!card) return;
    card.classList.toggle("pp-collapsed");
  }

  function attach() {
    var root = document.getElementById("plotPopupRoot");
    if (!root) return;
    root.addEventListener("click", onRootClick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
})();
