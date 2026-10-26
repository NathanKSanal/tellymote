/* TellyMote scroll cinema.
   Layer 1 (always): topbar behaviour, hash routing, shared TM surface.
   Layer 2 (GSAP + consented motion): Lenis inertia scroll, preloader,
   the three signature moments, the scroll-scrubbed film.
   Every hidden state is created from JS, so no-script and
   reduced-motion visitors get the complete page. */
(() => {
  "use strict";

  const doc = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ------------------------------------------------ motion consent */
  const param = new URLSearchParams(location.search).get("motion");
  const prefersReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reduce = param === "reduced" ? true : param === "full" ? false : prefersReduce;
  doc.classList.toggle("reduced", reduce);

  const hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const motionOK = hasGsap && !reduce;

  const FILM_CHAPTERS = [0, 5, 10, 15, 20, 25];
  const FILM_DURATION = 30;
  const TM = (window.TM = { reduce, lenis: null, cues: null, scrollTo: null, playFilmWithSound: null, chapters: FILM_CHAPTERS });

  /* scroll velocity, px per frame — drives the reactive marquee */
  let vel = 0;

  /* ------------------------------------------------ topbar */
  const bar = $("[data-topbar]");
  const setBar = (y, dir) => {
    if (!bar) return;
    bar.classList.toggle("is-scrolled", y > 12);
    if (dir) bar.classList.toggle("is-hidden", dir === "down" && y > 460 && !bar.contains(document.activeElement));
  };

  /* ------------------------------------------------ smooth scroll (Lenis) */
  let lenis = null;
  if (hasGsap) {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    if (!reduce && typeof window.Lenis === "function") {
      lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
      /* the class must not contain the substring "lenis": Lenis rewrites
         <html>.className with replace(/lenis(-\w+)?/g, "") on every state
         change, which would shred it into "has-" */
      doc.classList.add("has-smooth");
      /* the class alone is not enough: native smooth scrolling must never
         fight Lenis, and an inline style cannot be undone by class churn */
      doc.style.scrollBehavior = "auto";
      TM.lenis = lenis;
      lenis.on("scroll", (e) => {
        ScrollTrigger.update();
        setBar(e.scroll ?? window.scrollY, e.direction === 1 ? "down" : e.direction === -1 ? "up" : null);
        if (typeof e.velocity === "number") vel = e.velocity;
      });
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    }

    /* scroll-event starvation guard: some embedded/occluded contexts move
       window.scrollY without ever dispatching a scroll event (events are
       tied to frame production). One numeric compare per tick keeps
       ScrollTrigger and the topbar honest everywhere. Also re-fires the
       resize event when the viewport changes silently, so gsap.matchMedia
       contexts and pin layout rebuild. */
    if (!reduce) {
      let lastY = window.scrollY;
      let lastW = window.innerWidth;
      let lastH = window.innerHeight;
      gsap.ticker.add(() => {
        const y = window.scrollY;
        if (y !== lastY) {
          vel = y - lastY;
          setBar(y, y > lastY ? "down" : "up");
          lastY = y;
          ScrollTrigger.update();
        }
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (w !== lastW || h !== lastH) {
          lastW = w;
          lastH = h;
          window.dispatchEvent(new Event("resize"));
        }
      });
    }
  }
  if (!lenis) {
    let lastY = window.scrollY;
    window.addEventListener(
      "scroll",
      () => {
        const y = window.scrollY;
        vel = y - lastY;
        setBar(y, y > lastY + 2 ? "down" : y < lastY - 2 ? "up" : null);
        lastY = y;
      },
      { passive: true },
    );
    setBar(window.scrollY, null);
  }

  /* ------------------------------------------------ in-page navigation */
  TM.scrollTo = (target, offset = 0) => {
    const el = typeof target === "string" ? $(target) : target;
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset, duration: 1.35 });
    else el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (!id || id.length < 2) return;
      const el = $(id);
      if (!el) return;
      e.preventDefault();
      TM.scrollTo(el);
      history.replaceState(null, "", id);
    });
  });
  $$("[data-open-cinema]").forEach((b) => b.addEventListener("click", () => TM.scrollTo("#cinema")));

  /* ------------------------------------------------ captions, shared with the player */
  const parseVTT = (text) => {
    const cues = [];
    for (const block of text.replace(/\r/g, "").split("\n\n")) {
      const m = block.match(
        /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})([\s\S]*)/,
      );
      if (!m) continue;
      const t = (h, mn, s, ms) => Number(h) * 3600 + Number(mn) * 60 + Number(s) + Number(ms) / 1000;
      cues.push({
        start: t(m[1], m[2], m[3], m[4]),
        end: t(m[5], m[6], m[7], m[8]),
        text: m[9].trim().replace(/\n/g, " "),
      });
    }
    return cues;
  };
  fetch("media/tellymote-3d.vtt")
    .then((r) => (r.ok ? r.text() : ""))
    .then((t) => {
      if (t) TM.cues = parseVTT(t);
    })
    .catch(() => {});

  /* ------------------------------------------------ custom cursor */
  const cursor = $("[data-cursor]");
  if (cursor && motionOK && canHover) {
    doc.classList.add("cursor-on");
    const labelEl = $("[data-cursor-label]", cursor);
    const xTo = gsap.quickTo(cursor, "x", { duration: 0.32, ease: "power3.out" });
    const yTo = gsap.quickTo(cursor, "y", { duration: 0.32, ease: "power3.out" });
    let seen = false;
    window.addEventListener(
      "pointermove",
      (e) => {
        if (!seen) {
          seen = true;
          gsap.set(cursor, { x: e.clientX, y: e.clientY });
          cursor.classList.add("is-visible");
        }
        xTo(e.clientX);
        yTo(e.clientY);
        const hot = e.target.closest("a, button, summary, [role='slider'], video, [data-hover]");
        cursor.classList.toggle("is-active", !!hot);
        const labelled = hot && hot.closest("[data-cursor-label]");
        labelEl.textContent = labelled ? labelled.dataset.cursorLabel : "";
        cursor.classList.toggle("has-label", !!labelled);
      },
      { passive: true },
    );
    document.addEventListener("pointerleave", () => cursor.classList.remove("is-visible"));
    document.addEventListener("pointerenter", () => {
      if (seen) cursor.classList.add("is-visible");
    });
  }

  /* ------------------------------------------------ magnetic buttons */
  if (motionOK && finePointer) {
    $$("[data-magnetic]").forEach((el) => {
      const xTo = gsap.quickTo(el, "x", { duration: 0.35, ease: "power3.out" });
      const yTo = gsap.quickTo(el, "y", { duration: 0.35, ease: "power3.out" });
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * 0.18);
        yTo((e.clientY - (r.top + r.height / 2)) * 0.28);
      });
      el.addEventListener("pointerleave", () => {
        xTo(0);
        yTo(0);
      });
    });
  }

  /* ------------------------------------------------ title splitter */
  const splitTitle = (el) => {
    if (!el || el.dataset.splitDone) return [];
    el.dataset.splitDone = "1";
    const chars = [];
    const label = el.textContent.trim().replace(/\s+/g, " ");
    $$(".line", el).forEach((line) => {
      const frag = document.createDocumentFragment();
      const walk = (node, accent) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const words = node.textContent.split(/(\s+)/);
          words.forEach((word) => {
            if (!word) return;
            if (/^\s+$/.test(word)) {
              frag.appendChild(document.createTextNode(" "));
              return;
            }
            const w = document.createElement("span");
            w.className = "word";
            for (const ch of word) {
              const c = document.createElement("span");
              c.className = "char" + (accent ? " is-accent" : "");
              c.textContent = ch;
              w.appendChild(c);
              chars.push(c);
            }
            frag.appendChild(w);
          });
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          for (const child of Array.from(node.childNodes)) walk(child, true);
        }
      };
      Array.from(line.childNodes).forEach((n) => walk(n, false));
      line.textContent = "";
      line.appendChild(frag);
    });
    if (label) {
      el.setAttribute("aria-label", label);
      $$(".line", el).forEach((l) => l.setAttribute("aria-hidden", "true"));
    }
    return chars;
  };

  /* ================================================================
     SIGNATURE MOMENT 01 — the product reveal.
     Three real screenshots share one preserve-3d stage. The resting
     pose is a fan; scrolling closes the fan into a single deck, which
     is the whole argument of the page: discovery, dashboard and
     remote are one object, not three features.
     ================================================================ */
  const stage = $("[data-stage3d]");
  const plates = stage ? $$(".plate", stage) : [];
  const stageRim = stage ? $(".stage-rim", stage) : null;
  const stageGlow = stage ? $(".stage-glow", stage) : null;

  /* desktop: real depth. compact: a flat offset stack (no perspective) */
  const POSE_WIDE = [
    { xPercent: -11, yPercent: 0, rotateY: 18, rotateX: 0, z: -160, opacity: 0.92, zIndex: 1 },
    { xPercent: 0, yPercent: 0, rotateY: 0, rotateX: 0, z: 0, opacity: 1, zIndex: 3 },
    { xPercent: 11, yPercent: 0, rotateY: -18, rotateX: 0, z: -160, opacity: 0.92, zIndex: 2 },
  ];
  const POSE_NARROW = [
    { xPercent: -5, yPercent: 0, rotateY: 0, rotateX: 0, z: 0, opacity: 1, zIndex: 2 },
    { xPercent: 0, yPercent: 0, rotateY: 0, rotateX: 0, z: 0, opacity: 1, zIndex: 3 },
    { xPercent: 5, yPercent: 0, rotateY: 0, rotateX: 0, z: 0, opacity: 1, zIndex: 1 },
  ];
  /* the closed deck: hairline y offsets so all three edges stay visible */
  const POSE_CLOSED = [
    { xPercent: 0, yPercent: -1.6, rotateY: 0, z: 0, opacity: 1 },
    { xPercent: 0, yPercent: 0, rotateY: 0, z: 30, opacity: 1 },
    { xPercent: 0, yPercent: 1.6, rotateY: 0, z: -30, opacity: 1 },
  ];
  let stagePose = POSE_NARROW;
  if (motionOK && window.matchMedia("(min-width: 1081px)").matches) stagePose = POSE_WIDE;

  /* Hide the stage before first interactive paint so a skipped preloader
     never flashes the flat CSS stack. A watchdog restores it if the intro
     is somehow never invoked — an invisible hero is not an option. */
  let introRan = false;
  if (motionOK && plates.length) {
    gsap.set(plates, { opacity: 0, yPercent: 9, z: -320, rotateY: 0, xPercent: 0 });
    if (stageGlow) gsap.set(stageGlow, { opacity: 0 });
    window.setTimeout(() => {
      if (!introRan && plates.length) gsap.set(plates, stagePose);
    }, 4200);
  }

  /* ------------------------------------------------ hero intro */
  const buildIntro = () => {
    if (!motionOK || introRan) return;
    introRan = true;
    const chars = splitTitle($(".hero-title"));
    const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
    if (chars.length) tl.from(chars, { yPercent: 112, duration: 1.05, stagger: { each: 0.013 } }, 0.05);
    tl.from($$(".hero-copy [data-intro]"), { y: 18, opacity: 0, duration: 0.9, stagger: 0.08, ease: "power3.out" }, 0.32)
      .from($$(".bg-word"), { xPercent: (i) => (i ? 10 : -10), opacity: 0, duration: 1.5, ease: "power2.out" }, 0.08)
      .from($$(".hero-strip > div"), { y: 16, opacity: 0, stagger: 0.06, duration: 0.6, ease: "power2.out" }, 0.72)
      .from($(".scroll-cue"), { opacity: 0, duration: 0.6, ease: "none" }, 1.05);

    if (plates.length) {
      /* the dashboard rises first, the two wings swing out from behind it */
      tl.to(
        plates,
        {
          opacity: (i) => stagePose[i].opacity,
          xPercent: (i) => stagePose[i].xPercent,
          yPercent: (i) => stagePose[i].yPercent,
          rotateY: (i) => stagePose[i].rotateY,
          z: (i) => stagePose[i].z,
          zIndex: (i) => stagePose[i].zIndex,
          duration: 1.35,
          ease: "expo.out",
          stagger: { each: 0.1, from: "center" },
        },
        0.34,
      );
      if (stageGlow) tl.to(stageGlow, { opacity: 1, duration: 0.9, ease: "power2.out" }, 0.7);
      /* one rim-light sweep as the object settles */
      if (stageRim) {
        tl.fromTo(stageRim, { borderColor: "rgba(230,180,106,0)" }, { borderColor: "rgba(230,180,106,0.5)", duration: 0.4, ease: "power2.out" }, 1.0)
          .to(stageRim, { borderColor: "rgba(230,180,106,0)", duration: 0.9, ease: "power2.inOut" }, 1.4);
      }
    }
  };
  let introFn = buildIntro;

  /* ------------------------------------------------ preloader */
  /* Count and teardown are timer-driven on purpose: the overlay must
     never be stranded by a frozen animation ticker. Tweens only add
     the cosmetic exit. */
  const pre = $("[data-preloader]");
  if (pre) {
    const skip = reduce || !hasGsap || sessionStorage.getItem("tm-pre");
    if (skip) {
      pre.remove();
    } else {
      document.body.classList.add("is-loading");
      if (lenis) lenis.stop();
      const countEl = $("[data-pre-count]");
      const DURATION = 1050;
      const t0 = performance.now();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        sessionStorage.setItem("tm-pre", "1");
        if (motionOK) {
          gsap
            .timeline()
            .to(".pre-inner", { y: -16, opacity: 0, duration: 0.3, ease: "power2.in" })
            .to(pre, { clipPath: "inset(0 0 100% 0)", duration: 0.7, ease: "power4.inOut" }, "-=0.02");
        }
        window.setTimeout(
          () => {
            pre.remove();
            document.body.classList.remove("is-loading");
            if (lenis) lenis.start();
            introFn();
          },
          motionOK ? 880 : 0,
        );
      };
      const tick = window.setInterval(() => {
        const p = Math.min(1, (performance.now() - t0) / DURATION);
        const eased = 1 - Math.pow(1 - p, 3);
        if (countEl) countEl.textContent = String(Math.round(eased * 100)).padStart(3, "0");
        if (p >= 1) {
          window.clearInterval(tick);
          window.setTimeout(finish, 140);
        }
      }, 40);
      window.setTimeout(finish, 3600);
    }
  }

  /* ------------------------------------------------ section rail */
  const railLinks = $("[data-rail-nav]") ? $$("[data-rail-nav] a") : [];
  if (railLinks.length && hasGsap) {
    railLinks.forEach((a) => {
      const id = a.getAttribute("href");
      const el = id && $(id);
      if (!el) return;
      ScrollTrigger.create({
        trigger: el,
        start: "top center",
        end: "bottom center",
        onToggle: (self) => a.classList.toggle("is-active", self.isActive),
      });
    });
  }

  /* ------------------------------------------------ cinema helpers for small screens */
  const cinemaVideo = $("[data-cinema-video]");
  const cta = $("[data-cinema-sound]");
  if (cta) {
    cta.tabIndex = -1;
    cta.addEventListener("click", () => {
      TM.scrollTo("#thefilm");
      window.setTimeout(() => TM.playFilmWithSound && TM.playFilmWithSound(), 900);
    });
  }
  const hintEl = $("[data-cinema-hint]");
  if (hintEl) hintEl.tabIndex = -1;

  /* ================================================================ GSAP choreography */
  if (!hasGsap || reduce) {
    if (cinemaVideo) cinemaVideo.controls = true;
    if (cinemaVideo) cinemaVideo.preload = "metadata";
    return;
  }

  const noPref = "(prefers-reduced-motion: no-preference)";
  const mm = gsap.matchMedia();

  /* the preloader invokes the intro when it lifts; without one it runs now */
  if (!pre || sessionStorage.getItem("tm-pre")) window.setTimeout(() => introFn(), 60);

  /* ---------- motion allowed, any width ---------- */
  mm.add(param === "full" ? "all" : noPref, () => {
    /* generic reveals */
    $$("[data-reveal]").forEach((el) => {
      gsap.from(el, {
        y: 22,
        opacity: 0,
        duration: 0.7,
        ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 90%", once: true },
      });
    });

    /* grouped rows: table, install matrix */
    const rows = [
      [".table-wrap tbody tr", { y: 14, opacity: 0 }, ".table-wrap", "top 86%"],
      [".install-matrix > div", { x: 20, opacity: 0 }, ".install-matrix", "top 90%"],
    ];
    rows.forEach(([target, vars, trigger, start]) => {
      const els = $$(target);
      if (!els.length || !$(trigger)) return;
      gsap.from(els, {
        ...vars,
        duration: 0.62,
        stagger: 0.075,
        ease: "power3.out",
        scrollTrigger: { trigger, start, once: true },
      });
    });

    /* ---- Fig. 03: the journey wire draws itself, a marker rides it ---- */
    const wire = $("[data-wire-draw]");
    if (wire && wire.getTotalLength) {
      const len = wire.getTotalLength();
      wire.style.strokeDasharray = `${len} ${len}`;
      wire.style.strokeDashoffset = String(len);
      const marker = $("[data-wire-marker]");
      const nodes = $$("[data-node]");
      const NODE_AT = [0.015, 0.5, 0.985];
      if (marker) marker.style.opacity = "0";
      const p = { v: 0 };
      gsap.to(p, {
        v: 1,
        ease: "none",
        scrollTrigger: { trigger: ".how-wrap", start: "top 84%", end: "top 18%", scrub: 0.5 },
        onUpdate: () => {
          const t = p.v;
          wire.style.strokeDashoffset = String(len * (1 - t));
          if (marker) {
            const pt = wire.getPointAtLength(len * t);
            marker.setAttribute("cx", pt.x.toFixed(2));
            marker.setAttribute("cy", pt.y.toFixed(2));
            marker.style.opacity = t > 0.004 && t < 0.996 ? "0.9" : "0";
          }
          nodes.forEach((n, i) => n.classList.toggle("is-lit", t >= (NODE_AT[i] ?? 1)));
        },
      });
    }

    /* ledger odometers — integers only, exact final values */
    $$(".ledger b span[data-value]").forEach((el) => {
      const value = Number(el.dataset.value || 0);
      const unit = el.parentElement ? el.parentElement.querySelector(".unit") : null;
      ScrollTrigger.create({
        trigger: el,
        start: "top 86%",
        once: true,
        onEnter: () => {
          const obj = { v: 0 };
          gsap.to(obj, {
            v: value,
            duration: 1.25,
            ease: "power3.out",
            onUpdate: () => {
              el.textContent = Math.round(obj.v).toLocaleString("en-GB");
            },
          });
          if (unit) gsap.fromTo(unit, { opacity: 0 }, { opacity: 1, delay: 0.95, duration: 0.3 });
        },
      });
    });

    /* ---- marquee reacts to scroll velocity ---- */
    const track = $(".marquee-track");
    let marqueeFn = null;
    if (track && track.children.length >= 2) {
      const kids = track.children;
      const half = kids.length / 2;
      const seam = kids[half] ? kids[half].offsetLeft - kids[0].offsetLeft : track.scrollWidth / 2;
      if (seam > 40) {
        track.style.animation = "none";
        let x = 0;
        let last = performance.now();
        marqueeFn = () => {
          const now = performance.now();
          const dt = clamp(now - last, 0, 64) / 1000;
          last = now;
          x -= (30 + clamp(Math.abs(vel), 0, 34) * 9) * dt;
          vel *= 0.9;
          if (x <= -seam) x += seam;
          gsap.set(track, { x, force3D: true });
        };
        gsap.ticker.add(marqueeFn);
      }
    }

    return () => {
      if (marqueeFn) gsap.ticker.remove(marqueeFn);
    };
  });

  /* ---------- desktop: pins and scrubbed scenes ---------- */
  mm.add(param === "full" ? "(min-width: 1081px)" : `(min-width: 1081px) and ${noPref}`, () => {
    stagePose = POSE_WIDE;

    /* ================= SIGNATURE MOMENT 01 — hero pin =================
       The fan closes into one deck, the deck tilts away, the page hands
       over to the film. One continuous move, no cut. */
    if (stage && plates.length) {
      gsap.set(plates, { zIndex: (i) => POSE_WIDE[i].zIndex });
      const heroTl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: ".hero", start: "top top", end: "+=88%", scrub: 0.6, pin: true, anticipatePin: 1 },
      });
      /* close the fan */
      heroTl.to(
        plates,
        {
          xPercent: (i) => POSE_CLOSED[i].xPercent,
          yPercent: (i) => POSE_CLOSED[i].yPercent,
          rotateY: 0,
          z: (i) => POSE_CLOSED[i].z,
          opacity: 1,
          duration: 0.46,
          ease: "power2.inOut",
          stagger: { each: 0.03, from: "center" },
        },
        0,
      );
      /* the deck settles, then leaves */
      heroTl
        .to(stage, { rotateX: -5, scale: 1.05, duration: 0.3, ease: "power1.inOut" }, 0.46)
        .to(stage, { rotateX: 2, scale: 1.16, opacity: 0, duration: 0.24, ease: "power2.in" }, 0.76)
        .to(stageGlow, { opacity: 0, duration: 0.3 }, 0.7)
        .to(".hero-copy", { yPercent: -16, opacity: 0, duration: 0.62 }, 0.1)
        .to(".hero-strip", { opacity: 0, y: 20, duration: 0.34 }, 0)
        .to(".scroll-cue", { opacity: 0, duration: 0.18 }, 0)
        .to(".bg-tel", { yPercent: -24 }, 0)
        .to(".bg-mote", { yPercent: 16 }, 0);
    }

    /* ================= the cinema: the scrollbar is the playhead ================= */
    const cinema = $(".cinema");
    const cv = $("[data-cinema-video]");
    let tickerFn = null;
    if (cinema && cv) {
      const fill = $("[data-cinema-fill]");
      const tcEl = $("[data-hud-tc]");
      const chEl = $("[data-hud-ch]");
      const frameEl = $("[data-hud-frame]");
      const captionEl = $("[data-cinema-caption]");
      const hint = $("[data-cinema-hint]");
      const duration = () => (cv.duration && isFinite(cv.duration) ? cv.duration : FILM_DURATION);

      let target = 0;
      let current = -1;
      let chIdx = -1;
      let ctaShown = false;
      const fmtTC = (t) => {
        const s = Math.floor(t);
        const f = Math.floor((t - s) * 24);
        return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60, f]
          .map((v) => String(Math.max(0, v)).padStart(2, "0"))
          .join(":");
      };
      const cueAt = (t) => {
        const cues = TM.cues;
        if (!cues || !cues.length) return null;
        for (const c of cues) if (t >= c.start && t <= c.end) return c;
        return null;
      };
      const fallbackCaption = (ch) =>
        [
          "This is TellyMote. Your TV, on your desktop.",
          "A remote, and a live screen, on your own network.",
          "No account, no cloud relay, no telemetry.",
          "Android TV Remote v2, ADB, and Roku ECP.",
          "166 tests. Three protocols. Zero accounts.",
          "Free at github.com/NathanKSanal/tellymote.",
        ][ch] || "";

      tickerFn = () => {
        if (cv.readyState < 2) return;
        current = current < 0 ? target : current + (target - current) * 0.24;
        if (Math.abs(target - current) < 0.004) current = target;
        /* the HUD follows the intended playhead so it never lags the
           scroll; the video seeks toward it whenever the media pipeline
           is free (seeks are async and can trail under throttling) */
        const t = Math.min(Math.max(0, current), Math.max(0, duration() - 0.06));
        if (!cv.seeking && Math.abs(t - cv.currentTime) > 0.042) {
          try {
            cv.currentTime = t;
          } catch {
            /* seeking before metadata is ready */
          }
        }
        if (tcEl) tcEl.textContent = fmtTC(t);
        if (frameEl) frameEl.textContent = `F ${String(Math.round(t * 24)).padStart(4, "0")} / ${String(Math.round(duration() * 24)).padStart(4, "0")}`;
        if (fill) fill.style.width = `${(t / duration()) * 100}%`;
        const ch = Math.max(0, TM.chapters.filter((c) => t >= c).length - 1);
        if (ch !== chIdx) {
          chIdx = ch;
          if (chEl) chEl.textContent = `CH ${String(ch + 1).padStart(2, "0")} / 06`;
          if (captionEl) {
            const cue = cueAt(t);
            captionEl.textContent = cue ? cue.text : fallbackCaption(ch);
            gsap.fromTo(captionEl, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
          }
        } else if (captionEl && TM.cues) {
          const cue = cueAt(t);
          if (cue && captionEl.textContent !== cue.text) captionEl.textContent = cue.text;
        }
      };
      gsap.ticker.add(tickerFn);

      ScrollTrigger.create({
        trigger: cinema,
        start: "top top",
        end: "+=340%",
        pin: true,
        anticipatePin: 1,
        onUpdate: (self) => {
          target = self.progress * duration();
          if (hint) hint.hidden = self.progress > 0.05;
          const show = self.progress > 0.965;
          if (show !== ctaShown) {
            ctaShown = show;
            if (cta) cta.hidden = !show;
          }
        },
      });
    }

    /* ================= SIGNATURE MOMENT 02 — the remote experience ==========
       One sticky slot, three beats. The pad turns toward whichever control
       is being described, the key lights, and in the last beat real text
       arrives on the screen — typed, not hunted. */
    const remote = $(".remote");
    if (remote) {
      const pad = $("[data-pad]", remote);
      const keys = $$(".pad-key", remote);
      const steps = $$("[data-beat]", remote);
      const typeBox = $("[data-pad-type]", remote);
      const typedEl = $("[data-typed]", remote);
      const PHRASE = "tellymote";

      const tl = gsap.timeline({
        defaults: { ease: "power2.inOut" },
        scrollTrigger: { trigger: remote, start: "top top", end: "bottom bottom", scrub: 0.45 },
      });

      if (steps.length === 3) {
        gsap.set(steps, { opacity: 0, y: 18 });
        gsap.set(steps[0], { opacity: 1, y: 0 });
        tl.to(steps[0], { opacity: 0, y: -16, duration: 0.06 }, 0.3)
          .to(steps[1], { opacity: 1, y: 0, duration: 0.06 }, 0.32)
          .to(steps[1], { opacity: 0, y: -16, duration: 0.06 }, 0.64)
          .to(steps[2], { opacity: 1, y: 0, duration: 0.06 }, 0.66);
      }

      if (pad) {
        gsap.set(pad, { rotateY: -10, rotateX: 4, scale: 0.96 });
        tl.to(pad, { rotateY: -5, rotateX: 2, scale: 1, duration: 0.14 }, 0)
          .to(pad, { rotateY: 5, rotateX: 0, scale: 1.02, duration: 0.32 }, 0.3)
          .to(pad, { rotateY: 0, rotateX: 0, scale: 1.05, duration: 0.34 }, 0.64);
      }

      /* key presses: scroll-driven, so scrubbing backwards un-presses them */
      const press = (name, at, dur = 0.09) => {
        const el = keys.find((k) => k.dataset.key === name);
        if (!el) return;
        tl.to(el, { opacity: 1, scale: 1.05, duration: dur * 0.38, ease: "power2.out" }, at).to(
          el,
          { opacity: 0, scale: 1, duration: dur * 0.62, ease: "power2.in" },
          at + dur * 0.38,
        );
      };
      press("up", 0.07);
      press("up", 0.14);
      press("ok", 0.21);
      press("vol", 0.4);
      press("vol", 0.48);
      press("text", 0.74);

      /* typed text lands in the field */
      if (typeBox) {
        tl.to(typeBox, { opacity: 1, duration: 0.03 }, 0.73);
        if (typedEl) {
          const s = { n: 0 };
          tl.to(
            s,
            {
              n: PHRASE.length,
              duration: 0.2,
              ease: "none",
              onUpdate: () => {
                typedEl.textContent = PHRASE.slice(0, Math.round(s.n));
              },
            },
            0.75,
          );
        }
      }

      gsap.to(".remote-watermark", {
        yPercent: -16,
        ease: "none",
        scrollTrigger: { trigger: remote, start: "top bottom", end: "bottom top", scrub: 0.8 },
      });
    }

    /* ================= SIGNATURE MOMENT 03 — the live screen ==============
       The remote panel is where you start: small, tilted, controlling.
       It grows into the viewport and straightens, and as it does the
       remote is wiped away by the live screen underneath. The gesture
       from "operating the TV" to "watching the TV" is one move. */
    const screenSection = $(".screen-pin");
    const frame = $("[data-reveal-frame]");
    if (screenSection && frame) {
      const rfRemote = $(".rf-remote", frame);
      const scan = $(".scan", frame);
      const counter = $("[data-count]");
      const caption = $(".reveal-figure figcaption");
      const note = $(".center-note");

      gsap.set(frame, { rotateX: 8, rotateY: -7, scale: 0.86, y: 44 });
      if (scan) gsap.set(scan, { opacity: 0, top: "0%" });
      if (caption) gsap.set(caption, { opacity: 0, y: 10 });
      if (note) gsap.set(note, { opacity: 0, y: 12 });
      if (counter) counter.textContent = "0000";
      const wipe = { v: -20 };
      const frames = { v: 0 };

      const tl = gsap.timeline({
        scrollTrigger: { trigger: screenSection, start: "top top", end: "bottom bottom", scrub: 0.35 },
      });

      /* grow and straighten */
      tl.to(frame, { rotateX: 0, rotateY: 0, scale: 1, y: 0, duration: 0.36, ease: "power2.inOut" }, 0)
        .to(note, { opacity: 1, y: 0, duration: 0.12 }, 0.2)
        /* the transformation: mask wipe + scan sweep + frame count */
        .to(wipe, {
          v: 122,
          duration: 0.34,
          ease: "power2.inOut",
          onUpdate: () => {
            if (rfRemote) rfRemote.style.setProperty("--wipe", `${wipe.v}%`);
          },
        }, 0.36)
        .to(scan, { opacity: 1, duration: 0.04 }, 0.36)
        .to(scan, { top: "100%", duration: 0.34, ease: "power2.inOut" }, 0.36)
        .to(scan, { opacity: 0, duration: 0.05 }, 0.68)
        /* settle: the screen now owns the frame */
        .to(frame, { scale: 1.035, y: -8, duration: 0.3, ease: "power1.inOut" }, 0.7)
        .to(caption, { opacity: 1, y: 0, duration: 0.12 }, 0.78);

      tl.to(
        frames,
        {
          v: 720,
          duration: 1,
          ease: "none",
          onUpdate: () => {
            if (counter) counter.textContent = String(Math.round(frames.v)).padStart(4, "0");
          },
        },
        0,
      );
    }

    /* ================= protocols: the network diagram, then the rail ======= */
    const protocols = $(".protocols");
    const netWires = $$("[data-wire]");
    const netPorts = $$("[data-port]");
    if (protocols && netWires.length) {
      const meta = netWires.map((el) => {
        const l = el.getTotalLength ? el.getTotalLength() : 0;
        if (l) {
          el.style.strokeDasharray = `${l} ${l}`;
          el.style.strokeDashoffset = String(l);
        }
        return { el, l };
      });
      const p = { v: 0 };
      gsap.to(p, {
        v: 1,
        ease: "none",
        /* measured from the pin start so the drawing cannot be frozen
           mid-way by the pin that follows it */
        scrollTrigger: { trigger: protocols, start: "top top", end: "+=24%", scrub: 0.4 },
        onUpdate: () => {
          meta.forEach((m, i) => {
            const a = i * 0.26;
            const b = a + 0.44;
            const q = clamp((p.v - a) / (b - a), 0, 1);
            if (m.l) m.el.style.strokeDashoffset = String(m.l * (1 - q));
            m.el.classList.toggle("is-live", q > 0.02);
            const port = netPorts[i];
            if (port) port.style.opacity = String(clamp((q - 0.5) / 0.5, 0, 1));
          });
        },
      });
    }

    const railTrack = $("[data-protos]");
    if (protocols && railTrack) {
      const distance = () => Math.max(0, railTrack.scrollWidth - window.innerWidth + 40);
      if (distance() >= 140) {
        gsap.to(railTrack, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: protocols,
            start: "top top",
            end: () => `+=${distance() + window.innerHeight * 0.35}`,
            pin: ".protocols-pin",
            pinSpacing: true,
            scrub: 0.4,
            invalidateOnRefresh: true,
            anticipatePin: 1,
          },
        });
      }
    }

    return () => {
      if (tickerFn) gsap.ticker.remove(tickerFn);
    };
  });

  /* ---------- small screens: no pins, the cinema becomes a plain video ------- */
  mm.add(param === "full" ? "(max-width: 1080px)" : `(max-width: 1080px) and ${noPref}`, () => {
    stagePose = POSE_NARROW;
    if (introRan && plates.length) gsap.set(plates, POSE_NARROW);

    const v = $("[data-cinema-video]");
    if (v) v.controls = true;

    /* a light departure for the stage — no pinning on touch */
    if (stage && plates.length) {
      gsap.to(stage, {
        yPercent: -8,
        opacity: 0.55,
        ease: "none",
        scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.6 },
      });
    }
    /* the transformation still reads as a wipe, just unscrubbed */
    const frame = $("[data-reveal-frame]");
    const rfRemote = frame ? $(".rf-remote", frame) : null;
    if (frame && rfRemote) {
      const w = { v: -20 };
      gsap.to(w, {
        v: 122,
        ease: "none",
        scrollTrigger: { trigger: frame, start: "top 78%", end: "top 22%", scrub: 0.5 },
        onUpdate: () => rfRemote.style.setProperty("--wipe", `${w.v}%`),
      });
    }

    /* the beats still light their keys — nearest beat to the viewport
       centre wins, so two highlights never overlap on a short screen */
    const remoteBox = $(".remote");
    if (remoteBox) {
      const keys = $$(".pad-key", remoteBox);
      const typeBox = $("[data-pad-type]", remoteBox);
      const typedEl = $("[data-typed]", remoteBox);
      const BEAT_KEYS = [["up", "ok"], ["vol"], ["text"]];
      const beats = $$("[data-beat]", remoteBox);
      const groups = BEAT_KEYS.map((names) =>
        names.map((n) => keys.find((k) => k.dataset.key === n)).filter(Boolean),
      );
      let active = -1;
      const setActive = (i) => {
        if (i === active) return;
        active = i;
        groups.forEach((els, j) => els.forEach((el) => gsap.to(el, { opacity: j === i ? 1 : 0, duration: 0.3 })));
        if (typeBox) typeBox.style.opacity = i === 2 ? "1" : "0";
        if (typedEl) typedEl.textContent = i === 2 ? "tellymote" : "";
      };
      ScrollTrigger.create({
        trigger: remoteBox,
        start: "top bottom",
        end: "bottom top",
        onUpdate: () => {
          const mid = innerHeight * 0.5;
          let best = -1;
          let bestD = Infinity;
          beats.forEach((b, i) => {
            const r = b.getBoundingClientRect();
            if (r.bottom < 0 || r.top > innerHeight) return;
            const d = Math.abs((r.top + r.bottom) / 2 - mid);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          setActive(best);
        },
        onLeave: () => setActive(-1),
        onLeaveBack: () => setActive(-1),
      });
    }

    return () => {
      if (v) v.controls = false;
    };
  });

  window.addEventListener("load", () => ScrollTrigger.refresh());
  window.setTimeout(() => ScrollTrigger.refresh(), 800);
})();
