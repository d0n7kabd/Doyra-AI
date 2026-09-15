/* ============================================================================
   DOYRA AI — script.js
   Three responsibilities:
     1. Mobile nav toggle
     2. Scroll-reveal for section content (progressive enhancement)
     3. The hero signature element: an animated top-down doyra whose center
        pulse follows an UNEVEN usul-like pattern (dum-tak-tak-dum-tak with
        irregular timing), with faint expanding ripples on strong ("dum")
        beats and a slowly rotating star-tile ornament ring.
   Nothing here reflects real measured data — see index.html for CONTENT TODO
   markers if you're looking for placeholders instead of behavior.
   ============================================================================ */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --------------------------- 1. mobile nav ----------------------------- */
  var navToggle = document.getElementById("nav-toggle");
  var navLinks = document.getElementById("nav-links");

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      var isOpen = navLinks.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    navLinks.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navLinks.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ------------------------- 2. scroll reveals ---------------------------- */
  var revealTargets = document.querySelectorAll(
    ".overview-card, .pipeline-step, .stat-card, .placeholder, .table-wrap, .about-grid, .bibtex-block, .gallery-grid > *"
  );

  revealTargets.forEach(function (el) { el.classList.add("reveal"); });

  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    revealTargets.forEach(function (el) { io.observe(el); });
  } else {
    // No IO support, or reduced motion requested: just show everything.
    revealTargets.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* -------------------- 3. hero doyra: ring + heartbeat -------------------- */
  var svg = document.getElementById("doyra-svg");
  if (!svg) return;

  var ring = document.getElementById("ornament-ring");
  var ringStarsGroup = document.getElementById("ring-stars");
  var pulseCore = document.getElementById("pulse-core");
  var pulseGlow = document.getElementById("pulse-glow");
  var rippleLayer = document.getElementById("ripple-layer");
  var beatLabel = document.getElementById("beat-label");

  var SVG_NS = "http://www.w3.org/2000/svg";
  var CENTER = 200;

  // Build 16 small star glyphs evenly around the ornament ring.
  // (Placed via JS rather than hand-authored so the count/radius stay easy
  // to tune without rewriting 16 transform strings by hand.)
  function buildRingStars() {
    if (!ringStarsGroup) return;
    var count = 16;
    var radius = 168;
    for (var i = 0; i < count; i++) {
      var angle = (i / count) * Math.PI * 2;
      var cx = CENTER + radius * Math.cos(angle);
      var cy = CENTER + radius * Math.sin(angle);
      var star = document.createElementNS(SVG_NS, "use");
      star.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#star-glyph");
      star.setAttribute("href", "#star-glyph");
      var scale = 0.34;
      var size = 40 * scale;
      star.setAttribute("transform",
        "translate(" + (cx - size / 2) + "," + (cy - size / 2) + ") scale(" + scale + ")"
      );
      ringStarsGroup.appendChild(star);
    }
  }
  buildRingStars();

  if (!reduceMotion && ring) {
    ring.classList.add("spin");
  }

  // The usul pattern: an irregular dum/tak/roll cycle. "dum" = deep center
  // strike (strong, triggers a ripple). "tak" = sharp rim strike (light,
  // quick). Durations are deliberately uneven — this is not a metronome.
  var pattern = [
    { type: "dum", hold: 90, gap: 260 },
    { type: "tak", hold: 55, gap: 150 },
    { type: "tak", hold: 55, gap: 190 },
    { type: "dum", hold: 90, gap: 340 },
    { type: "tak", hold: 55, gap: 130 },
    { type: "roll", hold: 160, gap: 300 }
  ];

  var stepIndex = 0;
  var beatTimer = null;

  function spawnRipple() {
    if (reduceMotion || !rippleLayer) return;
    var circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", CENTER);
    circle.setAttribute("cy", CENTER);
    circle.setAttribute("r", 34);
    circle.setAttribute("class", "ripple");
    rippleLayer.appendChild(circle);

    var start = null;
    var duration = 900;

    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min((ts - start) / duration, 1);
      var r = 34 + t * 110;
      var opacity = 0.5 * (1 - t);
      circle.setAttribute("r", r);
      circle.setAttribute("stroke-opacity", opacity);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        circle.remove();
      }
    }
    requestAnimationFrame(frame);
  }

  function fireBeat(step) {
    if (beatLabel) beatLabel.textContent = step.type;

    if (reduceMotion) return; // static drum, no pulse/ripple animation

    var strong = step.type === "dum";
    var scale = strong ? 1.32 : step.type === "roll" ? 1.15 : 1.12;
    var glowScale = strong ? 1.5 : 1.2;

    pulseCore.style.transition = "transform 90ms ease-out";
    pulseGlow.style.transition = "transform 90ms ease-out, opacity 90ms ease-out";
    pulseCore.style.transform = "scale(" + scale + ")";
    pulseGlow.style.transform = "scale(" + glowScale + ")";
    pulseGlow.style.opacity = "1";

    if (strong) spawnRipple();

    setTimeout(function () {
      pulseCore.style.transition = "transform 260ms ease-in";
      pulseGlow.style.transition = "transform 260ms ease-in, opacity 260ms ease-in";
      pulseCore.style.transform = "scale(1)";
      pulseGlow.style.transform = "scale(1)";
      pulseGlow.style.opacity = "0.6";
    }, step.hold);
  }

  function scheduleNextBeat() {
    var step = pattern[stepIndex % pattern.length];
    fireBeat(step);
    beatTimer = setTimeout(function () {
      stepIndex++;
      scheduleNextBeat();
    }, step.hold + step.gap);
  }

  // Kick off the heartbeat. If the user has asked for reduced motion we still
  // update the text label once (so the page isn't stuck on placeholder text)
  // but skip the recurring animation loop entirely.
  if (reduceMotion) {
    if (beatLabel) beatLabel.textContent = "dum";
  } else {
    scheduleNextBeat();
  }

  // Pause the loop when the tab isn't visible, resume on return.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      clearTimeout(beatTimer);
    } else if (!reduceMotion) {
      scheduleNextBeat();
    }
  });
})();
