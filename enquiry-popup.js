/* =========================================================================
   enquiry-popup.js
   General "Enquiry" lead-capture modal, opened via window.enquiryPopup.open()
   (wired to the action bar's Enquiry icon in action-bar.js).

   >>> No backend was specified, so submission is LOCAL-ONLY by default: <<<
   it validates the fields, logs the enquiry to the console, and shows the
   "we will get back to you" confirmation. Set ENQUIRY_SUBMIT_URL below to
   a real endpoint (your CRM, a serverless function, etc.) to actually send
   the lead somewhere — the fetch() call is already wired up, just needs a
   URL.

   REQUIRES:
   - enquiry-popup.css included in the page.
   - A container div in your HTML: <div id="enquiryPopupRoot"></div>
   ========================================================================= */

(function () {
  "use strict";

  // TODO: point this at your real lead-capture endpoint, e.g.
  // "https://your-api.example.com/enquiries". Left null = local-only
  // (validates + shows the confirmation message, but doesn't send anywhere).
  var ENQUIRY_SUBMIT_URL = null;

  var els = {};

  function el(tag, className, html) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function propertyName() {
    return (window.plotActionBarConfig && window.plotActionBarConfig.propertyName) || "this property";
  }

  function render(root) {
    root.innerHTML = "";

    var overlay = el("div", "enquiry-popup-overlay");
    root.appendChild(overlay);

    var card = el("div", "enquiry-popup-card");

    var header = el("div", "enquiry-popup-header");
    header.appendChild(el("h2", "enquiry-popup-title", "Enquiry"));
    header.appendChild(el("p", "enquiry-popup-subtitle",
      propertyName() + " - We will get back to you soon"));
    var closeBtn = el("button", "enquiry-popup-close", "&times;");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    header.appendChild(closeBtn);
    card.appendChild(header);

    var body = el("div", "enquiry-popup-body");

    var typeBtn = el("button", "enquiry-popup-type-btn", "General enquiry");
    typeBtn.type = "button";
    body.appendChild(typeBtn);

    var form = el("form", "enquiry-popup-form");

    var nameField = el("div", "enquiry-popup-field");
    nameField.appendChild(el("label", null, "Name"));
    var nameInput = el("input");
    nameInput.type = "text";
    nameInput.placeholder = "Your full name";
    nameField.appendChild(nameInput);
    var nameError = el("div", "enquiry-popup-field-error", "Please enter your name");
    nameField.appendChild(nameError);
    form.appendChild(nameField);

    var emailField = el("div", "enquiry-popup-field");
    emailField.appendChild(el("label", null, "Email"));
    var emailInput = el("input");
    emailInput.type = "email";
    emailInput.placeholder = "your@email.com";
    emailField.appendChild(emailInput);
    var emailError = el("div", "enquiry-popup-field-error", "Please enter a valid email");
    emailField.appendChild(emailError);
    form.appendChild(emailField);

    var mobileField = el("div", "enquiry-popup-field");
    mobileField.appendChild(el("label", null, "Mobile"));
    var mobileInput = el("input");
    mobileInput.type = "tel";
    mobileInput.placeholder = "10-digit mobile number";
    mobileField.appendChild(mobileInput);
    var mobileError = el("div", "enquiry-popup-field-error", "Please enter a valid 10-digit mobile number");
    mobileField.appendChild(mobileError);
    form.appendChild(mobileField);

    var submitBtn = el("button", "enquiry-popup-submit", "Submit Enquiry");
    submitBtn.type = "submit";
    form.appendChild(submitBtn);

    var statusEl = el("div", "enquiry-popup-status");
    form.appendChild(statusEl);

    body.appendChild(form);
    card.appendChild(body);
    root.appendChild(card);

    els = {
      overlay: overlay, card: card, closeBtn: closeBtn, form: form,
      nameInput: nameInput, nameError: nameError,
      emailInput: emailInput, emailError: emailError,
      mobileInput: mobileInput, mobileError: mobileError,
      submitBtn: submitBtn, statusEl: statusEl,
      subtitleEl: header.querySelector(".enquiry-popup-subtitle")
    };

    wire();
  }

  function setFieldValid(input, errorEl, valid) {
    input.classList.toggle("enquiry-popup-field--invalid", !valid);
    errorEl.classList.toggle("enquiry-popup-field-error--visible", !valid);
  }

  function validate() {
    var nameOk = els.nameInput.value.trim().length > 0;
    var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(els.emailInput.value.trim());
    var mobileOk = /^\d{10}$/.test(els.mobileInput.value.trim());
    setFieldValid(els.nameInput, els.nameError, nameOk);
    setFieldValid(els.emailInput, els.emailError, emailOk);
    setFieldValid(els.mobileInput, els.mobileError, mobileOk);
    return nameOk && emailOk && mobileOk;
  }

  function setStatus(message, kind) {
    els.statusEl.textContent = message;
    els.statusEl.className = "enquiry-popup-status" +
      (kind ? " enquiry-popup-status--" + kind : "");
  }

  function submitEnquiry(payload) {
    if (!ENQUIRY_SUBMIT_URL) {
      // No backend configured — treat as a successful local capture.
      console.log("enquiry-popup: (local only, no ENQUIRY_SUBMIT_URL set) enquiry:", payload);
      return Promise.resolve();
    }
    return fetch(ENQUIRY_SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error("Server responded with " + res.status);
    });
  }

  function wire() {
    function close() {
      var root = document.getElementById("enquiryPopupRoot");
      if (root) root.style.display = "none";
    }

    els.closeBtn.addEventListener("click", close);
    els.overlay.addEventListener("click", close);

    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!validate()) return;

      var payload = {
        property: propertyName(),
        type: "General enquiry",
        name: els.nameInput.value.trim(),
        email: els.emailInput.value.trim(),
        mobile: els.mobileInput.value.trim(),
        submittedAt: new Date().toISOString()
      };

      els.submitBtn.disabled = true;
      setStatus("Submitting...", null);
      els.statusEl.style.display = "block";

      submitEnquiry(payload)
        .then(function () {
          setStatus("Thanks! We will get back to you soon.", "success");
          els.form.reset();
        })
        .catch(function (err) {
          console.error("enquiry-popup: submission failed", err);
          setStatus("Something went wrong. Please try again.", "error");
        })
        .then(function () {
          els.submitBtn.disabled = false;
        });
    });
  }

  function init() {
    var root = document.getElementById("enquiryPopupRoot");
    if (!root) {
      console.error("enquiry-popup: #enquiryPopupRoot container not found in DOM");
      return;
    }
    render(root);

    window.enquiryPopup = {
      open: function () {
        if (els.subtitleEl) {
          els.subtitleEl.textContent = propertyName() + " - We will get back to you soon";
        }
        root.style.display = "flex";
      },
      close: function () {
        root.style.display = "none";
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
