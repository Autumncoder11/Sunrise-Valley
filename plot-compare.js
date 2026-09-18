/* =========================================================================
   plot-compare.js
   Side-by-side comparison of up to CONFIG.maxPlots plots -- area, facing,
   corner-plot status, and every side dimension either plot has.

   HOW A PLOT GETS INTO THE COMPARE LIST:
   - plot-popup.js's popup shows a "+ Add to Compare" button (added there
     directly) that calls window.plotCompare.toggle(hotspotName). That's
     the only entry point -- there's no separate "compare mode" click
     handling on the pano itself, so normal plot-click behaviour (open
     popup, see dimensions) is completely unaffected.
   - The Compare pill in the action bar (action-bar.js) shows a running
     count badge and opens/closes this panel.

   REQUIRES:
   - plot-popup.js loaded BEFORE this file -- it reads plot data and the
     getAreaSqft/facingToLabel/formatSqft/isCornerPlot helpers off
     window.plotPopup, all exposed there for exactly this reuse.
   - plot-compare.css included in the page.
   - A container div in your HTML: <div id="plotCompareRoot"></div>
   ========================================================================= */

(function () {
  "use strict";

  // ---- CONFIG -------------------------------------------------------------
  var CONFIG = {
    // How many plots can be queued up at once. The panel lays out in
    // columns either way, so raising this to 3+ doesn't need any other
    // code changes -- just more screen width per column.
    maxPlots: 2
  };

  var selected = [];      // ordered array of hotspotName strings
  var panelOpen = false;

  function dataFor(hotspotName) {
    return window.plotPopup && typeof window.plotPopup.getPlotData === "function"
      ? window.plotPopup.getPlotData(hotspotName)
      : null;
  }

  // Lets action-bar.js's badge (and plot-popup.js's own compare button,
  // for the plot currently open) repaint themselves without this file
  // needing to know either of those DOM structures.
  function fireChanged() {
    document.dispatchEvent(new CustomEvent("plotcompare:changed", {
      detail: { count: selected.length, max: CONFIG.maxPlots, selected: selected.slice() }
    }));
  }

  function isSelected(hotspotName) {
    return selected.indexOf(hotspotName) !== -1;
  }

  // Returns true if hotspotName is now in the list, false if the list was
  // already at maxPlots and this plot got rejected.
  function addPlot(hotspotName) {
    if (isSelected(hotspotName)) return true;
    if (selected.length >= CONFIG.maxPlots) return false;
    selected.push(hotspotName);
    fireChanged();
    if (panelOpen) renderPanel();
    return true;
  }

  function removePlot(hotspotName) {
    var idx = selected.indexOf(hotspotName);
    if (idx === -1) return;
    selected.splice(idx, 1);
    fireChanged();
    if (panelOpen) renderPanel();
  }

  // Used by the popup's own "+ Add to Compare" / "Remove" button. Returns
  // the same true/false addPlot() would (removal always "succeeds", so it
  // returns false to mean "not selected any more").
  function toggle(hotspotName) {
    if (isSelected(hotspotName)) {
      removePlot(hotspotName);
      return false;
    }
    return addPlot(hotspotName);
  }

  function clear() {
    selected = [];
    fireChanged();
    if (panelOpen) renderPanel();
  }

  // ---- Formatting (delegates to plot-popup.js so a compared value is
  // always worded exactly like the popup's own, e.g. "2,400 sq ft" or
  // "North East") ------------------------------------------------------
  function fmtArea(plot) {
    if (plot.area != null) return plot.area;
    var sqft = window.plotPopup.getAreaSqft(plot);
    return sqft != null ? (window.plotPopup.formatSqft(sqft) + " sq ft") : "\u2014";
  }

  function toTitleCase(s) {
    return s.replace(/\w\S*/g, function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  }

  function fmtFacing(plot) {
    var label = window.plotPopup.facingToLabel(plot.facing);
    return label ? toTitleCase(label) : "\u2014";
  }

  function fmtStatus(plot) {
    return plot.status ? plot.status.toUpperCase() : "AVAILABLE";
  }

  // Union of every side letter present on ANY compared plot, sorted --
  // so a 4-sided plot and a 5-sided plot compared together both get a
  // full set of rows, with "\u2014" standing in for a letter one of them
  // doesn't have.
  function allSideLetters(plots) {
    var set = {};
    plots.forEach(function (p) {
      Object.keys(p.sides || {}).forEach(function (letter) { set[letter] = true; });
    });
    return Object.keys(set).sort();
  }

  // ---- Panel rendering ------------------------------------------------
  // Everything is emitted as ONE flat run of grid children (header row,
  // then one label+cells row per attribute) so a single
  // grid-template-columns on the parent keeps every row's cells aligned
  // under the right plot -- no separate header grid to keep in sync with
  // the body grid's column widths.
  function renderPanel() {
    var root = document.getElementById("plotCompareRoot");
    if (!root) {
      console.error("plot-compare: #plotCompareRoot container not found in DOM");
      return;
    }

    var plots = selected.map(dataFor).filter(Boolean);
    var cells = [];

    // Corner cell of the header row -- intentionally blank, just keeps
    // the grid's first column (row labels) aligned under itself.
    cells.push('<div class="plot-compare-corner"></div>');

    plots.forEach(function (plot) {
      cells.push(
        '<div class="plot-compare-col-header">' +
        '<button class="plot-compare-remove" data-hotspot="' + plot.hotspotName + '" aria-label="Remove from comparison">&times;</button>' +
        '<div class="plot-compare-name">' + plot.displayName + '</div>' +
        '<span class="plot-compare-status">' + fmtStatus(plot) + '</span>' +
        '</div>'
      );
    });

    function addRow(label, valueFn, extraClassFn) {
      cells.push('<div class="plot-compare-row-label">' + label + '</div>');
      plots.forEach(function (plot) {
        var extra = extraClassFn ? extraClassFn(plot) : "";
        cells.push('<div class="plot-compare-cell' + (extra ? " " + extra : "") + '">' + valueFn(plot) + '</div>');
      });
    }

    addRow("Area", fmtArea);
    addRow("Facing", fmtFacing);
    addRow("Corner Plot", function (plot) {
      return window.plotPopup.isCornerPlot(plot) ? "Yes" : "No";
    }, function (plot) {
      return window.plotPopup.isCornerPlot(plot) ? "plot-compare-cell--yes" : "";
    });

    var letters = allSideLetters(plots);
    if (letters.length) {
      cells.push('<div class="plot-compare-divider" style="grid-column: 1 / -1;"></div>');
      letters.forEach(function (letter) {
        addRow("Side " + letter, function (plot) {
          var val = plot.sides && plot.sides[letter];
          return val != null ? val : "\u2014";
        });
      });
    }

    var emptyStateHtml =
      '<div class="plot-compare-empty">' +
      'Open a plot and tap <strong>+ Add to Compare</strong> to queue it here' +
      ' (up to ' + CONFIG.maxPlots + ' at a time).' +
      '</div>';

    var hintHtml = (plots.length === 1)
      ? '<div class="plot-compare-hint">Add one more plot to compare them side by side.</div>'
      : "";

    root.innerHTML =
      '<div class="plot-compare-backdrop">' +
      '<div class="plot-compare-card">' +
      '<div class="plot-compare-header">' +
      '<h2 class="plot-compare-title">Compare Plots</h2>' +
      '<button class="plot-compare-close" aria-label="Close">&times;</button>' +
      '</div>' +
      (plots.length === 0
        ? emptyStateHtml
        : hintHtml +
          '<div class="plot-compare-grid" style="grid-template-columns: minmax(90px, auto) repeat(' + plots.length + ', minmax(120px, 1fr));">' +
          cells.join("") +
          '</div>' +
          '<button class="plot-compare-clear">Clear All</button>') +
      '</div>' +
      '</div>';

    root.style.display = "block";

    var backdrop = root.querySelector(".plot-compare-backdrop");
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closePanel(); // click outside the card
    });
    root.querySelector(".plot-compare-close").addEventListener("click", closePanel);
    var clearBtn = root.querySelector(".plot-compare-clear");
    if (clearBtn) clearBtn.addEventListener("click", clear);
    root.querySelectorAll(".plot-compare-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        removePlot(btn.getAttribute("data-hotspot"));
      });
    });
  }

  function openPanel() {
    // Close any open plot popup first -- otherwise it can visually sit on
    // top of (or just clutter alongside) the comparison panel, since both
    // are full-detail cards competing for the same screen space.
    if (typeof window.closePlotPopup === "function") window.closePlotPopup();
    panelOpen = true;
    renderPanel();
  }

  function closePanel() {
    panelOpen = false;
    var root = document.getElementById("plotCompareRoot");
    if (root) {
      root.style.display = "none";
      root.innerHTML = "";
    }
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  window.plotCompare = {
    toggle: toggle,
    addPlot: addPlot,
    removePlot: removePlot,
    isSelected: isSelected,
    clear: clear,
    getSelected: function () { return selected.slice(); },
    openPanel: openPanel,
    closePanel: closePanel,
    togglePanel: togglePanel,
    isPanelOpen: function () { return panelOpen; },
    maxPlots: CONFIG.maxPlots
  };
})();
