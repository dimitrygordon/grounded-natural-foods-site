/* The Living Newspaper — presentational motion layer, loaded after
   ledger-motion.js. Never touches cart/order data; only reads it (via the
   global `orderCart` from app.js) to decide whether to play a confirmation
   animation. Everything here degrades to a plain static page with no JS
   and respects prefers-reduced-motion. */
(function () {
  "use strict";
  var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("np-js");

  /* ---------------- scroll-tied paper tear ---------------- */
  // Progress is driven purely by the hero layer's own position relative to
  // the viewport (no pinning/spacer math): 0 while fully on screen, 1 once
  // it has scrolled a full height of its own above the top of the
  // viewport. Rounded to 3 decimals so we're not thrashing the custom
  // property on every sub-pixel scroll.
  var layer = document.getElementById("np-tear-layer");
  if (layer && !RM) {
    var ticking = false;
    function updateTear() {
      ticking = false;
      var rect = layer.getBoundingClientRect();
      var raw = -rect.top / Math.max(rect.height, 1);
      var t = Math.max(0, Math.min(1, raw));
      layer.style.setProperty("--tear", t.toFixed(3));
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(updateTear);
    }
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    updateTear();
  }

  /* ---------------- developing photographs ---------------- */
  // Produce images start low-contrast/soft (see newspaper.css, gated by
  // .np-js so there's never a "stuck blurry" state without this script)
  // and sharpen into focus the first time they scroll into view.
  if ("IntersectionObserver" in window) {
    var devIo = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          en.target.classList.add("np-developed");
          devIo.unobserve(en.target);
        });
      },
      { threshold: 0.2 }
    );
    function watchProduceImages() {
      document.querySelectorAll("#produce-list .produce-img:not(.np-developed)").forEach(function (img) {
        devIo.observe(img);
      });
    }
    watchProduceImages();
    var plEl = document.getElementById("produce-list");
    if (plEl) new MutationObserver(watchProduceImages).observe(plEl, { childList: true });
  } else {
    document.querySelectorAll("#produce-list .produce-img").forEach(function (img) {
      img.classList.add("np-developed");
    });
  }

  /* ---------------- add-to-cart: a clipping flies to the order button ---------------- */
  // Purely decorative confirmation — the actual cart state (orderCart, from
  // app.js) has already been updated synchronously by the click handler
  // app.js registers; this only ever reads it afterward to decide whether
  // to play the animation, and never delays or blocks it.
  function cartCount() {
    try {
      return (window.orderCart || []).reduce(function (n, l) { return n + (l.qty || 1); }, 0);
    } catch (_) {
      return null;
    }
  }
  function flyTo(fromEl, label) {
    var target = document.querySelector('[data-action="place-order"]') || document.querySelector(".ledger-order-card");
    if (!target || RM) return;
    var a = fromEl.getBoundingClientRect(), b = target.getBoundingClientRect();
    var el = document.createElement("span");
    el.className = "np-flyer";
    el.textContent = "+ " + (label || "added");
    el.style.left = a.left + a.width / 2 + "px";
    el.style.top = a.top + a.height / 2 + "px";
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      el.style.opacity = "1";
      el.classList.add("np-fly");
      el.style.transform =
        "translate(" + (b.left + b.width / 2 - (a.left + a.width / 2)) + "px," +
        (b.top + b.height / 2 - (a.top + a.height / 2)) + "px) scale(.5)";
      el.style.opacity = "0";
    });
    setTimeout(function () { el.remove(); }, 650);
  }
  document.addEventListener(
    "click",
    function (e) {
      var row = e.target.closest && e.target.closest(".deli-item, .soup-day-row, .soup-cell:not(.empty)");
      if (!row || !row.closest("#view-public")) return;
      if (row.classList.contains("sold-out-item") || row.querySelector(".sold-out-tag")) return;
      var before = cartCount();
      if (before === null) return;
      setTimeout(function () {
        if (cartCount() !== before && row.isConnected) {
          var nameEl = row.querySelector(".deli-item-name, .s-name") || row;
          flyTo(row, (nameEl.textContent || "").trim().split("  ")[0].slice(0, 22));
        }
      }, 50);
    },
    true
  );
})();
