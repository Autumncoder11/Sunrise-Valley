/* =========================================================================
   plot-popup.js
   Plot click -> per-side dimension labels (on the panorama) + info popup.

   REQUIRES:
   - window.krpano to be set to the krpano interface object, e.g. in your
     embedpano() call:
         embedpano({..., onready: function(krpanoInterface){
             krpano = krpanoInterface;   // must be a global
         }});
   - all_plots_matched.json loaded into PLOT_DATA before any plot is
     clicked. See loadPlotData() below. (No separate plots-data.json is
     used — status/area/category/facing/areaSqft live directly on each
     entry now; a plot missing one just falls back to that field's
     default, e.g. AVAILABLE for status, no special color for category.)
   - hotspots_updated.xml loaded into your tour (each plot hotspot's onclick
     now calls: js(showPlotDetails('kml_poly_N'));
   - plot-popup.css included in the page.
   - A container div in your HTML:  <div id="plotPopupRoot"></div>
   ========================================================================= */

(function () {
  "use strict";

  // ---- Config ------------------------------------------------------------
  var MAX_SIDE_LABELS = 8;      // pool size; covers any polygon up to 8 sides
  var LABEL_PREFIX = "sidelabel_";

  // Colors lifted directly from the reference flat-map (index.html) so the
  // krpano hotspots match the legend exactly.
  var COLOR = {
    availableFill: "0x00FF00",
    soldFill: "0xFED7AA",
    activeFill: "0xFDE68A",     // click highlight, same as the reference's .active
    defaultBorder: "0x000000",
    categoryBorder: {
      EB: "0x2563EB",
      LB: "0x9333EA",
      PARK: "0x059669",
      CORNER: "0xDB2777"
    },
    categoryFillAvailable: {
      EB: "0xBFDBFE",
      LB: "0xE9D5FF",
      PARK: "0xA7F3D0",
      CORNER: "0xFBCFE8"
    }
  };
  var CATEGORY_BORDERWIDTH = 3;
  var DEFAULT_BORDERWIDTH = 1;
  var ACTIVE_BORDERWIDTH = 3;

  var PLOT_DATA = {};           // populated by loadPlotData()
  var currentSelected = null;   // hotspot name currently highlighted
  var dataReady = false;
  var pendingClick = null;      // if a click happens before data loads

  // Other scripts (e.g. road_label_editor.js's Plot Dimension Editor) need
  // this SAME processed PLOT_DATA -- specifically the sidesRing computed by
  // buildCadRing() below -- rather than re-fetching and re-parsing
  // all_plots_matched.json themselves. A second, independent parse doesn't
  // reconstruct the true A->B->C->... polygon order the way buildCadRing()
  // does, so letters ended up paired with the wrong edge in that tool. See
  // window.plotPopup.onReady()/getPlotData()/matchSidesToEdges() below.
  var dataReadyCallbacks = [];

  // Live-tracking: re-run label placement on every render frame while a
  // plot is selected, so labels stay locked exactly to their edge as the
  // user pans or zooms — using requestAnimationFrame (tied to the browser's
  // actual paint cycle) instead of a fixed-interval timer, which visibly
  // lagged a beat behind during an active zoom/drag gesture.
  var labelRefreshRAF = null;

  // Per-selection cache for the parts of drawSideLabels() that do NOT
  // depend on the current camera view (zoom/pan) -- the hotspot's raw
  // ath/atv polygon points (getPolygonPoints), the letter<->edge match
  // (matchSidesToEdges), and the polygon centroid. Recomputing these every
  // requestAnimationFrame tick (60x/sec) was pure waste: each call to
  // getPolygonPoints() round-trips through krpano's get() bridge once per
  // vertex, and matchSidesToEdges() re-runs its O(n^2) alignment search --
  // all for a result that can only change when a DIFFERENT plot is
  // selected. That extra bridge traffic piling up on top of krpano's own
  // per-frame work during an active pinch/scroll-zoom is what shows up as
  // visible lag. Only the screen-space projection (sphereToScreen) truly
  // needs to run every frame, since that's what actually changes as the
  // user zooms/pans.
  var labelCache = null; // { hotspotName, pts, edgeInfo, centroid }

  function getCachedPolygonData(hotspotName, plot) {
    if (labelCache && labelCache.hotspotName === hotspotName) {
      return labelCache;
    }
    var pts = getPolygonPoints(hotspotName);
    var edgeInfo = pts.length ? matchSidesToEdges(pts, plot) : [];
    var centroid = pts.length >= 3 ? polygonCentroid(pts) : null;
    labelCache = { hotspotName: hotspotName, pts: pts, edgeInfo: edgeInfo, centroid: centroid };
    return labelCache;
  }

  // ---- Data loading --------------------------------------------------------
  // Single source of truth: all_plots_matched.json. Keyed by hotspot name,
  // each entry is an ARRAY, one item per edge:
  //   [{ side: "A", length: "45' 0\"", from: [x,y], to: [x,y] }, ...]
  // In most plots side N's "to" point equals side N+1's "from" point (a
  // closed CAD loop), but that does NOT hold for every plot in this file —
  // see buildCadRing() below, which walks the actual from/to points (via
  // nearest-match, not array position) to recover the true A -> B -> C ->
  // ... edge order per plot, tolerating the small floating-point noise and
  // the occasional missing/unlettered bevel edge seen in the raw data. The
  // resulting ring's per-side lengths are then matched against krpano's
  // traced polygon edges in matchSidesToEdges() — using the JSON's own
  // from/to geometry is what makes that match reliable, instead of guessing
  // which traced edge is "A" from a fixed rule like "leftmost vertex".
  //
  // displayName/status/area/category/facing/areaSqft, when present on an
  // entry (see the "wrapped" shape note below), now come straight from
  // this file — no separate plots-data.json is loaded anymore. A plot
  // missing one of these just falls back to that field's own default
  // (AVAILABLE, no category color, excluded from an active facing/size
  // filter). The popup title falls back to a name derived from the
  // hotspot id (see deriveDisplayName below) when displayName is absent.
  var PLOT_DATA_URL = "all_plots_matched.json";

  // Hotspots that are NOT sellable plots traced with lettered CAD side data
  // (EB/LB road-buffer strips, PARK) but ARE real clickable polygons in
  // output_hotspots.xml (onclick="js(showPlotDetails('kml_poly_N'))"), same
  // as every plot. all_plots_matched.json has no entries for these, so
  // without this block they simply don't exist in PLOT_DATA -- clicking
  // them does nothing and they don't show up in the Plot Dimension
  // Editor's dropdown.
  //
  // This only FILLS IN entries that are missing after the real JSON loads
  // (see the "if (data[hotspotName]) return;" guard below) -- it never
  // overwrites real data, so once you've entered and exported real side
  // dimensions for these via road_label_editor.js ("+ Add side" -> type the
  // letter/length -> "Apply to this plot" -> "Export JSON"), this block
  // becomes a no-op for that key from then on.
  //
  // To add/remove which hotspots get a placeholder, edit this map. Each
  // starts with zero sides -- open it in the tour or in the Plot Dimension
  // Editor and use "+ Add side" to type in the real dimensions by hand.
  var PLACEHOLDER_PLOTS = {
    "kml_poly_394": { category: "EB", displayName: "EB" },
    "kml_poly_395": { category: "LB", displayName: "LB" },
    "kml_poly_396": { category: "PARK", displayName: "PARK" },
    "kml_poly_397": { category: "PARK", displayName: "PARK" }
  };

  function addPlaceholderPlots(data) {
    Object.keys(PLACEHOLDER_PLOTS).forEach(function (hotspotName) {
      if (data[hotspotName]) return; // real data already loaded for this key -- don't clobber it
      var cfg = PLACEHOLDER_PLOTS[hotspotName];
      data[hotspotName] = {
        displayName: cfg.displayName || deriveDisplayName(hotspotName),
        sides: {},
        sidesRing: [],
        sideOffsets: null,
        status: cfg.status,
        area: cfg.area,
        category: cfg.category || null,
        needsReview: true // flags it in the Plot Dimension Editor as still needing real values
      };
    });
  }

  // Converts one plot's side array into the { "A": "45' 0\"", ... } shape
  // the rest of this file (matchSidesToEdges, renderPopup) already expects.
  function sidesArrayToObject(sidesArr) {
    var obj = {};
    if (!Array.isArray(sidesArr)) return obj;
    sidesArr.forEach(function (s) {
      if (s && s.side && s.length != null) {
        obj[s.side] = s.length;
      }
    });
    return obj;
  }

  // "kml_poly_12" -> "Plot 12". Adjust this if your hotspot names encode
  // the actual plot number differently.
  function deriveDisplayName(hotspotName) {
    var m = /(\d+)\s*$/.exec(hotspotName);
    return m ? ("Plot " + m[1]) : hotspotName;
  }

  function cadPointDist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  // Walks a plot's raw side array using its actual from/to CAD points to
  // recover the true A -> B -> C -> ... polygon order, instead of trusting
  // that the JSON's array order (or an alphabetical sort of the letters)
  // already matches it. Side N's "to" point should equal side N+1's "from"
  // point; in the real data that's sometimes off by a hair (float/export
  // noise) and sometimes genuinely broken (a corner-cut plot where the
  // bevel edge was never given its own letter -- see the header comment),
  // so this accepts a small tolerance, scaled to the plot's own edge size
  // so it works regardless of the drawing's scale, and gives up (falling
  // back to raw array order) rather than bridging a gap that isn't noise.
  function buildCadRing(sidesArr) {
    var valid = (Array.isArray(sidesArr) ? sidesArr : []).filter(function (s) {
      return s && s.side && s.length != null &&
        Array.isArray(s.from) && s.from.length === 2 &&
        Array.isArray(s.to) && s.to.length === 2;
    });
    if (valid.length < 2) return valid;

    var totalLen = 0;
    valid.forEach(function (s) { totalLen += cadPointDist(s.from, s.to); });
    var avgLen = totalLen / valid.length;
    var tolerance = avgLen * 0.05; // ~5%: covers export noise, not real gaps

    var remaining = valid.slice();
    var ring = [remaining.shift()];

    while (remaining.length) {
      var cur = ring[ring.length - 1];
      var bestIdx = -1, bestDist = Infinity;
      for (var i = 0; i < remaining.length; i++) {
        var d = cadPointDist(cur.to, remaining[i].from);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      if (bestIdx === -1 || bestDist > tolerance) {
        // Chain doesn't continue cleanly -- bail out and fall back to the
        // JSON's own array order rather than guessing a connection.
        console.warn("plot-popup: could not fully chain from/to points for a plot " +
          "(gap " + bestDist.toFixed(3) + " > tolerance " + tolerance.toFixed(3) +
          "); using raw side order instead.");
        return valid;
      }
      ring.push(remaining.splice(bestIdx, 1)[0]);
    }
    return ring;
  }

  function loadPlotData(url) {
    url = url || PLOT_DATA_URL;
    var resolvedUrl = url;
    fetch(url)
      .then(function (r) {
        resolvedUrl = r.url; // final URL after any redirect, for debugging
        return r.json();
      })
      .then(function (rawData) {
        // DEBUG: confirms which file actually loaded and how many plots it
        // has -- remove this once you've confirmed the right file is being
        // served (see console).
        console.log("plot-popup: loaded", Object.keys(rawData).length,
          "plots from", resolvedUrl);
        var data = {};
        Object.keys(rawData).forEach(function (hotspotName) {
          var entry = rawData[hotspotName];
          // Two shapes are accepted per plot key:
          //  - the original bare array: [{side, length, from, to}, ...]
          //  - a wrapped object produced by the Plot Dimension Editor
          //    (road_label_editor.js) once you've edited/exported that
          //    plot: { sides: [...], sideOffsets: {...}, displayName,
          //    status, area, category, needsReview }. Untouched plots stay
          //    as bare arrays even after an export, so both shapes can be
          //    mixed in the same file.
          var isWrapped = entry && !Array.isArray(entry) && Array.isArray(entry.sides);
          var sidesArr = isWrapped ? entry.sides : (Array.isArray(entry) ? entry : []);
          var extra = isWrapped ? entry : {};
          data[hotspotName] = {
            displayName: extra.displayName || deriveDisplayName(hotspotName),
            sides: sidesArrayToObject(sidesArr),
            // Ordered [{side, length, from, to}, ...] in true polygon
            // order, used by matchSidesToEdges() to line letters up with
            // krpano's traced edges. See buildCadRing() above.
            sidesRing: buildCadRing(sidesArr),
            // Manual per-side nudge/rotation from the Plot Dimension
            // Editor, keyed by letter — see drawSideLabels() below.
            sideOffsets: extra.sideOffsets || null,
            status: extra.status,
            area: extra.area,
            // FACING_FIELD/AREA_FIELD (see the Filtering section below)
            // read plot.facing / plot.areaSqft directly -- these were
            // declared as the expected filter fields but never actually
            // copied from the JSON here, so a facing or size filter could
            // never match anything even once the JSON had real values.
            facing: extra.facing,
            areaSqft: extra.areaSqft,
            category: extra.category,
            needsReview: !!extra.needsReview
          };
        });
        addPlaceholderPlots(data);
        PLOT_DATA = data;
        dataReady = true;
        applyBaseStyling();
        disableHotspotCapture();
        applyPlotNumberLabelScale();
        if (pendingClick) {
          var hs = pendingClick;
          pendingClick = null;
          showPlotDetails(hs);
        }
        var cbs = dataReadyCallbacks;
        dataReadyCallbacks = [];
        cbs.forEach(function (cb) {
          try { cb(PLOT_DATA); } catch (e) { console.error("plot-popup: onReady callback failed", e); }
        });
      })
      .catch(function (err) {
        console.error("plot-popup: failed to load plot data from", url, err);
      });
  }

  // ---- krpano helpers --------------------------------------------------
  function kget(path) {
    return window.krpano ? window.krpano.get(path) : null;
  }
  function kset(path, val) {
    if (window.krpano) window.krpano.set(path, val);
  }
  function kcall(action) {
    if (window.krpano) window.krpano.call(action);
  }

  // A krpano polygon hotspot with an onclick captures pointer events by
  // default -- meaning a drag/swipe that STARTS on top of a plot never
  // reaches the viewer's own pan-to-look control, on either touch or
  // mouse. The open road area has no hotspot at all, so a drag started
  // there was never captured and always worked. Turning capture off makes
  // every plot behave the same way the road does for dragging: krpano
  // still tells a tap from a drag apart on its own (by movement distance
  // between down/up), so a genuine tap still opens the popup via
  // showPlotDetails -- this only stops the plot from swallowing the pan
  // gesture. Applied to every hotspot in PLOT_DATA (including the
  // non-sellable/placeholder ones), since any of them sitting under a
  // swipe could block the same gesture.
  function disableHotspotCapture() {
    Object.keys(PLOT_DATA).forEach(function (hotspotName) {
      kset("hotspot[" + hotspotName + "].capture", "false");
    });
    // The road surface is its own hotspot too ("Roads"), not part of
    // PLOT_DATA -- same capture-blocks-drag issue, same fix.
    kset("hotspot[Roads].capture", "false");
  }

  // ---- Mobile-only plot-number label scaling ---------------------------
  // The "212" / "211" / "210" ... plot-number hotspots are named
  // "kml_label_N" (one per "kml_poly_N" in PLOT_DATA) and their font-size
  // is baked in by tour.xml's flatten_plot_labels() -- not this file --
  // so it can't be changed at the source here. Every krpano hotspot,
  // regardless of how its own text/font is built, still honors a "scale"
  // transform on top, so shrinking these on phones is done by applying a
  // scale factor to each kml_label_* hotspot, left at 1.0 (untouched) on
  // desktop/tablet-and-up widths.
  var MOBILE_LABEL_MAX_WIDTH_PX = 768;
  var MOBILE_LABEL_SCALE = 0.7; // tweak this until it looks right on your phone

  // Touch-based, same as plot-popup-mobile.css's own breakpoint -- a
  // width-only check (window.innerWidth <= MOBILE_LABEL_MAX_WIDTH_PX)
  // flips back to the desktop scale the moment a phone's landscape width
  // crosses 768px, and flickers between the two scales mid-rotation as
  // the browser fires resize several times with different intermediate
  // widths while its chrome/address bar settles. Checking the device's
  // input type instead keeps the same answer through a rotate, so those
  // extra resize firings just reapply the same scale (no visible jump).
  // The width check is kept as a fallback for browsers without
  // matchMedia and for narrow desktop/tablet windows.
  function isMobileLabelViewport() {
    if (window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches) {
      return true;
    }
    return window.innerWidth <= MOBILE_LABEL_MAX_WIDTH_PX;
  }

  function applyPlotNumberLabelScale() {
    if (!window.krpano || !PLOT_DATA) return;
    var scale = isMobileLabelViewport() ? MOBILE_LABEL_SCALE : 1.0;
    Object.keys(PLOT_DATA).forEach(function (hotspotName) {
      var labelName = hotspotName.replace("kml_poly_", "kml_label_");
      kset("hotspot[" + labelName + "].scale", scale);
    });
  }

  var labelScaleResizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(labelScaleResizeTimer);
    labelScaleResizeTimer = setTimeout(applyPlotNumberLabelScale, 150);
  });
  window.addEventListener("orientationchange", function () {
    clearTimeout(labelScaleResizeTimer);
    labelScaleResizeTimer = setTimeout(applyPlotNumberLabelScale, 150);
  });

  // Projects a spherical (ath, atv) point to actual on-screen pixels for the
  // CURRENT view. This is what makes rotation/sizing correct at any zoom
  // level or view angle — a straight ath/atv delta does NOT map linearly to
  // screen-space angle in a panorama, only in a flat coordinate system.
  function sphereToScreen(ath, atv) {
    kcall("spheretoscreen(" + ath + ", " + atv + ", tmp_s2s_x, tmp_s2s_y);");
    return {
      x: parseFloat(kget("tmp_s2s_x")),
      y: parseFloat(kget("tmp_s2s_y"))
    };
  }

  // Inverse of sphereToScreen: converts a screen pixel position back to
  // spherical (ath, atv) for the CURRENT view. Used so the label's inward
  // pull toward the centroid can be computed in screen space (where "toward
  // the centroid" visually means what it says) rather than by averaging
  // ath/atv values directly — which drifts badly for near-horizontal edges,
  // since equal steps in atv don't correspond to equal steps on screen in
  // this projection.
  function screenToSphere(x, y) {
    kcall("screentosphere(" + x + ", " + y + ", tmp_sc2s_ath, tmp_sc2s_atv);");
    return {
      ath: parseFloat(kget("tmp_sc2s_ath")),
      atv: parseFloat(kget("tmp_sc2s_atv"))
    };
  }

  // Current pixel size of the krpano viewer stage, i.e. what's actually
  // visible on screen. Falls back to the window size if krpano hasn't
  // reported stage dimensions yet (shouldn't normally happen once a plot
  // is clickable, but better than treating everything as in-bounds).
  function getStageSize() {
    var w = parseFloat(kget("stagewidth"));
    var h = parseFloat(kget("stageheight"));
    if (!isFinite(w) || w <= 0) w = window.innerWidth;
    if (!isFinite(h) || h <= 0) h = window.innerHeight;
    return { w: w, h: h };
  }

  function getPolygonPoints(hotspotName) {
    var count = parseInt(kget("hotspot[" + hotspotName + "].point.count"), 10);
    var pts = [];
    if (!count || isNaN(count)) return pts;
    for (var i = 0; i < count; i++) {
      var ath = parseFloat(kget("hotspot[" + hotspotName + "].point[" + i + "].ath"));
      var atv = parseFloat(kget("hotspot[" + hotspotName + "].point[" + i + "].atv"));
      pts.push({ ath: ath, atv: atv });
    }
    // krpano polygons repeat the first point at the end to close the shape;
    // drop that duplicate so edges = pts.length - 1 real sides.
    if (pts.length > 1) {
      var first = pts[0], last = pts[pts.length - 1];
      if (Math.abs(first.ath - last.ath) < 1e-6 && Math.abs(first.atv - last.atv) < 1e-6) {
        pts.pop();
      }
    }
    return pts;
  }

  // Font size is driven manually each frame (see placeSideLabel) from the
  // edge's actual on-screen pixel length, clamped between these bounds —
  // NOT krpano's built-in zoom="true" fov-based scaling, which felt uneven
  // since it isn't directly tied to how big the edge actually looks.
  // MIN and MAX both set to 11 to match the plot-number label size
  // (kml_label_*, sized in tour.xml's flatten_plot_labels()) — this pins
  // every dimension label to a constant 11px instead of scaling with the
  // edge's on-screen length.
  var LABEL_FONT_MIN_PX = 8;
  var LABEL_FONT_MAX_PX = 8;
  // How much of the edge's screen length the font size tracks. Tune this
  // if labels feel too big/small relative to the edges they sit on.
  // No-op now that MIN/MAX are pinned equal above (see comment there) —
  // left in place in case that's reverted later.
  var LABEL_FONT_EDGE_RATIO = 0.08;

  // ---- ground-lock (3D distorted) config -----------------------------
  // Flips the dimension labels from krpano's default flat billboard mode
  // (always faces the camera, "rotate" is a 2D screen-space spin) into
  // real 3D distorted mode, so the text lies flat on the ground surface
  // and reads correctly from any viewing angle instead of re-facing the
  // camera every frame. Matches the same rx/ry trick already used by
  // flatten_plot_labels() in tour.xml for the plot-number labels:
  //   rx = atv - 90, ry = -ath
  // which cancels out the current look-direction so the label plane ends
  // up parallel to the ground regardless of where on the pano it sits.
  // Flip this back to false to instantly revert to the old billboard
  // behavior (e.g. while tuning RZ below) without touching anything else.
  // DISABLED by default: rx = atv-90, ry = -ath only approximates a flat
  // ground rotation near the center of the view -- on a wide/zoomed-out
  // plot far from center this tips the label plane nearly edge-on to the
  // camera and it collapses to an illegible sliver (seen on the kml_label_*
  // plot numbers with the same formula). Dimension labels only ever show
  // for ONE plot at a time, usually fairly close to center of view when
  // clicked, so this is lower-risk here than it was for all 397 plot
  // numbers at once -- but it's still not verified safe, so leave this
  // false until it's been checked against a plot sitting near the edge of
  // the visible pano, not just a centered one.
  var GROUND_LOCK_LABELS = false;

  // The on-screen edge angle computed below (via atan2) is NOT guaranteed
  // to line up 1:1 with krpano's "rz" axis once distorted/rx/ry are in
  // play -- it can come out flipped or offset by a constant amount. Rather
  // than guess, tune these two against ONE label in the live tour, the
  // same way road_label_editor.js's Rotate +/- buttons are used to dial
  // in road labels, then bake the result in here so every label matches:
  //   1. Set GROUND_LOCK_RZ_SIGN to 1, reload, look at a label whose true
  //      edge direction you know. If it's mirrored (rotated the wrong
  //      way around), set this to -1 instead.
  //   2. With the sign correct, if every label is off by the same fixed
  //      amount, adjust GROUND_LOCK_RZ_OFFSET (degrees) until it lands.
  var GROUND_LOCK_RZ_SIGN = 1;
  var GROUND_LOCK_RZ_OFFSET = 0;

  // Ensure the dynamic label hotspots exist (create once, reuse after).
  // NOTE: we track creation with a plain JS flag rather than asking krpano
  // "does hotspot[sidelabel_N] exist?" — querying a non-existent hotspot
  // object (not one of its properties) doesn't reliably return null/undefined
  // across krpano builds, which was silently causing this function to think
  // the hotspots already existed and skip creating them — so every later
  // kset() call was writing to nothing, with no console error at all.
  var labelHotspotsCreated = false;

  function ensureLabelHotspots() {
    if (labelHotspotsCreated) return;
    if (!window.krpano) {
      console.warn("plot-popup: krpano not available yet, cannot create label hotspots");
      return;
    }
    for (var i = 0; i < MAX_SIDE_LABELS; i++) {
      var name = LABEL_PREFIX + i;
      kcall("addhotspot(" + name + ");");
      kset("hotspot[" + name + "].type", "text");
      kset("hotspot[" + name + "].html", "1");
      kset("hotspot[" + name + "].css",
        "font-family:Arial; font-size:" + LABEL_FONT_MIN_PX + "px; font-weight:bold; " +
        "color:#1d4ed8; text-align:center; white-space:nowrap; line-height:1; padding:0; margin:0;");
      kset("hotspot[" + name + "].bg", "false");  // plain text, no background chip
      // width/height intentionally left unset (not "0") — leaving them out
      // lets krpano auto-size to the text content, matching how a plain
      // manually-created text hotspot renders. Explicitly forcing 0 here
      // was producing a literal zero-size box that stayed invisible at
      // any scale.
      // "center" anchors the hotspot ON its ath/atv point in both axes —
      // without this it anchors top-left, which is what was making labels
      // sit offset from the true edge line instead of centered on it.
      kset("hotspot[" + name + "].align", "center");
      kset("hotspot[" + name + "].edge", "center");
      kset("hotspot[" + name + "].zorder", "9999");
      if (GROUND_LOCK_LABELS) {
        // krpano (1.21+) defaults text hotspots to renderer="auto", which
        // picks its CSS3D/DOM renderer -- that renderer does NOT support
        // distorted="true" and silently renders nothing instead of
        // erroring, so renderer must be forced to webgl whenever distorted
        // is on.
        kset("hotspot[" + name + "].renderer", "webgl");
        kset("hotspot[" + name + "].distorted", "true");
        // zoom="true" here is about the distorted plane scaling with
        // fov/perspective like a real ground object would -- unrelated to
        // the font-size scaling, which (as below) is still driven manually
        // every frame from the edge's on-screen length.
        kset("hotspot[" + name + "].zoom", "true");
      } else {
        kset("hotspot[" + name + "].renderer", "css3d");
        kset("hotspot[" + name + "].distorted", "false");
      }
      kset("hotspot[" + name + "].enabled", "false");
      kset("hotspot[" + name + "].visible", "false");
    }
    // Verify creation actually took — if this hotspot still doesn't report
    // back a type, addhotspot() itself failed (e.g. krpano not fully ready).
    var check = kget("hotspot[" + LABEL_PREFIX + "0].type");
    if (check !== "text") {
      console.error("plot-popup: label hotspot creation appears to have failed — " +
        "hotspot[" + LABEL_PREFIX + "0].type is '" + check + "', expected 'text'. " +
        "Labels will not display.");
      return; // leave labelHotspotsCreated false so we retry next click
    }
    labelHotspotsCreated = true;
  }

  function hideAllLabels() {
    for (var i = 0; i < MAX_SIDE_LABELS; i++) {
      kset("hotspot[" + LABEL_PREFIX + i + "].visible", "false");
    }
  }

  // How many screen PIXELS each label gets nudged from the edge midpoint
  // toward the polygon's centroid, purely so it doesn't sit flush on the
  // border line. Scaled off the plot's largest on-screen edge (the same
  // size metric used for font sizing) rather than a flat pixel amount —
  // a flat pull looked fine zoomed in but left a disproportionately large
  // gap on a small, zoomed-out plot, since the pull barely shrank with it.
  // Capped so it doesn't keep growing forever once you're zoomed in close.
  // The MIN floor here is a baseline only — placeSideLabel raises it
  // per-label to at least half that label's own font size, since a pull
  // smaller than the text's own rendered height leaves the label straddling
  // the boundary line instead of sitting inside it.
  var INWARD_PULL_MIN_PX = 6;
  var INWARD_PULL_MAX_PX = 26;
  var INWARD_PULL_RATIO = 0.06;

  // Manual sideOffsets (Plot Dimension Editor) gating -- see placeSideLabel().
  // MANUAL_OFFSET_REF_PX: the plot's on-screen size (its longest edge, in
  // px -- same value as plotScreenLen) below which manual offsets are
  // suppressed entirely; above it, they scale up with how far past this
  // you've zoomed in. If offsets still feel like they kick in too early/
  // late, raise/lower this.
  var MANUAL_OFFSET_REF_PX = 150;
  // Hard cap on how much a manual offset can grow at extreme zoom-in, so
  // a plot you zoom right into doesn't fling its label far past the nudge
  // it was tuned for.
  var MANUAL_OFFSET_MAX_SCALE = 3;
  // Never pull a label more than this fraction of the way to the centroid,
  // regardless of the size-based amount above. Keeps the pull from ever
  // overshooting on a narrow/tapered plot (a sliver or near-triangle
  // shape), which would otherwise push the label past the opposite edge
  // into a neighboring plot — 0.45 leaves each edge's label safely in its
  // own half of the plot, with margin, even when the opposite edge does
  // the same pull.
  var INWARD_PULL_FRACTION = 0.45;

  // Below this on-screen pixel length, an edge is treated as degenerate
  // (essentially a point, not worth placing a label on at all). This used
  // to be the main legibility gate, but that's now handled better by the
  // plot-level font sizing (every label on a plot shares one size, see
  // drawSideLabels) and the clearance search below — a short real-world
  // edge (e.g. a beveled corner) will always have a smaller on-screen
  // length than its plot's longer sides at any given zoom, and holding it
  // to the old, much higher threshold just meant it needed extra zoom to
  // appear at all, out of step with the rest of the plot's labels.
  var MIN_EDGE_SCREEN_PX = 12;

  // Below this on-screen pixel length for the plot's LONGEST edge, the
  // whole plot is too small on screen for four dimension labels to fit
  // without converging on each other and on the plot-number label in the
  // middle (what max zoom-out looked like). Below this, skip ALL side
  // labels for this plot — the popup card still lists every dimension.
  // Used only as a fallback (see MIN_PX_PER_FOOT below) when a plot has no
  // parsable real-world length to normalize against.
  var MIN_PLOT_SCREEN_PX = 90;

  // Same idea as MIN_PLOT_SCREEN_PX, but normalized to the plot's actual
  // real-world size instead of a flat pixel count — so a physically huge
  // plot (e.g. a park with a 363' edge) requires the same close-in zoom,
  // proportionally, as an ordinary ~80' residential plot before its labels
  // appear. Derived from MIN_PLOT_SCREEN_PX at a representative ~80'
  // longest edge (90 / 80 = 1.125): a plot's longest real edge, in feet,
  // times this value gives the on-screen pixel length that same edge needs
  // before labels show. Without this, a plot with a much longer real edge
  // reaches the old flat pixel threshold from much farther away, so its
  // labels popped in while the camera was nowhere near it yet.
  var MIN_PX_PER_FOOT = 1.125;

  // Rough average glyph width for bold Arial, as a fraction of font-size.
  // Used to estimate a label's rendered pixel width from its character
  // count so the clearance search (below) knows how much room a LONG
  // string like `45' 0"` actually needs — not just its single-line height.
  // Without this, a short bevel/corner edge could "pass" the clearance
  // check because its center point was far enough from the nearest edge,
  // while the rotated text itself still stuck out past that edge or off
  // the visible stage — which is exactly the clipped, half-cut-off digit
  // seen on tight corner edges.
  var AVG_CHAR_WIDTH_RATIO = 0.62;

  function estimateTextWidthPx(text, fontPx) {
    return (text ? String(text).length : 0) * fontPx * AVG_CHAR_WIDTH_RATIO;
  }

  function polygonCentroid(pts) {
    var sx = 0, sy = 0;
    for (var i = 0; i < pts.length; i++) { sx += pts[i].ath; sy += pts[i].atv; }
    return { ath: sx / pts.length, atv: sy / pts.length };
  }

  // Standard ray-casting point-in-polygon test, screen-space. Used as a hard
  // veto on label placement — a candidate point that fails this is rejected
  // outright, no matter what the perpendicular-pull math says, so a label
  // can never end up literally outside the plot it belongs to.
  function pointInPolygon(px, py, screenPts) {
    var inside = false;
    for (var i = 0, j = screenPts.length - 1; i < screenPts.length; j = i++) {
      var xi = screenPts[i].x, yi = screenPts[i].y;
      var xj = screenPts[j].x, yj = screenPts[j].y;
      var intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function distPointToSegment(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var lenSq = dx * dx + dy * dy;
    var t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  // Shortest distance from a point to any OTHER edge of the polygon (the
  // one at excludeIndex, the edge this label belongs to, is skipped). This
  // is what catches beveled-corner overflow: a label can be a safe
  // distance from its own edge and still be too close to a *different*,
  // nearby edge. The label's own edge is deliberately close (that's the
  // whole point of the inward pull) so it must never count against this
  // check — including it made the check impossible to pass wherever the
  // pull is intentionally small, hiding labels that had no real overlap
  // problem at all.
  function minDistanceToPolygonEdges(px, py, screenPts, excludeIndex) {
    var minD = Infinity;
    for (var i = 0; i < screenPts.length; i++) {
      if (i === excludeIndex) continue;
      var a = screenPts[i], b = screenPts[(i + 1) % screenPts.length];
      var d = distPointToSegment(px, py, a.x, a.y, b.x, b.y);
      if (d < minD) minD = d;
    }
    return minD;
  }

  // Shortest-path average of two ath values, correct even when the pair
  // straddles the ±180° wraparound (e.g. -170 and 170 should average to
  // 180, not 0). Without this, a plot with an edge crossing that boundary
  // gets its label placed on the wrong side of the map entirely.
  function wrappedAthMid(a1, a2) {
    var d = ((a2 - a1 + 180) % 360 + 360) % 360 - 180; // shortest delta a1->a2
    var mid = a1 + d / 2;
    return ((mid + 180) % 360 + 360) % 360 - 180; // normalize to [-180, 180)
  }

  // Places one label at the midpoint of edge (p1 -> p2), nudged toward
  // `centroid`, rotated to match the edge's actual ON-SCREEN angle. All of
  // the positioning math (midpoint, inward pull) happens in SCREEN PIXELS,
  // not spherical ath/atv — averaging ath/atv directly drifts badly for
  // near-horizontal edges in this projection (equal atv steps don't cover
  // equal screen distance), which was pushing labels off their true edge.
  // The final screen point is converted back to spherical just once via
  // screenToSphere() for the actual hotspot position.
  var loggedSphereToScreenWarning = false;

  function placeSideLabel(index, p1, p2, text, centroidScreen, screenPts, plotScreenLen, manualOffset) {
    if (index >= MAX_SIDE_LABELS) return; // safety, shouldn't happen
    var name = LABEL_PREFIX + index;

    var s1 = screenPts[index];
    var s2 = screenPts[(index + 1) % screenPts.length];
    var screenLen = Math.hypot(s2.x - s1.x, s2.y - s1.y);
    if (!isFinite(screenLen) || screenLen < MIN_EDGE_SCREEN_PX) {
      if (!isFinite(screenLen) && !loggedSphereToScreenWarning) {
        loggedSphereToScreenWarning = true;
        console.error("plot-popup: spheretoscreen() is not returning valid coordinates " +
          "(got x=" + s1.x + ", y=" + s1.y + "). Side labels cannot be positioned. " +
          "This usually means the krpano build in use doesn't support the " +
          "spheretoscreen action, or window.krpano was set before the viewer " +
          "fully finished initializing.");
      }
      kset("hotspot[" + name + "].visible", "false");
      return;
    }

    var angle = Math.atan2(s2.y - s1.y, s2.x - s1.x) * (180 / Math.PI);
    // Keep text upright: flip 180 deg if it would render upside-down.
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    // Manual per-side rotation override from the Plot Dimension Editor,
    // on top of the automatic edge-angle rotation above.
    if (manualOffset && manualOffset.rot) angle += manualOffset.rot;

    // Font size tracks the PLOT's longest edge (not this edge's own
    // length — see drawSideLabels), so every label on a plot renders at
    // the same size regardless of which side it's on. Computed BEFORE
    // positioning, because the safe-placement search below needs to know
    // the label's actual rendered thickness to keep it clear of nearby
    // edges.
    var fontPx = Math.round((plotScreenLen || screenLen) * LABEL_FONT_EDGE_RATIO);
    if (fontPx < LABEL_FONT_MIN_PX) fontPx = LABEL_FONT_MIN_PX;
    if (fontPx > LABEL_FONT_MAX_PX) fontPx = LABEL_FONT_MAX_PX;
    var textWidthPx = estimateTextWidthPx(text, fontPx);

    var midX = (s1.x + s2.x) / 2;
    var midY = (s1.y + s2.y) / 2;

    // Offset the label PERPENDICULAR to this specific edge, into the
    // polygon — not toward the centroid directly. For an irregular shape,
    // "toward centroid" can point mostly *along* an edge rather than away
    // from it, leaving the label still overlapping the boundary line even
    // after the pull. A perpendicular nudge always moves directly off the
    // line, regardless of the polygon's overall shape.
    var edx = s2.x - s1.x;
    var edy = s2.y - s1.y;
    var edgeLen = Math.hypot(edx, edy);

    if (edgeLen > 0 && centroidScreen) {
      var nx = -edy / edgeLen;
      var ny = edx / edgeLen;
      var sc = centroidScreen;
      if (isFinite(sc.x) && isFinite(sc.y)) {
        var towardCentroid = (sc.x - midX) * nx + (sc.y - midY) * ny;
        if (towardCentroid < 0) { nx = -nx; ny = -ny; }

        // How much clearance the label actually needs from a nearby edge.
        // A label extends much further along its own text direction than
        // its font height, so use half its estimated rendered width (with
        // the font-height case as a floor) — otherwise a long string like
        // `45' 0"` sitting on a short bevel/corner edge can pass a
        // height-only check while still overlapping the next edge or
        // running off the visible stage.
        var requiredMargin = Math.max(fontPx * 0.6, textWidthPx / 2 + 2);

        // Preferred pull: scales with how zoomed-in this plot currently is
        // (see INWARD_PULL_RATIO above), capped by the same
        // fraction-of-room-to-centroid as before — this is what typically
        // applies on ordinary, roughly-convex plots. The floor is raised
        // to at least half the label's own font height (+ a small buffer):
        // the text is centered ON the pulled point, so a pull smaller than
        // that leaves the top/bottom of the rendered text crossing back
        // over the boundary line instead of sitting inside it.
        var sizePull = (plotScreenLen || screenLen) * INWARD_PULL_RATIO;
        var pullFloor = Math.max(INWARD_PULL_MIN_PX, fontPx / 2 + 4);
        if (sizePull < pullFloor) sizePull = pullFloor;
        if (sizePull > INWARD_PULL_MAX_PX) sizePull = INWARD_PULL_MAX_PX;
        var room = Math.abs(towardCentroid);
        var preferredPull = Math.min(sizePull, room * INWARD_PULL_FRACTION);

        // FIX: near a beveled/irregular corner, a point that's a safe
        // distance from THIS edge's centroid direction can still be too
        // close to a DIFFERENT edge (e.g. a short diagonal corner cut),
        // which is what let labels overflow past the plot boundary. Search
        // downward from the preferred pull for the largest amount that
        // keeps the point (a) genuinely inside the polygon and (b) at
        // least `requiredMargin` away from every edge of the plot, not
        // just its own. Falls back to whichever tried point has the best
        // clearance if nothing fully qualifies (e.g. an extremely thin
        // sliver plot) — always inside, never outside, worst case just
        // snug against the nearest line rather than crossing it.
        var STEPS = 8;
        var bestX = midX, bestY = midY, bestMargin = -Infinity, found = false;
        for (var s = STEPS; s >= 0 && !found; s--) {
          var pull = preferredPull * (s / STEPS);
          var cx = midX + nx * pull;
          var cy = midY + ny * pull;
          if (!pointInPolygon(cx, cy, screenPts)) continue;
          var m = minDistanceToPolygonEdges(cx, cy, screenPts, index);
          if (m > bestMargin) { bestMargin = m; bestX = cx; bestY = cy; }
          if (m >= requiredMargin) {
            bestX = cx; bestY = cy; found = true;
          }
        }
        // Only give up on a label when the best point we found has
        // essentially no clearance at all (sitting right on top of
        // another edge) — not merely "less than the ideal text-width
        // margin". A tight corner where several short edges converge
        // (a pentagon's beveled corner, zoomed out) will rarely clear the
        // full ideal margin, but a slightly snug label there still reads
        // fine and matches what the popup already lists — silently
        // dropping most of a plot's dimensions was worse than that.
        var MIN_ACCEPTABLE_MARGIN_PX = 3;
        if (bestMargin < MIN_ACCEPTABLE_MARGIN_PX) {
          kset("hotspot[" + name + "].visible", "false");
          return;
        }

        midX = bestX;
        midY = bestY;
      }
    }

    // Keep the label's rotated bounding box from poking past the visible
    // edge of the viewer stage — a label can have plenty of clearance from
    // the polygon's own edges yet still sit right at the photo/viewport
    // boundary. Rather than hiding the label outright (which was making
    // whole sides disappear whenever the polygon's own edge happened to
    // run along the stage's crop line — a missing dimension is worse than
    // a slightly tight one), clamp it back on-stage, and only fall back to
    // the pre-clamp point if clamping would push it outside the polygon.
    var stage = getStageSize();
    var halfDiag = Math.hypot(textWidthPx, fontPx) / 2;
    var clampedX = Math.min(Math.max(midX, halfDiag), Math.max(halfDiag, stage.w - halfDiag));
    var clampedY = Math.min(Math.max(midY, halfDiag), Math.max(halfDiag, stage.h - halfDiag));
    if ((clampedX !== midX || clampedY !== midY) && pointInPolygon(clampedX, clampedY, screenPts)) {
      midX = clampedX;
      midY = clampedY;
    }

    // Manual per-side screen-pixel nudge from the Plot Dimension Editor,
    // applied last — after the automatic clearance search and stage
    // clamp — so it's an explicit fine-tune on top of the safe position
    // found above, not fed back into that search. Rotated by this edge's
    // current on-screen angle so the nudge stays fixed RELATIVE TO THE
    // EDGE (dx = along the edge's own right, dy = along its own down)
    // instead of in absolute screen X/Y — otherwise, since this offset was
    // tuned by eye at one particular camera angle, panning/rotating the
    // view afterward made the fixed screen-space push no longer line up
    // with the edge's new orientation, and the label visibly drifted away
    // from its edge as the angle changed.
    //
    // The nudge itself is still a fixed pixel amount, which doesn't scale
    // with zoom on its own -- that's fine for a plot zoomed in close (the
    // small size relative to the plot is what it was tuned for), but the
    // exact same pixels become a much bigger, more visible push once the
    // plot shrinks on screen when zoomed OUT. Gate it on zoom instead of
    // trying to make it zoom-invariant: below MANUAL_OFFSET_REF_PX (the
    // on-screen plot size these nudges were tuned at) the manual offset is
    // suppressed entirely, i.e. automatic placement only; the further you
    // zoom in PAST that reference size, the more the nudge is scaled up
    // (capped at MANUAL_OFFSET_MAX_SCALE so it can't run away at extreme
    // zoom). Tune MANUAL_OFFSET_REF_PX against a plot you know is tuned
    // well (e.g. one with small offsets) if this doesn't feel right.
    if (manualOffset) {
      var curScreenLen = plotScreenLen || screenLen;
      var zoomScale = curScreenLen / MANUAL_OFFSET_REF_PX;
      if (zoomScale > 1) {
        if (zoomScale > MANUAL_OFFSET_MAX_SCALE) zoomScale = MANUAL_OFFSET_MAX_SCALE;
        var offRad = angle * Math.PI / 180;
        var odx = (manualOffset.dx || 0) * zoomScale;
        var ody = (manualOffset.dy || 0) * zoomScale;
        midX += odx * Math.cos(offRad) - ody * Math.sin(offRad);
        midY += odx * Math.sin(offRad) + ody * Math.cos(offRad);
      }
      // zoomScale <= 1 (zoomed out to/past the reference size): manual
      // offset stays at 0, i.e. not applied at all -- midX/midY are left
      // exactly where the automatic clearance search put them.
    }

    var midSphere = screenToSphere(midX, midY);
    if (!isFinite(midSphere.ath) || !isFinite(midSphere.atv)) {
      // Fallback: if the inverse conversion fails for some reason, still
      // show the label using the edge's raw endpoint average rather than
      // hiding it entirely.
      midSphere.ath = (p1.ath + p2.ath) / 2;
      midSphere.atv = (p1.atv + p2.atv) / 2;
    }

    kset("hotspot[" + name + "].ath", midSphere.ath);
    kset("hotspot[" + name + "].atv", midSphere.atv);

    if (GROUND_LOCK_LABELS) {
      // Same rx/ry cancellation as flatten_plot_labels() in tour.xml,
      // computed fresh each placement from THIS label's own ath/atv (it
      // moves every frame, so this can't be baked in once like the static
      // kml_label_* plot numbers are). rz carries the edge heading that
      // "rotate" used to carry in billboard mode -- see the tuning notes
      // on GROUND_LOCK_RZ_SIGN/OFFSET above if it renders mirrored or
      // constantly off by a fixed amount.
      kset("hotspot[" + name + "].rx", (midSphere.atv - 90).toFixed(2));
      kset("hotspot[" + name + "].ry", (0 - midSphere.ath).toFixed(2));
      kset("hotspot[" + name + "].rz",
        (angle * GROUND_LOCK_RZ_SIGN + GROUND_LOCK_RZ_OFFSET).toFixed(2));
    } else {
      kset("hotspot[" + name + "].rotate", angle.toFixed(2));
    }

    kset("hotspot[" + name + "].css",
      "font-family:Arial; font-size:" + fontPx + "px; font-weight:bold; " +
      "color:#1d4ed8; text-align:center; white-space:nowrap; line-height:1; padding:0; margin:0;");
    kset("hotspot[" + name + "].html", text);

    kset("hotspot[" + name + "].visible", "true");
  }

  // Sets each hotspot's fill/border to match its status + category, exactly
  // as the reference flat-map's CSS does (available/sold fill, colored
  // border for EB/LB/PARK/CORNER). Runs once when plot data finishes loading,
  // and again (per-plot) whenever a plot is deselected.
  function styleForPlot(hotspotName, plot) {
    var isSold = (plot.status || "").toUpperCase() === "SOLD";
    var category = plot.category ? plot.category.toString().toUpperCase() : null; // "EB" | "LB" | "PARK" | "CORNER" | null

    var fill = isSold
      ? COLOR.soldFill
      : (category && COLOR.categoryFillAvailable[category])
        ? COLOR.categoryFillAvailable[category]
        : COLOR.availableFill;

    var border = (category && COLOR.categoryBorder[category])
      ? COLOR.categoryBorder[category]
      : COLOR.defaultBorder;
    // Same condition as `border` above -- a truthy-but-unrecognized
    // category (e.g. the "TBD" placeholder default) must NOT get the
    // thick category border width; only a real EB/LB/PARK/CORNER match
    // should.
    var borderwidth = (category && COLOR.categoryBorder[category])
      ? CATEGORY_BORDERWIDTH
      : DEFAULT_BORDERWIDTH;

    kset("hotspot[" + hotspotName + "].fillcolor", fill);
    kset("hotspot[" + hotspotName + "].fillalpha", "1.0");
    kset("hotspot[" + hotspotName + "].bordercolor", border);
    kset("hotspot[" + hotspotName + "].borderwidth", borderwidth);
  }

  function applyBaseStyling() {
    if (activeFilter) {
      applyFilterStyling();
      return;
    }
    Object.keys(PLOT_DATA).forEach(function (hotspotName) {
      styleForPlot(hotspotName, PLOT_DATA[hotspotName]);
    });
  }

  function clearHighlight() {
    if (currentSelected) {
      var plot = PLOT_DATA[currentSelected];
      if (plot) styleForPlot(currentSelected, plot); // restore its normal look
      currentSelected = null;
    }
  }

  function highlight(hotspotName) {
    clearHighlight();
    kset("hotspot[" + hotspotName + "].fillcolor", COLOR.activeFill);
    kset("hotspot[" + hotspotName + "].fillalpha", "1.0");
    kset("hotspot[" + hotspotName + "].borderwidth", ACTIVE_BORDERWIDTH);
    currentSelected = hotspotName;
  }

  // ---- Popup rendering -----------------------------------------------------
  var SIDE_LETTERS = "ABCDEFGH".split("");

  // Parses a dimension string like `35' 0"` or `7' 1"` into decimal feet.
  // Returns null if it doesn't look like a feet/inches value.
  function parseFeetInches(str) {
    if (typeof str !== "string") return null;
    var m = str.match(/(-?\d+(?:\.\d+)?)\s*'\s*(-?\d+(?:\.\d+)?)?\s*"?/);
    if (!m) return null;
    var feet = parseFloat(m[1]);
    if (isNaN(feet)) return null;
    var inches = m[2] !== undefined ? parseFloat(m[2]) : 0;
    if (isNaN(inches)) inches = 0;
    return feet + inches / 12;
  }

  // Approximate geometric length of an edge, purely from its ath/atv
  // endpoints (NOT screen pixels, so it stays stable regardless of current
  // zoom/pan — needed since this runs once per click, and the polygon's
  // own coordinates don't change with the view). cos(atv) roughly corrects
  // for ath compressing at higher/lower look angles, same idea as a
  // latitude correction on a sphere.
  function approxEdgeLength(p1, p2) {
    var avgAtvRad = ((p1.atv + p2.atv) / 2) * Math.PI / 180;
    var dAth = ((p2.ath - p1.ath + 180) % 360 + 360) % 360 - 180; // shortest delta
    var dAthCorrected = dAth * Math.cos(avgAtvRad);
    var dAtv = p2.atv - p1.atv;
    return Math.hypot(dAthCorrected, dAtv);
  }

  // Normalizes a list of edge lengths so only their relative proportions
  // matter (each divided by the total) -- needed because the JSON's from/to
  // CAD coordinates and krpano's ath/atv coordinates are different spaces
  // with different, non-constant scale factors between them (checked: the
  // ratio between a side's real-world "length" and its raw CAD from/to
  // distance varies noticeably even within one plot), so only the SHAPE
  // (the sequence of proportions around the ring) can be compared, not
  // absolute magnitudes.
  function normalizeLens(lens) {
    var sum = 0;
    for (var i = 0; i < lens.length; i++) sum += lens[i];
    if (!(sum > 0)) sum = 1;
    return lens.map(function (l) { return l / sum; });
  }

  // Finds the rotation offset and direction (forward/reversed) that best
  // lines up `targetLens` (krpano's traced edges, in their original pts[]
  // order) against `refLens` (the JSON ring's A -> B -> C -> ... order),
  // by minimizing the sum of squared differences between their normalized
  // length sequences. Both arrays must be the same length. This is a full
  // O(n^2) search, which is fine since a plot has at most a handful of
  // sides.
  function bestCyclicAlignment(refLens, targetLens) {
    var n = refLens.length;
    if (!n || targetLens.length !== n) return null;
    var ref = normalizeLens(refLens);
    var tgt = normalizeLens(targetLens);
    var best = null;
    for (var start = 0; start < n; start++) {
      var scoreFwd = 0, scoreRev = 0;
      for (var i = 0; i < n; i++) {
        var dFwd = ref[i] - tgt[(start + i) % n];
        scoreFwd += dFwd * dFwd;
        var dRev = ref[i] - tgt[((start - i) % n + n) % n];
        scoreRev += dRev * dRev;
      }
      if (!best || scoreFwd < best.score) best = { start: start, reversed: false, score: scoreFwd };
      if (scoreRev < best.score) best = { start: start, reversed: true, score: scoreRev };
    }
    return best;
  }

  // A side's real-world length in feet, parsed from its "length" string --
  // the authoritative dimension for matching, since (per the note above)
  // the raw CAD from/to distance isn't reliably to scale. Falls back to the
  // CAD distance only if the string is missing/unparseable.
  function sideRefLength(sideEntry) {
    var feet = parseFeetInches(sideEntry.length);
    if (feet != null && feet > 0) return feet;
    return cadPointDist(sideEntry.from, sideEntry.to) || 0.001;
  }

  // Approximate plot area (sq ft) -- used only as a fallback in
  // getAreaSqft() below, when the JSON entry doesn't already provide an
  // explicit areaSqft/area value.
  //
  // Reconstructs the polygon at TRUE scale: each edge's DIRECTION comes
  // from the CAD from/to points (angles in the export are reliable), but
  // its MAGNITUDE comes from the side's real "length" text (e.g. 35' 0"),
  // parsed to decimal feet via parseFeetInches -- the same value already
  // shown in each "Side X" box. This is what makes the area line up with
  // the side dimensions the user can see on the card.
  //
  // Previously this ran the shoelace formula directly on the raw CAD
  // from/to points, which produced nonsense areas (e.g. "6 sq ft" for a
  // plot with 35'-51' sides): per the scale caveat in the normalizeLens()
  // comment above, a side's real-world length and its raw CAD from/to
  // distance are NOT reliably proportional (the ratio varies even within
  // one plot), so raw CAD coordinates alone can't be trusted for magnitude.
  //
  // Still an estimate (direction-from-CAD is an assumption, and errors in
  // any one side compound around the ring) -- add a real areaSqft (or
  // area) value to that plot's entry in all_plots_matched.json once it's
  // known, and getAreaSqft() will always prefer that explicit value over
  // this computed one.
  function computeAreaSqftFromRing(sidesRing) {
    var ring = (Array.isArray(sidesRing) ? sidesRing : []).filter(function (s) {
      return s && Array.isArray(s.from) && s.from.length === 2 &&
        Array.isArray(s.to) && s.to.length === 2;
    });
    if (ring.length < 3) return null;

    var vertices = [{ x: 0, y: 0 }];
    for (var i = 0; i < ring.length; i++) {
      var side = ring[i];
      var feet = parseFeetInches(side.length);
      if (feet == null || feet <= 0) feet = cadPointDist(side.from, side.to) || 0;
      var dx = side.to[0] - side.from[0];
      var dy = side.to[1] - side.from[1];
      var mag = Math.hypot(dx, dy) || 1;
      var ux = dx / mag, uy = dy / mag;
      var prev = vertices[vertices.length - 1];
      vertices.push({ x: prev.x + ux * feet, y: prev.y + uy * feet });
    }
    vertices.pop(); // drop the closing vertex (~coincides with vertices[0])
    if (vertices.length < 3) return null;

    var twiceArea = 0;
    for (var j = 0; j < vertices.length; j++) {
      var p1 = vertices[j], p2 = vertices[(j + 1) % vertices.length];
      twiceArea += (p1.x * p2.y - p2.x * p1.y);
    }
    var area = Math.abs(twiceArea) / 2;
    return area > 0 ? area : null;
  }

  // "3204" -> "3,204". Used when displaying a computed/explicit sqft value.
  function formatSqft(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // Maps side letters (A, B, C, D...) to krpano polygon edges by matching
  // the JSON's own edge-length sequence (via plot.sidesRing, built from the
  // from/to points in buildCadRing) against krpano's traced edges -- i.e.
  // this now uses the actual edges and points recorded in
  // all_plots_matched.json to find the correct correspondence, rather than
  // a fixed geometric guess like "leftmost vertex is always side A".
  //
  // Separately, ~33 corner-cut plots have one more traced krpano edge than
  // named sides (a beveled/cut corner traced as its own vertex but never
  // given its own letter -- e.g. kml_poly_49/52/53). When edgeCount is
  // greater than the number of named sides, exclude the (edgeCount -
  // sideCount) SHORTEST krpano edges by approximate on-screen-independent
  // length -- a bevel cut is reliably much shorter than an actual
  // dimensioned side -- then run the length-sequence match against what's
  // left.
  function matchSidesToEdges(pts, plot) {
    var edgeCount = pts.length;
    var result = new Array(edgeCount);
    // ringIndex is this edge's position within plot.sidesRing (the true
    // A->B->C->... order from buildCadRing()) -- exposed so a consumer like
    // the Plot Dimension Editor can look up "whichever side entry this is",
    // not just its current letter, and stay correct even if the user has
    // swapped letters around in an unsaved edit.
    for (var i = 0; i < edgeCount; i++) result[i] = { text: "", letter: null, ringIndex: null };

    var ring = plot && plot.sidesRing;
    if (!ring || !ring.length) return result;

    var sideCount = ring.length;
    var refLens = ring.map(sideRefLength);
    var refLetters = ring.map(function (s) { return s.side; });
    var refTexts = ring.map(function (s) { return s.length; });

    if (edgeCount < sideCount) {
      // Genuine data problem (fewer traced krpano edges than named sides)
      // -- fill what we can and let it be visibly incomplete rather than
      // silently wrong.
      for (var i = 0; i < edgeCount; i++) {
        result[i] = { text: refTexts[i], letter: refLetters[i], ringIndex: i };
      }
      return result;
    }

    var candidateIdx = [];
    for (var i = 0; i < edgeCount; i++) candidateIdx.push(i);
    if (edgeCount > sideCount) {
      var lens = candidateIdx.map(function (i) {
        return approxEdgeLength(pts[i], pts[(i + 1) % edgeCount]);
      });
      var byLen = candidateIdx.slice().sort(function (a, b) { return lens[a] - lens[b]; });
      var exclude = {};
      for (var i = 0; i < edgeCount - sideCount; i++) exclude[byLen[i]] = true;
      candidateIdx = candidateIdx.filter(function (i) { return !exclude[i]; });
    }

    // candidateIdx now holds exactly `sideCount` krpano edge indices, still
    // in their original cyclic (pts) order.
    var targetLens = candidateIdx.map(function (i) {
      return approxEdgeLength(pts[i], pts[(i + 1) % edgeCount]);
    });

    var alignment = bestCyclicAlignment(refLens, targetLens);
    if (!alignment) return result;

    for (var i = 0; i < sideCount; i++) {
      var targetPos = alignment.reversed
        ? ((alignment.start - i) % sideCount + sideCount) % sideCount
        : (alignment.start + i) % sideCount;
      var edgeIdx = candidateIdx[targetPos];
      result[edgeIdx] = { text: refTexts[i], letter: refLetters[i], ringIndex: i };
    }

    return result;
  }

  function statusClass(status) {
    switch ((status || "").toUpperCase()) {
      case "SOLD": return "plot-popup-badge--sold";
      case "HOLD":
      case "ON HOLD": return "plot-popup-badge--hold";
      case "AVAILABLE":
      default: return "plot-popup-badge--available";
    }
  }

  function renderPopup(plot) {
    var root = document.getElementById("plotPopupRoot");
    if (!root) {
      console.error("plot-popup: #plotPopupRoot container not found in DOM");
      return;
    }

    var hasSides = plot.sides && Object.keys(plot.sides).length > 0;
    var sideBoxes = "";
    if (hasSides) {
      Object.keys(plot.sides).forEach(function (letter) {
        var val = plot.sides[letter];
        sideBoxes +=
          '<div class="plot-popup-side-box">' +
          '<div class="plot-popup-side-label">Side ' + letter + '</div>' +
          '<div class="plot-popup-side-value">' + (val != null ? val : "—") + '</div>' +
          '</div>';
      });
    }

    // Area: an explicit plot.area string always wins (lets a manually
    // entered value like "2,400 sq ft" or "0.55 acres" through verbatim).
    // Failing that, use a numeric areaSqft/area if present, and only fall
    // back to the CAD-outline estimate (see computeAreaSqftFromRing above)
    // when the JSON has no real figure at all -- getAreaSqft() already
    // implements exactly that priority order for the facing/size filter,
    // so reuse it here instead of duplicating the fallback chain.
    var sqft = getAreaSqft(plot);
    var areaIsEstimated = plot.area == null &&
      !(typeof plot[AREA_FIELD] === "number" && isFinite(plot[AREA_FIELD]));
    var areaText = plot.area != null
      ? plot.area
      : (sqft != null ? (formatSqft(sqft) + " sq ft") : "—");

    // Title-case for display, e.g. JSON's "north east" -> "North East",
    // so it always reads the same clean way regardless of the case it was
    // typed in — matches the wording used in the filter panel's Facing
    // dropdown (see FACING_OPTIONS in filter-panel.js). facingToLabel
    // (above, near normalizeFacing) also converts a numeric bearing like
    // 45 into "North East" first, so this never just prints a bare number.
    function toTitleCase(s) {
      return s.replace(/\w\S*/g, function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      });
    }
    var facingLabel = facingToLabel(plot.facing);
    var facingText = facingLabel ? toTitleCase(facingLabel) : "—";

    // Accept a dedicated isCorner/corner flag if the JSON provides one, in
    // addition to (case-insensitively) category === "CORNER" -- some plots
    // may be flagged as corner plots without being put in the CORNER
    // category bucket (which also drives the pink map border/fill).
    var isCorner = plot.isCorner === true || plot.corner === true ||
      (typeof plot.category === "string" && plot.category.toUpperCase() === "CORNER");
    var cornerText = isCorner ? "Yes" : "No";

    root.innerHTML =
      '<div class="plot-popup-card">' +
      '<div class="plot-popup-header">' +
      '<h2 class="plot-popup-title">' + plot.displayName + '</h2>' +
      '<button class="plot-popup-close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<span class="plot-popup-badge ' + statusClass(plot.status) + '">' +
      (plot.status ? plot.status.toUpperCase() : "AVAILABLE") +
      '</span>' +
      '<div class="plot-popup-row plot-popup-row--area">' +
      '<span>Area' + (sqft != null && areaIsEstimated ? ' (est.)' : '') + '</span>' +
      '<span class="plot-popup-area-value">' + areaText + '</span>' +
      '</div>' +
      '<div class="plot-popup-facing-box" style="' +
      'border:3px solid #FF5C1A;border-radius:6px;padding:12px 14px;' +
      'margin:14px 0;background:#FFF7F2;display:flex;' +
      'align-items:center;justify-content:space-between;">' +
      '<span style="color:#FF5C1A;font-weight:bold;font-size:14px;letter-spacing:0.3px;">Facing</span>' +
      '<span class="plot-popup-facing-value" style="' +
      'color:#FF5C1A;font-weight:bold;font-size:17px;">' +
      facingText + '</span>' +
      '</div>' +
      '<div class="plot-popup-row plot-popup-row--corner">' +
      '<span>Corner Plot</span>' +
      '<span class="plot-popup-corner-value' + (isCorner ? ' plot-popup-corner-value--yes' : '') + '">' +
      cornerText + '</span>' +
      '</div>' +
      (hasSides ?
        '<div class="plot-popup-divider"></div>' +
        '<div class="plot-popup-section-label">Side Dimensions:</div>' +
        '<div class="plot-popup-side-grid">' + sideBoxes + '</div>'
        : '') +
      '</div>';

    root.style.display = "block";
    root.querySelector(".plot-popup-close").addEventListener("click", closePlotPopup);
  }

  // Computes fresh screen positions for every side label of the given plot
  // and draws them. Safe to call repeatedly (e.g. on a timer) — each call
  // fully recomputes from the hotspot's current on-screen polygon, so
  // labels stay correct as the user pans/zooms, and edges that cross the
  // MIN_EDGE_SCREEN_PX threshold appear/disappear automatically.
  function drawSideLabels(hotspotName, plot) {
    // pts/edgeInfo/centroid are cached per-plot (see getCachedPolygonData
    // above) -- they only depend on the hotspot's own geometry and the
    // plot's side data, never on the current view, so there's no need to
    // recompute them on every call just because this runs once per frame
    // while a plot is selected.
    var cached = getCachedPolygonData(hotspotName, plot);
    var pts = cached.pts;
    if (!pts.length) {
      hideAllLabels();
      return;
    }
    var centroid = cached.centroid;
    var edgeInfo = cached.edgeInfo;
    // The centroid's screen position is the same for every edge on this
    // plot in a given frame, so compute it once here rather than letting
    // placeSideLabel() (called once per edge below) each re-derive it via
    // its own sphereToScreen() call -- that was up to MAX_SIDE_LABELS
    // redundant krpano round-trips for the identical point, every frame.
    var centroidScreen = centroid ? sphereToScreen(centroid.ath, centroid.atv) : null;
    var screenPts = pts.map(function (p) { return sphereToScreen(p.ath, p.atv); });
    hideAllLabels();

    // Size every label on this plot off the plot's LONGEST edge, not each
    // edge's own length. Tying font size to each edge individually made a
    // genuinely short side (e.g. a beveled corner) render tiny and
    // squashed no matter how far zoomed in, since it never gets as many
    // screen pixels as the plot's long sides do at the same zoom. Using
    // one shared size keeps all of a plot's labels visually consistent,
    // the way dimension labels on a real site plan would be.
    var maxEdgeScreenLen = 0;
    for (var e = 0; e < pts.length; e++) {
      var ea = screenPts[e], eb = screenPts[(e + 1) % screenPts.length];
      var elen = Math.hypot(eb.x - ea.x, eb.y - ea.y);
      if (isFinite(elen) && elen > maxEdgeScreenLen) maxEdgeScreenLen = elen;
    }
    // Whole plot too small on screen (max zoom-out): showing any side
    // labels here just clutters the plot-number label, so show none.
    // Threshold scales with the plot's actual real-world size (see
    // MIN_PX_PER_FOOT) rather than a flat pixel count, so a physically
    // huge plot needs the same close-in zoom as an ordinary one — falls
    // back to the flat MIN_PLOT_SCREEN_PX only when no side here has a
    // parsable real length to normalize against.
    var realMaxFeet = 0;
    for (var ei = 0; ei < edgeInfo.length; ei++) {
      var feet = parseFeetInches(edgeInfo[ei] && edgeInfo[ei].text);
      if (feet != null && feet > realMaxFeet) realMaxFeet = feet;
    }
    var visibilityThresholdPx = realMaxFeet > 0
      ? MIN_PX_PER_FOOT * realMaxFeet
      : MIN_PLOT_SCREEN_PX;
    if (maxEdgeScreenLen < visibilityThresholdPx) return;

    for (var i = 0; i < pts.length; i++) {
      var p1 = pts[i];
      var p2 = pts[(i + 1) % pts.length];
      var info = edgeInfo[i];
      if (info && info.text) {
        // Manual per-side nudge/rotation set in the Plot Dimension Editor
        // (road_label_editor.js), keyed by letter so it stays attached to
        // the right side even if letters get swapped later.
        var manualOffset = (plot.sideOffsets && info.letter && plot.sideOffsets[info.letter]) || null;
        // Letter is kept out of the on-map text on purpose -- it's only
        // shown in the popup's "Side Dimensions" panel (built elsewhere,
        // from plot.sides, as "Side A" / "Side B" headers). This used to
        // also prefix the map label itself ("A: 35' 0\"") so the
        // letter<->edge pairing was visible at a glance while setting up
        // dimensions -- now that setup's done, the Road Label Editor's own
        // live preview (see pauseSideLabels/resumeSideLabels below) is
        // still where that pairing shows up mid-edit.
        var labelText = info.text;
        placeSideLabel(i, p1, p2, labelText, centroidScreen, screenPts, maxEdgeScreenLen, manualOffset);
      }
    }
  }

  function stopLabelRefresh() {
    if (labelRefreshRAF) {
      cancelAnimationFrame(labelRefreshRAF);
      labelRefreshRAF = null;
    }
    // Invalidate the cached polygon/edge-match data whenever the refresh
    // loop stops -- covers closing the popup, and the Plot Dimension
    // Editor's pauseSideLabels() handoff, so if that editor changed the
    // plot's sidesRing/sideOffsets while paused, resumeSideLabels() (which
    // calls drawSideLabels again) recomputes fresh instead of reusing a
    // now-stale match. The cache still lives on, uninvalidated, across
    // every RAF tick *within* one open popup, which is the case that
    // actually matters for zoom smoothness.
    labelCache = null;
  }

  function startLabelRefresh(hotspotName, plot) {
    stopLabelRefresh();
    function tick() {
      drawSideLabels(hotspotName, plot);
      labelRefreshRAF = requestAnimationFrame(tick);
    }
    labelRefreshRAF = requestAnimationFrame(tick);
  }

  // ---- Filtering (facing / property size) -------------------------------
  // Drives the top filter panel (filter-panel.js): dims plots that don't
  // match the current criteria and leaves matching plots at their normal
  // status/category styling, so the color legend still reads correctly on
  // the "kept" plots. Reads plot.facing / plot.areaSqft, which loadPlotData()
  // copies from each entry's JSON (facing/areaSqft above status/area/category
  // there) -- plots without a real value yet (still "TBD" or missing) simply
  // won't satisfy an active facing/size filter, the same as any other
  // legitimately-non-matching plot.
  var FACING_FIELD = "facing";     // expected plot.facing, e.g. "South West"
  var AREA_FIELD = "areaSqft";     // expected plot.areaSqft (number); falls
  // back to parsing plot.area (e.g. "2400 sqft", "2,400") if areaSqft is absent.
  var FILTER_DIM_FILLALPHA = "0.12";

  var activeFilter = null; // { facing: string|null, minSqft: number|null, maxSqft: number|null }

  function getAreaSqft(plot) {
    if (typeof plot[AREA_FIELD] === "number" && isFinite(plot[AREA_FIELD])) {
      return plot[AREA_FIELD];
    }
    if (typeof plot.area === "number" && isFinite(plot.area)) return plot.area;
    if (typeof plot.area === "string") {
      var m = plot.area.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
      if (m) return parseFloat(m[1]);
    }
    // Neither an explicit areaSqft nor a parseable area string -- fall back
    // to an approximate figure computed from the plot's own traced CAD
    // outline. See computeAreaSqftFromRing()'s comment (near
    // parseFeetInches, above) for the accuracy caveat; this only kicks in
    // until a real areaSqft/area value is added to the plot's JSON entry.
    return computeAreaSqftFromRing(plot.sidesRing);
  }

  // The 8 direction names used throughout (same wording as FACING_OPTIONS
  // in filter-panel.js and the popup's Facing box), in compass order
  // starting from North.
  var COMPASS_DIRS = ["North", "North East", "East", "South East",
    "South", "South West", "West", "North West"];

  // Converts a compass bearing in degrees (0=North, 90=East, 180=South,
  // 270=West, ...) to one of the 8 direction names above, each covering a
  // 45°-wide sector centered on it.
  function degToCompassLabel(deg) {
    var d = ((deg % 360) + 360) % 360;
    var idx = Math.round(d / 45) % COMPASS_DIRS.length;
    return COMPASS_DIRS[idx];
  }

  // True if a plot.facing value looks like a bare number -- either an
  // actual JS number, or a numeric-looking string like "45" straight out
  // of JSON -- meaning it's a compass DEGREE rather than a direction name.
  function isNumericFacing(f) {
    if (typeof f === "number") return isFinite(f);
    if (typeof f === "string") return /^-?\d+(\.\d+)?$/.test(f.trim());
    return false;
  }

  // Normalizes a plot's raw facing value -- which some entries store as a
  // direction string ("north east") and others as a numeric compass
  // bearing (45) -- into a single direction-name form for display/
  // matching. Without this, a numeric facing rendered as-is in the popup
  // (just the bare digits, e.g. "45") instead of a readable direction.
  function facingToLabel(f) {
    if (f == null || f === "") return null;
    if (isNumericFacing(f)) return degToCompassLabel(parseFloat(f));
    return f.toString();
  }

  // Loose match so "South West", "South-West", "SOUTH_WEST", "sw" style
  // variations between the dropdown's option values and a plot's stored
  // facing string don't silently fail to match -- and so a numeric
  // bearing (via facingToLabel above) matches the dropdown's direction
  // names too.
  function normalizeFacing(f) {
    var label = facingToLabel(f);
    return (label || "").toString().trim().toLowerCase().replace(/[\s_-]+/g, " ");
  }

  function plotMatchesFilter(plot, filter) {
    if (!filter) return true;
    if (filter.facing) {
      if (normalizeFacing(plot[FACING_FIELD]) !== normalizeFacing(filter.facing)) {
        return false;
      }
    }
    if (filter.minSqft != null || filter.maxSqft != null) {
      var sqft = getAreaSqft(plot);
      if (sqft == null) return false; // unknown size can't satisfy a size filter
      if (filter.minSqft != null && sqft < filter.minSqft) return false;
      if (filter.maxSqft != null && sqft > filter.maxSqft) return false;
    }
    return true;
  }

  // Re-applies dim/normal styling to every plot hotspot per the active
  // filter, and returns the number of matching (sellable) plots. Skips the
  // currently-selected/highlighted plot so an open popup's highlight isn't
  // clobbered by the dim pass.
  function applyFilterStyling() {
    var matchCount = 0;
    Object.keys(PLOT_DATA).forEach(function (hotspotName) {
      var plot = PLOT_DATA[hotspotName];
      if (plot.isPlot === false) return; // e.g. road-network outline, not filterable
      var matches = plotMatchesFilter(plot, activeFilter);
      if (matches) matchCount++;
      if (hotspotName === currentSelected) return; // leave active selection highlight alone
      if (matches) {
        styleForPlot(hotspotName, plot);
      } else {
        kset("hotspot[" + hotspotName + "].fillalpha", FILTER_DIM_FILLALPHA);
      }
    });
    return matchCount;
  }

  // ---- Public API ------------------------------------------------------
  window.showPlotDetails = function (hotspotName) {
    if (!dataReady) {
      pendingClick = hotspotName; // wait for all_plots_matched.json to finish loading
      return;
    }

    var plot = PLOT_DATA[hotspotName];
    if (!plot) {
      console.warn("plot-popup: no data found for", hotspotName);
      return;
    }
    if (plot.isPlot === false) {
      // e.g. the road-network outline — not a sellable plot, no popup/labels
      return;
    }
    if (activeFilter && !plotMatchesFilter(plot, activeFilter)) {
      // Dimmed-out plot under an active filter — keep it inert so
      // "showing only the matched plots" also means only THOSE are
      // clickable, not just visually de-emphasized while still opening
      // like normal.
      return;
    }

    ensureLabelHotspots();
    drawSideLabels(hotspotName, plot);
    startLabelRefresh(hotspotName, plot);

    highlight(hotspotName);
    renderPopup(plot);
  };

  window.closePlotPopup = function () {
    var root = document.getElementById("plotPopupRoot");
    if (root) {
      root.style.display = "none";
      root.innerHTML = "";
    }
    stopLabelRefresh();
    hideAllLabels();
    clearHighlight();
    // clearHighlight() restores the plot's normal status/category styling —
    // if a filter is active, re-dim it if it no longer qualifies.
    if (activeFilter && dataReady) applyFilterStyling();
  };

  // Expose loader + filter controls so the host page can call
  // plotPopup.init("all_plots_matched.json") and filter-panel.js can call
  // plotPopup.applyFilter(...) / plotPopup.clearFilter().
  window.plotPopup = {
    init: loadPlotData,

    // True once all_plots_matched.json has been fetched and processed
    // (buildCadRing etc.) into PLOT_DATA.
    isDataReady: function () { return dataReady; },

    // Registers cb to run once PLOT_DATA is ready -- immediately if it
    // already is, otherwise as soon as the in-flight/next loadPlotData()
    // call finishes. Lets a second script (road_label_editor.js) wait on
    // the SAME load instead of kicking off its own separate fetch.
    onReady: function (cb) {
      if (typeof cb !== "function") return;
      if (dataReady) cb(PLOT_DATA);
      else dataReadyCallbacks.push(cb);
    },

    // Read-only access to the processed plot data (same objects
    // showPlotDetails()/renderPopup() use internally -- each has
    // {displayName, sides, sidesRing, sideOffsets, status, area, category,
    // needsReview, isPlot}). Pass a hotspot name for just that plot, or
    // call with no argument for the whole { hotspotName: plot } map.
    getPlotData: function (hotspotName) {
      return hotspotName ? PLOT_DATA[hotspotName] : PLOT_DATA;
    },

    // Exposes the exact letter<->edge matching used to draw the real side
    // labels, so another tool (the Plot Dimension Editor's preview) can
    // place its own preview on the SAME edge plot-popup.js would use,
    // instead of guessing from raw JSON array order. `plot` needs a
    // `sidesRing` array (as returned by getPlotData()); `pts` is the
    // polygon's screen/sphere points, e.g. from getPolygonPoints().
    matchSidesToEdges: matchSidesToEdges,

    // Same krpano polygon-point reader showPlotDetails() uses internally,
    // exposed so a consumer doesn't need its own duplicate copy just to
    // call matchSidesToEdges() above.
    getPolygonPoints: getPolygonPoints,

    // Called by filter-panel.js when the user hits SEARCH. `filter` is
    // { facing: string|null, minSqft: number|null, maxSqft: number|null }.
    // Returns the number of matching plots so the panel can show a count.
    applyFilter: function (filter) {
      activeFilter = filter;
      return dataReady ? applyFilterStyling() : 0;
    },

    // Called by filter-panel.js on reset/close — restores every plot to its
    // normal (non-dimmed) status/category styling.
    clearFilter: function () {
      activeFilter = null;
      if (dataReady) applyFilterStyling();
    },

    // Lets another tool (e.g. the plot-dimension-editor's live preview in
    // road_label_editor.js) temporarily take over the side-label display
    // for the currently-open plot, so its own preview labels don't render
    // on top of these "real" ones — same edges, same text, doubled up.
    // Safe to call even if nothing is currently selected.
    pauseSideLabels: function () {
      stopLabelRefresh();
      hideAllLabels();
    },

    // Hands side-label display back to plot-popup.js for whatever plot is
    // still marked selected (no-op if nothing is selected, e.g. the popup
    // was closed in the meantime).
    resumeSideLabels: function () {
      if (currentSelected && PLOT_DATA[currentSelected]) {
        drawSideLabels(currentSelected, PLOT_DATA[currentSelected]);
        startLabelRefresh(currentSelected, PLOT_DATA[currentSelected]);
      }
    }
  };
})();