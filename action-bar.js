/* =========================================================================
   action-bar.js
   Top icon bar: Filter, WhatsApp, Enquiry, 360 Tour, Brochure, Call,
   Location, Compare.

   - Filter    -> toggles window.plotFilterPanel (filter-panel.js) and shows
                  a match-count badge once a search has been run.
   - WhatsApp  -> opens a wa.me chat pre-filled with an enquiry message.
   - Enquiry   -> opens window.enquiryPopup (enquiry-popup.js).
   - Compare   -> toggles window.plotCompare's side-by-side comparison
                  panel (plot-compare.js) and shows a running count badge.
                  Plots are queued for comparison via a "+ Add to Compare"
                  button inside each plot's own popup (plot-popup.js).
   - 360 Tour  -> eases the camera from its current view over to the
                  leftmost landmark hotspot defined in gui_fov_kumaran.xml
                  a bit quickly, then continuously pans at a constant slow
                  speed across to the rightmost one — sweeping past every
                  landmark along the way, no stop-and-go anywhere in the
                  motion — letting each landmark's own reveal animation
                  play as the camera passes it. Click again to stop
                  mid-sweep.
   - Brochure  -> downloads the layout PDF from the site root.
   - Call      -> opens the device's phone dialer via a tel: link.
   - Location  -> opens the site location in Google Maps.

   >>> EDIT THE CONFIG BLOCK BELOW WITH YOUR REAL CONTACT DETAILS. <<<
   Placeholders are used for the phone numbers; the map coordinates default
   to the pano's own geotag from tour.xml (scene lat="11.12801342"
   lng="77.00365839") — swap in your sales-office/site coordinates instead
   if that's more useful for site visits.

   REQUIRES:
   - action-bar.css included in the page.
   - filter-panel.js, enquiry-popup.js and plot-compare.js loaded (load
     order doesn't matter, only that they've run by the time a button is
     clicked).
   - gui_fov_kumaran.xml loaded and window.krpano assigned (needed for
     360 Tour — it reads every landmark_<slug>_dot hotspot's live ath
     straight from krpano; those are created automatically by that XML's
     own landmark_setup() on load, so nothing extra needs calling).
   - A container div in your HTML: <div id="plotActionBarRoot"></div>
   - SUNRISE_VALLEY_layout.pdf present in the site root.
   ========================================================================= */

