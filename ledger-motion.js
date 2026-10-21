/* Ledger theme motion: presentational only. Never touches data, ordering or auth. */
(function () {
  "use strict";
  var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var NS = "http://www.w3.org/2000/svg";
  var TICK = '<path d="M4 16 C7 18 9 21 11 25 C14 16 19 9 27 4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
  document.documentElement.classList.add("ledger-js");

  function svg(cls, vb, inner) {
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("class", cls); s.setAttribute("viewBox", vb); s.setAttribute("aria-hidden", "true");
    s.innerHTML = inner; return s;
  }
  function measure(root) {
    root.querySelectorAll(".ledger-draw").forEach(function (g) {
      g.querySelectorAll("path,circle,ellipse,line").forEach(function (e) {
        try { e.style.setProperty("--len", Math.ceil(e.getTotalLength()) + 2); } catch (_) {}
      });
    });
  }
  function play(root) {
    if (!root.classList.contains("ledger-in") && root.classList.contains("panel")) return;
    root.querySelectorAll(".ledger-stampin:not(.ledger-go)").forEach(function (s, i) { setTimeout(function () { s.classList.add("ledger-go"); }, i * 120); });
    root.querySelectorAll(".ledger-draw:not(.ledger-drawn)").forEach(function (s, i) { setTimeout(function () { s.classList.add("ledger-drawn"); }, i * 90); });
  }

  /* Decorate rows that app.js renders (re-run whenever it re-renders). */
  function decorate() {
    document.querySelectorAll("#deli-grid .deli-item, #deli-grid .soup-day-row, #soup-cal .soup-cell:not(.empty)").forEach(function (el) {
      if (!el.querySelector(".ledger-chk")) el.appendChild(svg("ledger-chk", "0 0 30 30", TICK));
    });
    var PI = window.ProduceIcons;
    document.querySelectorAll("#produce-list .produce-row, #produce-admin-list .produce-row").forEach(function (row, i) {
      if (row.getAttribute("data-ledger") === "1") return;
      row.setAttribute("data-ledger", "1");
      var nameEl = row.querySelector(".produce-name");
      var raw = nameEl ? nameEl.textContent : "";
      var key = (row.getAttribute("data-icon") || "");
      if (PI && !PI.icons[key]) key = PI.guess(raw);
      if (PI && key && !row.querySelector("img.produce-img")) {
        var wrap = document.createElement("span");
        wrap.className = "ledger-sprout-wrap";
        wrap.innerHTML = PI.svg(key, row.closest("#produce-list") ? "ledger-sprout ledger-draw" : "ledger-sprout");
        row.insertBefore(wrap, row.firstChild);
        if (nameEl) nameEl.textContent = PI.stripEmoji(raw) || raw; /* display only; the stored name keeps its emoji */
      }
      if (row.closest("#produce-list") && i % 2 === 0) {
        var st = document.createElement("span");
        st.className = "ledger-season ledger-stampin"; st.setAttribute("aria-hidden", "true");
        st.innerHTML = "In<br>season"; row.appendChild(st);
      }
    });
    measure(document);
    document.querySelectorAll(".panel.ledger-in").forEach(play);
  }
  var pending = false;
  new MutationObserver(function () {
    if (pending) return; pending = true;
    requestAnimationFrame(function () { pending = false; decorate(); });
  }).observe(document.body, { childList: true, subtree: true });
  decorate();

  /* Tap a menu row: draw a checkmark. Purely visual; app.js click handlers still run. */
  document.addEventListener("click", function (e) {
    var row = e.target.closest && e.target.closest(".deli-item, .soup-day-row, .soup-cell:not(.empty)");
    if (row && row.closest("#view-public")) row.classList.toggle("ledger-done");
  });

  /* Header stamp date */
  var d = document.getElementById("ledger-today");
  if (d) d.textContent = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
  setTimeout(function () { play(document.querySelector(".site-header")); }, 250);

  /* Panels drop in one after another */
  var panels = [].slice.call(document.querySelectorAll("#view-public .panel"));
  function reveal(p) { p.classList.add("ledger-in"); setTimeout(function () { play(p); }, 450); }
  if (RM || !("IntersectionObserver" in window)) { panels.forEach(reveal); document.querySelectorAll(".ledger-stampin").forEach(function (s) { s.classList.add("ledger-go"); }); }
  else {
    var q = 0;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        setTimeout(function () { reveal(e.target); }, (q++) * 160);
        setTimeout(function () { q = Math.max(0, q - 1); }, 400);
      });
    }, { threshold: 0.05, rootMargin: "0px 0px -5% 0px" });
    panels.forEach(function (p) { io.observe(p); });
  }

  /* Safety net: reveal any panel that is already on or above the screen */
  function sweep() {
    panels.forEach(function (p) { if (!p.classList.contains("ledger-in") && p.getBoundingClientRect().top < innerHeight) reveal(p); });
  }
  addEventListener("scroll", sweep, { passive: true });
  setTimeout(sweep, 1500);

  /* Mobile: keep the order card pinned once it scrolls past */
  var slot = document.querySelector(".ledger-order-slot"), card = slot && slot.querySelector(".ledger-order-card");
  var mq = window.matchMedia("(max-width:600px)");
  function pin() {
    if (!slot) return;
    var stick = mq.matches && slot.getBoundingClientRect().bottom < 0 && !document.getElementById("view-public").classList.contains("hidden");
    if (stick && !card.classList.contains("ledger-stuck")) { slot.style.minHeight = slot.offsetHeight + "px"; card.classList.add("ledger-stuck"); }
    else if (!stick && card.classList.contains("ledger-stuck")) { card.classList.remove("ledger-stuck"); slot.style.minHeight = ""; }
  }
  addEventListener("scroll", pin, { passive: true }); addEventListener("resize", pin);

  /* Light paper parallax on the ruled lines */
  if (!RM) {
    var tk = 0;
    addEventListener("scroll", function () {
      if (tk) return;
      tk = requestAnimationFrame(function () { document.body.style.setProperty("--ledger-shift", (-(scrollY * 0.06) % 32) + "px"); tk = 0; });
    }, { passive: true });
  }
})();
