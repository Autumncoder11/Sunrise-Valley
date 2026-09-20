/* =========================================================================
   filter-panel.js
   Facing + Status + Property size (min/max sqft) filter bar, with Search / Reset /
   Close. Delegates plot dim/highlight to window.plotPopup.applyFilter() /
   clearFilter() (see plot-popup.js).

   Opening/closing is driven EXTERNALLY (by action-bar.js's Filter icon),
   not by a button this file renders itself:
       window.plotFilterPanel.toggle()
       window.plotFilterPanel.open()
       window.plotFilterPanel.close()
       window.plotFilterPanel.isOpen()   -> boolean

   Dispatches on `document`:
       "plotfilter:searched" -> { detail: { count } }   (Search pressed, criteria set)
       "plotfilter:reset"    -> (Reset pressed, or Search pressed with no criteria)
   action-bar.js listens for these to show a match-count badge on its
   Filter icon.

   REQUIRES:
   - filter-panel.css included in the page.
   - plot-popup.js loaded first (window.plotPopup must exist by the time
     Search is clicked).
   - A container div in your HTML: <div id="plotFilterRoot"></div>
   ========================================================================= */

(function () {
  "use strict";

  // Adjust this list if the project uses fewer/different facing options —
  // values are matched against plot.facing in plot-popup.js by loose
  // case/spacing-insensitive comparison (see normalizeFacing there).
  var FACING_OPTIONS = [
    "North", "North East", "East", "South East",
    "South", "South West", "West", "North West"
  ];

  // label shown in the dropdown -> status key matched in plot-popup.js
  // (normalizeStatus there maps HOLD / ON HOLD to RESERVED, so "Hold"
  // catches plots stored under either name).
  var STATUS_OPTIONS = [
    { label: "Available", value: "AVAILABLE" },
    { label: "Sold", value: "SOLD" },
    { label: "Hold", value: "RESERVED" },
    { label: "Booked", value: "BOOKED" }
  ];

  var panelOpen = false;
  var barEl = null;

  function el(tag, className, html) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function buildFacingOptions(select) {
    var allOpt = el("option", null, "All facings");
    allOpt.value = "";
    select.appendChild(allOpt);
    FACING_OPTIONS.forEach(function (label) {
      var opt = el("option", null, label);
      opt.value = label;
      select.appendChild(opt);
    });
  }

  function buildStatusOptions(select) {
    var allOpt = el("option", null, "All statuses");
    allOpt.value = "";
    select.appendChild(allOpt);
    STATUS_OPTIONS.forEach(function (o) {
      var opt = el("option", null, o.label);
      opt.value = o.value;
      select.appendChild(opt);
    });
  }

  function render(root) {
    root.innerHTML = "";

    var bar = el("div", "plot-filter-bar");
    bar.style.display = "none"; // closed by default — opened via the action bar's Filter icon
    bar.style.position = "relative";

    // Facing field
    var facingField = el("div", "plot-filter-field");
    facingField.appendChild(el("label", "plot-filter-label", "Facing"));
    var facingSelect = el("select", "plot-filter-select");
    buildFacingOptions(facingSelect);
    facingField.appendChild(facingSelect);
    bar.appendChild(facingField);

    // Status field
    var statusField = el("div", "plot-filter-field");
    statusField.appendChild(el("label", "plot-filter-label", "Status"));
    var statusSelect = el("select", "plot-filter-select");
    buildStatusOptions(statusSelect);
    statusField.appendChild(statusSelect);
    bar.appendChild(statusField);

    // Property size field
    var sizeField = el("div", "plot-filter-field");
    sizeField.appendChild(el("label", "plot-filter-label", "Property Size"));
    var sizeGroup = el("div", "plot-filter-size-group");

    var minInput = el("input", "plot-filter-input");
    minInput.type = "number";
    minInput.min = "0";
    minInput.placeholder = "Min";
    sizeGroup.appendChild(minInput);

    var maxInput = el("input", "plot-filter-input");
    maxInput.type = "number";
    maxInput.min = "0";
    maxInput.placeholder = "Max";
    sizeGroup.appendChild(maxInput);

    var unit = el("div", "plot-filter-unit");
    unit.innerHTML =
      'Sqft <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M4 20 L10 20 M4 20 L4 14 M4 20 L20 4 M20 4 L20 10 M20 4 L14 4" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    sizeGroup.appendChild(unit);

    sizeField.appendChild(sizeGroup);
    bar.appendChild(sizeField);

    // Actions
    var actions = el("div", "plot-filter-actions");

    var closeBtn = el("button", "plot-filter-icon-btn plot-filter-close", "&times;");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close filters");
    actions.appendChild(closeBtn);

    var searchBtn = el("button", "plot-filter-search", "SEARCH");
    searchBtn.type = "button";
    actions.appendChild(searchBtn);

    var resetBtn = el("button", "plot-filter-icon-btn plot-filter-reset", "&#8635;");
    resetBtn.type = "button";
    resetBtn.setAttribute("aria-label", "Reset filters");
    actions.appendChild(resetBtn);

    bar.appendChild(actions);
    root.appendChild(bar);

    // Result count (appears under the bar after a search)
    var countEl = el("div", "plot-filter-result-count");
    countEl.style.display = "none";
    bar.appendChild(countEl);

    // ---- Wiring ----
    function currentFilter() {
      var facing = facingSelect.value || null;
      var status = statusSelect.value || null;
      var minVal = minInput.value !== "" ? parseFloat(minInput.value) : null;
      var maxVal = maxInput.value !== "" ? parseFloat(maxInput.value) : null;
      return {
        facing: facing,
        status: status,
        minSqft: (minVal != null && isFinite(minVal)) ? minVal : null,
        maxSqft: (maxVal != null && isFinite(maxVal)) ? maxVal : null
      };
    }

    function hasAnyCriteria(filter) {
      return !!(filter.facing || filter.status || filter.minSqft != null || filter.maxSqft != null);
    }

    function showCount(n) {
      countEl.style.display = "block";
      countEl.classList.toggle("plot-filter-result-count--none", n === 0);
      countEl.textContent = n === 0
        ? "No matching plots"
        : n + " matching plot" + (n === 1 ? "" : "s");
    }

    function hideCount() {
      countEl.style.display = "none";
    }

    searchBtn.addEventListener("click", function () {
      if (!window.plotPopup || typeof window.plotPopup.applyFilter !== "function") {
        console.error("filter-panel: window.plotPopup.applyFilter not available yet");
        return;
      }
      var filter = currentFilter();
      if (!hasAnyCriteria(filter)) {
        window.plotPopup.clearFilter();
        hideCount();
        document.dispatchEvent(new CustomEvent("plotfilter:reset"));
        return;
      }
      var count = window.plotPopup.applyFilter(filter);
      showCount(count);
      document.dispatchEvent(new CustomEvent("plotfilter:searched", { detail: { count: count } }));
    });

    resetBtn.addEventListener("click", function () {
      facingSelect.value = "";
      statusSelect.value = "";
      minInput.value = "";
      maxInput.value = "";
      hideCount();
      if (window.plotPopup && typeof window.plotPopup.clearFilter === "function") {
        window.plotPopup.clearFilter();
      }
      document.dispatchEvent(new CustomEvent("plotfilter:reset"));
    });

    // Close just hides the bar — it does NOT clear an already-applied
    // filter, so dimmed plots stay dimmed while exploring the tour.
    closeBtn.addEventListener("click", function () { setOpen(false); });

    // Re-run search live when Enter is pressed in either size input.
    [minInput, maxInput].forEach(function (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") searchBtn.click();
      });
    });

    barEl = bar;
  }

  function setOpen(open) {
    panelOpen = open;
    if (barEl) barEl.style.display = open ? "flex" : "none";
  }

  function init() {
    var root = document.getElementById("plotFilterRoot");
    if (!root) {
      console.error("filter-panel: #plotFilterRoot container not found in DOM");
      return;
    }
    render(root);

    window.plotFilterPanel = {
      open: function () { setOpen(true); },
      close: function () { setOpen(false); },
      toggle: function () { setOpen(!panelOpen); },
      isOpen: function () { return panelOpen; }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