(function () {
  "use strict";

  // ---- CONFIG: replace with your real details ---------------------------
  var CONFIG = {
    propertyName: "Balaji Parcelaa",

    // Digits only, with country code, no "+", spaces, or dashes (wa.me format).
    whatsappNumber: "91XXXXXXXXXX", // TODO: replace with the real WhatsApp number
    whatsappMessage: "Hi, I'm interested in Balaji Parcelaa. Please share more details.",

    // Any tel:-compatible format, e.g. "+919999999999".
    callNumber: "+91XXXXXXXXXX", // TODO: replace with the real phone number

    // Defaults to the pano's own geotag (tour.xml scene lat/lng).
    locationLat: "11.12801342",
    locationLng: "77.00365839",

    // Deliberately a RELATIVE path (no leading slash): this resolves
    // against the current page's own folder. A leading slash resolves
    // from the actual domain root instead, which breaks the moment the
    // tour is hosted in a subfolder -- exactly the case here on GitHub
    // Pages, where the site lives at autumncoder11.github.io/Sunrise-
    // Valley/, not at the domain root. With a leading slash this was
    // requesting autumncoder11.github.io/SUNRISE_VALLEY_layout.pdf
    // (404 -> GitHub's HTML error page gets downloaded instead of the
    // PDF). If you ever move the PDF into a subfolder alongside
    // index.html (e.g. "assets/SUNRISE_VALLEY_layout.pdf"), update this
    // to match -- it's always relative to wherever index.html lives.
    brochureUrl: "SUNRISE_VALLEY_layout.pdf",
    brochureFileName: "SUNRISE_VALLEY_layout.pdf",

    // Constant speed (compass degrees per second) the camera pans at
    // during 360 Tour's main left-to-right sweep. Lower = slower/smoother.
    tourDegPerSecond: 5,

    // Speed for the initial leg — easing from wherever the camera
    // currently is over to the leftmost landmark — kept a bit quicker
    // than the main sweep so getting into position doesn't feel like a
    // second full sweep of its own.
    tourApproachDegPerSecond: 12,

    // The 360 Tour starts here and sweeps rightward from it — any
    // landmark further left (lower ath) than this one is skipped rather
    // than swept through first. Must match a slug from landmark_define()
    // in gui_fov_kumaran.xml, e.g. "alchemy_public_school" for
    // landmark_alchemy_public_school_dot.
    tourStartLandmarkSlug: "alchemy_public_school",

    // ---- 360 Tour background music -----------------------------------
    // Path to your own audio file, played on loop for exactly the tour's
    // duration (fades in on start, fades out on stop/natural end). Same
    // relative-path rule as brochureUrl above -- resolves against this
    // page's own folder, so it survives being hosted in a subfolder
    // (e.g. GitHub Pages project sites). TODO: point this at your file,
    // e.g. "assets/tour-music.mp3".
    tourMusicUrl: "tour-music.mp3",

    // 0.0 (silent) to 1.0 (the file's native volume). This is the ONE
    // number to change if the music is too loud/quiet -- try 0.5-0.7 for
    // a typical royalty-free ambient/piano track; the previous synthesized
    // pad was intentionally much quieter (0.035) since a raw tone at full
    // volume is harsh, but a real music track doesn't have that problem.
    tourMusicVolume: 0.6,

    // How long the fade in/out takes, in seconds. Keep this instead of an
    // abrupt start/stop -- it also gives the browser a moment to actually
    // begin playback before it's at full volume.
    tourMusicFadeSeconds: 1.2
  };

  var ICONS = {
    filter:
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 5 H20 L14 12.5 V19 L10 21 V12.5 Z"/></svg>',
    whatsapp:
      '<svg viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M17.47 14.38c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.48-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.6-.91-2.2-.24-.58-.49-.5-.67-.51-.17-.01-.37-.01-.57-.01-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.47 0 1.46 1.06 2.87 1.21 3.07.15.2 2.09 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35z"/>' +
      '<path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.06-1.33A9.95 9.95 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18.2c-1.68 0-3.24-.48-4.56-1.31l-.33-.2-3 .79.8-2.92-.21-.34A8.18 8.18 0 0 1 3.8 12c0-4.53 3.68-8.2 8.2-8.2s8.2 3.67 8.2 8.2-3.67 8.2-8.2 8.2z"/></svg>',
    enquiry:
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="currentColor" fill-opacity="0.12" stroke="currentColor"/>' +
      '<path d="M15 2v5h5" stroke="currentColor"/>' +
      '<path d="M8 12h8M8 16h5" stroke="currentColor"/></svg>',
    tour:
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 12a9 9 0 1 1 2.64 6.36" stroke="currentColor"/>' +
      '<path d="M3 17v-5h5" stroke="currentColor"/>' +
      '<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg>',
    brochure:
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="currentColor" fill-opacity="0.12" stroke="currentColor"/>' +
      '<path d="M15 2v5h5" stroke="currentColor"/>' +
      '<path d="M12 11v6" stroke="currentColor"/>' +
      '<path d="M9.5 14.5 12 17l2.5-2.5" stroke="currentColor"/></svg>',
    call:
      '<svg viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.85 21 3 13.15 3 3.5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.24 1.02l-2.21 2.2z"/></svg>',
    location:
      '<svg viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M12 2C7.86 2 4.5 5.36 4.5 9.5c0 5.25 6.24 11.68 6.51 11.95a1.4 1.4 0 0 0 1.98 0c.27-.27 6.51-6.7 6.51-11.95C19.5 5.36 16.14 2 12 2zm0 10.25a2.75 2.75 0 1 1 0-5.5 2.75 2.75 0 0 1 0 5.5z"/></svg>',
    compare:
      // Two side-by-side panels joined by a short bar -- reads as "compare
      // A against B" the same way the filter icon (stroke-only, no fill)
      // does, so it takes the dark active-pill treatment the same way too.
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="4" width="7" height="16" rx="1.5"/>' +
      '<rect x="14" y="4" width="7" height="16" rx="1.5"/>' +
      '<path d="M10.5 9h3M10.5 15h3"/></svg>'
  };

  // ---- 360 Tour audio: click chime + ambient bed --------------------------
  // Everything here is synthesized with the Web Audio API -- no MP3/WAV
  // asset to host or license. One shared AudioContext (created lazily on
  // first click; most browsers block creating one before any user gesture
  // anyway) backs both the short click chime and the looping ambient pad
  // that runs for the tour's full duration.
  var tourAudioCtx = null;

  function getTourAudioCtx() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!tourAudioCtx) tourAudioCtx = new Ctx();
    // Some browsers create the context "suspended" until a gesture resumes
    // it -- the click that got us here IS that gesture, so this is safe to
    // call unconditionally every time.
    if (tourAudioCtx.state === "suspended") tourAudioCtx.resume();
    return tourAudioCtx;
  }

  function playTourChime() {
    try {
      var ctx = getTourAudioCtx();
      if (!ctx) return;
      var now = ctx.currentTime;
      playTone(880, now, 0.09, 0.05);            // A5
      playTone(1174.66, now + 0.06, 0.14, 0.045); // D6, slightly softer
    } catch (e) {
      console.warn("action-bar: tour chime playback failed", e);
    }

    function playTone(freq, startTime, duration, peakGain) {
      var osc = tourAudioCtx.createOscillator();
      var gain = tourAudioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.008); // quick attack
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration); // smooth decay

      osc.connect(gain).connect(tourAudioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    }
  }

  // Background music for the tour's duration -- plays CONFIG.tourMusicUrl
  // on loop, faded in/out over CONFIG.tourMusicFadeSeconds so there's no
  // audible click at start/stop. A plain HTMLAudioElement (not the Web
  // Audio graph the chime uses above) -- much simpler for "just loop this
  // file and set its volume," and .volume can be ramped directly without
  // needing gain nodes at all.
  var tourMusicEl = null;
  var tourMusicFadeTimer = null;

  function getTourMusicEl() {
    if (!tourMusicEl) {
      tourMusicEl = new Audio(CONFIG.tourMusicUrl);
      tourMusicEl.loop = true;
      tourMusicEl.preload = "auto";
    }
    return tourMusicEl;
  }

  // Ramps audio.volume from its current value to targetVolume over
  // durationSeconds using small timed steps (HTMLMediaElement.volume has no
  // built-in scheduling the way Web Audio gain nodes do). Cancels any fade
  // already in progress so rapid start/stop clicks don't fight each other.
  function fadeAudioVolume(audio, targetVolume, durationSeconds, onDone) {
    if (tourMusicFadeTimer) {
      window.clearInterval(tourMusicFadeTimer);
      tourMusicFadeTimer = null;
    }
    var steps = 30;
    var stepMs = (durationSeconds * 1000) / steps;
    var startVolume = audio.volume;
    var stepCount = 0;

    tourMusicFadeTimer = window.setInterval(function () {
      stepCount++;
      var t = stepCount / steps;
      audio.volume = startVolume + (targetVolume - startVolume) * t;
      if (stepCount >= steps) {
        window.clearInterval(tourMusicFadeTimer);
        tourMusicFadeTimer = null;
        audio.volume = targetVolume; // land exactly on target, no rounding drift
        if (onDone) onDone();
      }
    }, stepMs);
  }

  function startTourMusic() {
    var audio = getTourMusicEl();
    audio.volume = 0;
    audio.currentTime = 0; // tour always starts from the top of the track
    var playPromise = audio.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(function (err) {
        // Autoplay-with-sound is occasionally blocked even after a click,
        // on some in-app/webview browsers -- not fatal, the tour itself
        // still runs fine without music.
        console.warn("action-bar: tour music playback failed", err);
      });
    }
    fadeAudioVolume(audio, CONFIG.tourMusicVolume, CONFIG.tourMusicFadeSeconds);
  }

  function stopTourMusic() {
    if (!tourMusicEl) return;
    var audio = tourMusicEl;
    fadeAudioVolume(audio, 0, CONFIG.tourMusicFadeSeconds, function () {
      audio.pause();
    });
  }

  function el(tag, className, html) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function makePill(key, label, extraClass) {
    var btn = el("button", "plot-action-pill plot-action-pill--" + key + (extraClass ? " " + extraClass : ""));
    btn.type = "button";
    var iconWrap = el("span", "plot-action-icon", ICONS[key]);
    btn.appendChild(iconWrap);
    btn.appendChild(el("span", null, label));
    return btn;
  }

  // ---- 360 Tour state ------------------------------------------------------
  // Continuously pans the view from the leftmost to the rightmost
  // landmark_<slug>_dot hotspot defined in gui_fov_kumaran.xml, at one
  // constant slow speed — a single linear tween across the whole span,
  // not a series of stop-start hops between waypoints (that's what made
  // it look like it was pausing). gui_fov_kumaran.xml already reveals
  // each landmark's dot/line/label on its own whenever it drifts near
  // screen center (see landmark_tick there), so simply sweeping the
  // camera past it is enough — no extra calls needed from here.
  var TOUR = {
    active: false,
    btn: null,
    timer: null
  };

  // landmark_<slug>_dot is one hotspot per landmark (paired with
  // _ripple/_line/_title, all sharing the same ath) — matching on "_dot"
  // avoids counting each landmark 4 times.
  var LANDMARK_HOTSPOT_RE = /^landmark_.+_dot$/;

  function tourBuildOrder() {
    var kr = window.krpano;
    if (!kr) return [];
    var count = parseInt(kr.get("hotspot.count"), 10);
    if (!count || isNaN(count)) return [];
    var list = [];
    for (var i = 0; i < count; i++) {
      var name = kr.get("hotspot[" + i + "].name");
      if (!name || !LANDMARK_HOTSPOT_RE.test(name)) continue;
      var ath = parseFloat(kr.get("hotspot[" + i + "].ath"));
      if (isNaN(ath)) continue;
      list.push({ name: name, ath: ath });
    }
    list.sort(function (a, b) { return a.ath - b.ath; }); // left to right

    // Pin the tour's starting point: drop any landmark further left (lower
    // ath) than the configured start, so the sweep begins there and moves
    // right through everything from that point on.
    if (CONFIG.tourStartLandmarkSlug) {
      var startName = "landmark_" + CONFIG.tourStartLandmarkSlug + "_dot";
      var startIdx = -1;
      for (var j = 0; j < list.length; j++) {
        if (list[j].name === startName) { startIdx = j; break; }
      }
      if (startIdx > 0) list = list.slice(startIdx);
    }

    return list;
  }

  function tourStart() {
    if (!window.krpano) {
      console.error("action-bar: window.krpano not available yet");
      return;
    }
    var order = tourBuildOrder();
    if (order.length < 2) {
      console.warn("action-bar: need at least 2 landmark hotspots to sweep across (is gui_fov_kumaran.xml loaded?)");
      return;
    }

    var kr = window.krpano;
    var currentAth = parseFloat(kr.get("view.hlookat"));
    if (isNaN(currentAth)) currentAth = 0;
    var startAth = order[0].ath;
    var endAth = order[order.length - 1].ath;

    TOUR.active = true;
    if (TOUR.btn) TOUR.btn.classList.add("plot-action-pill--active");
    startTourMusic();

    // Phase 1: ease from wherever the camera is right now over to the
    // leftmost landmark, a bit quicker than the main sweep so it reads as
    // "getting into position" rather than a second full-speed pan. Also
    // levels vlookat back to 0, since every landmark sits on the horizon
    // (atv="0.0" in the XML).
    var approachSpan = Math.abs(startAth - currentAth);
    var approachDuration = Math.max(0.4, approachSpan / CONFIG.tourApproachDegPerSecond);
    kr.call("tween(view.hlookat, " + startAth + ", " + approachDuration + ", linear);");
    kr.call("tween(view.vlookat, 0, " + approachDuration + ", linear);");

    TOUR.timer = window.setTimeout(function () {
      if (!TOUR.active) return; // stopped mid-approach

      // Phase 2: the actual left-to-right sweep across every landmark,
      // continuing at the same constant speed with no pause at the join.
      var sweepSpan = Math.abs(endAth - startAth);
      var sweepDuration = Math.max(1, sweepSpan / CONFIG.tourDegPerSecond);
      kr.call("tween(view.hlookat, " + endAth + ", " + sweepDuration + ", linear);");

      TOUR.timer = window.setTimeout(function () {
        tourStop();
      }, sweepDuration * 1000);
    }, approachDuration * 1000);
  }

  function tourStop() {
    var kr = window.krpano;
    if (kr) {
      kr.call("stoptween(view.hlookat);");
    }
    TOUR.active = false;
    if (TOUR.timer) {
      window.clearTimeout(TOUR.timer);
      TOUR.timer = null;
    }
    if (TOUR.btn) TOUR.btn.classList.remove("plot-action-pill--active");
    stopTourMusic();
  }

  function init() {
    var root = document.getElementById("plotActionBarRoot");
    if (!root) {
      console.error("action-bar: #plotActionBarRoot container not found in DOM");
      return;
    }
    root.innerHTML = "";
    var bar = el("div", "plot-action-bar");

    // ---- Filter ----
    var filterBtn = makePill("filter", "Filter");
    var filterBadge = el("span", "plot-action-count-badge");
    filterBtn.appendChild(filterBadge);
    filterBtn.addEventListener("click", function () {
      tourStop(); // don't fight the tour's own view-panning
      if (window.plotFilterPanel && typeof window.plotFilterPanel.toggle === "function") {
        window.plotFilterPanel.toggle();
        filterBtn.classList.toggle("plot-action-pill--active", window.plotFilterPanel.isOpen());
      } else {
        console.error("action-bar: window.plotFilterPanel not available yet");
      }
    });
    document.addEventListener("plotfilter:searched", function (e) {
      var count = e.detail && e.detail.count != null ? e.detail.count : 0;
      filterBadge.style.display = "flex";
      filterBadge.textContent = count;
    });
    document.addEventListener("plotfilter:reset", function () {
      filterBadge.style.display = "none";
    });
    bar.appendChild(filterBtn);

    // ---- WhatsApp ----
    var waBtn = makePill("whatsapp", "WhatsApp");
    waBtn.addEventListener("click", function () {
      var url = "https://wa.me/" + CONFIG.whatsappNumber +
        "?text=" + encodeURIComponent(CONFIG.whatsappMessage);
      window.open(url, "_blank", "noopener");
    });
    bar.appendChild(waBtn);

    // ---- Enquiry ----
    var enquiryBtn = makePill("enquiry", "Enquiry");
    enquiryBtn.addEventListener("click", function () {
      tourStop();
      if (window.enquiryPopup && typeof window.enquiryPopup.open === "function") {
        window.enquiryPopup.open();
      } else {
        console.error("action-bar: window.enquiryPopup not available yet");
      }
    });
    bar.appendChild(enquiryBtn);

    // ---- 360 Tour ----
    var tourBtn = makePill("tour", "360 Tour");
    TOUR.btn = tourBtn;
    tourBtn.addEventListener("click", function () {
      playTourChime();
      if (TOUR.active) {
        tourStop();
      } else {
        tourStart();
      }
    });
    bar.appendChild(tourBtn);

    // ---- Brochure ----
    // The download attribute only forces a save when the PDF is served from
    // the same origin as this page. Cross-origin (CDN) hosting needs a
    // Content-Disposition: attachment header on the server instead.
    var brochureBtn = makePill("brochure", "Brochure");
    brochureBtn.addEventListener("click", function () {
      var a = document.createElement("a");
      a.href = CONFIG.brochureUrl;
      a.download = CONFIG.brochureFileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
    bar.appendChild(brochureBtn);

    // ---- Call ----
    var callBtn = makePill("call", "Call");
    callBtn.addEventListener("click", function () {
      window.location.href = "tel:" + CONFIG.callNumber;
    });
    bar.appendChild(callBtn);

    // ---- Compare ----
    // Opens/closes the side-by-side comparison panel (plot-compare.js).
    // Plots are added to the list from a "+ Add to Compare" button inside
    // each plot's own popup (plot-popup.js) -- this pill just shows how
    // many are queued up (badge, same look as Filter's match-count badge)
    // and toggles the panel.
    var compareBtn = makePill("compare", "Compare");
    var compareBadge = el("span", "plot-action-count-badge");
    compareBtn.appendChild(compareBadge);
    compareBtn.addEventListener("click", function () {
      tourStop(); // don't fight the tour's own view-panning
      if (window.plotCompare && typeof window.plotCompare.togglePanel === "function") {
        window.plotCompare.togglePanel();
        // Pressed/active look is NOT set here -- see the
        // "plotcompare:panelchanged" listener below. Setting it directly
        // from this click only handled the pill closing itself; it never
        // reset when the panel was closed some other way (Clear All, the
        // panel's own X, tapping outside it), leaving the pill looking
        // permanently pressed.
      } else {
        console.error("action-bar: window.plotCompare not available yet");
      }
    });
    document.addEventListener("plotcompare:changed", function (e) {
      var count = e.detail && e.detail.count != null ? e.detail.count : 0;
      if (count > 0) {
        compareBadge.style.display = "flex";
        compareBadge.textContent = count;
      } else {
        compareBadge.style.display = "none";
      }
    });
    // Single source of truth for the pill's pressed look: fires from
    // plot-compare.js on every actual open/close, regardless of what
    // triggered it (this pill, Clear All, the panel's own X, or tapping
    // its backdrop).
    document.addEventListener("plotcompare:panelchanged", function (e) {
      compareBtn.classList.toggle("plot-action-pill--active", !!(e.detail && e.detail.open));
    });
    bar.appendChild(compareBtn);

    // ---- Location ----
    var locationBtn = makePill("location", "Location");
    locationBtn.addEventListener("click", function () {
      var url = "https://www.google.com/maps?q=" + CONFIG.locationLat + "," + CONFIG.locationLng;
      window.open(url, "_blank", "noopener");
    });
    bar.appendChild(locationBtn);

    root.appendChild(bar);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Exposed in case another script needs the resolved contact config
  // (e.g. enquiry-popup.js showing the property name in its header).
  window.plotActionBarConfig = CONFIG;
})();
