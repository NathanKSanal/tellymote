/* TellyMote landing — scroll choreography.
   Motion only runs when the visitor has not asked for reduced motion.
   Everything is visible without JS; GSAP only moves what is already there. */
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  /* ---------------- rail: progress + active node ---------------- */
  const rail = $(".rail");
  const railFill = $(".rail-fill");

  function initRail() {
    if (!rail) return;
    const links = $$(".rail a", rail);
    const sections = links.map((a) => document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean);

    const setActive = (id) => {
      links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === `#${id}`));
    };

    sections.forEach((section) => {
      ScrollTrigger.create({
        trigger: section,
        start: "top 55%",
        end: "bottom 45%",
        onEnter: () => setActive(section.id),
        onEnterBack: () => setActive(section.id),
      });
    });

    ScrollTrigger.create({
      start: 0,
      end: "max",
      onUpdate: (self) => {
        if (railFill) railFill.style.setProperty("--progress", `${(self.progress * 100).toFixed(2)}%`);
      },
    });
  }

  /* ---------------- hero ---------------- */
  function initHero() {
    const lines = $$(".hero h1 .line > span");
    const frame = $(".hero-frame");
    const hero = $(".hero");
    if (!hero || !frame) return;

    gsap.to(lines, {
      yPercent: -105,
      opacity: 0.15,
      ease: "none",
      stagger: 0.03,
      scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: true },
    });

    gsap.fromTo(
      frame,
      { rotateY: -9, rotateX: 5, y: 0, scale: 1 },
      {
        rotateY: 0,
        rotateX: 0,
        y: -40,
        scale: 1.06,
        ease: "none",
        scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6 },
      },
    );

    gsap.to(".chip-float", {
      y: (i) => -18 - i * 10,
      ease: "none",
      scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 1 },
    });

    gsap.to(".glow", {
      y: 260,
      x: -80,
      ease: "none",
      scrollTrigger: { start: 0, end: "max", scrub: 1.2 },
    });

    // Pointer parallax: small, cheap, and off for touch/reduced-motion.
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const setRX = gsap.quickTo(frame, "rotateX", { duration: 0.6, ease: "power3.out" });
      const setRY = gsap.quickTo(frame, "rotateY", { duration: 0.6, ease: "power3.out" });
      hero.addEventListener("pointermove", (e) => {
        const r = hero.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        setRY(px * 7);
        setRX(-py * 5);
      });
      hero.addEventListener("pointerleave", () => {
        setRY(0);
        setRX(0);
      });
    }
  }

  /* ---------------- remote: steps + key press ---------------- */
  function initRemote() {
    const section = $(".remote");
    if (!section) return;
    const steps = $$(".step", section);
    const keys = $$(".pad-key", section);
    const pad = $(".pad-img", section);

    gsap.set(steps, { opacity: 0, y: 18 });
    gsap.set(steps[0], { opacity: 1, y: 0 });

    const tl = gsap.timeline({
      defaults: { ease: "power2.inOut" },
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.5,
      },
    });

    tl.to(steps[0], { opacity: 0, y: -16, duration: 0.1, ease: "power2.in" }, 0.26)
      .to(steps[1], { opacity: 1, y: 0, duration: 0.1, ease: "power2.out" }, 0.28)
      .to(steps[1], { opacity: 0, y: -16, duration: 0.1, ease: "power2.in" }, 0.62)
      .to(steps[2], { opacity: 1, y: 0, duration: 0.1, ease: "power2.out" }, 0.64);

    // each key "presses" at a different point in the scroll
    const press = (key, at, size = 1) => {
      const el = keys.find((k) => k.dataset.key === key);
      if (!el) return;
      tl.fromTo(el, { opacity: 0, scale: 0.82 }, { opacity: 1, scale: size, duration: 0.08 }, at)
        .to(el, { opacity: 0.15, scale: size * 0.98, duration: 0.1 }, at + 0.1);
    };
    press("up", 0.08);
    press("ok", 0.36);
    press("back", 0.66);

    gsap.to(pad, {
      scale: 1.035,
      ease: "none",
      scrollTrigger: { trigger: section, start: "top top", end: "bottom bottom", scrub: 0.8 },
    });
  }

  /* ---------------- screen reveal ---------------- */
  function initScreen() {
    const section = $(".screen-pin");
    const frame = $(".reveal-frame");
    const badge = $(".frame-count");
    const scan = $(".scan");
    const caption = $(".reveal-caption");
    if (!section || !frame) return;

    // Opened by default for no-JS; here we close it so the scroll can open it.
    gsap.set(frame, { clipPath: "inset(50% 0% 50% 0% round 16px)" });
    if (scan) gsap.set(scan, { opacity: 0, top: "0%" });
    if (caption) gsap.set(caption, { opacity: 0 });

    const tl = gsap.timeline({
      scrollTrigger: { trigger: section, start: "top top", end: "bottom bottom", scrub: 0.35 },
    });

    tl.to(frame, { clipPath: "inset(0% 0% 0% 0% round 16px)", duration: 0.55, ease: "power2.inOut" })
      .to(frame, { scale: 1.025, duration: 0.45, ease: "none" }, 0.55)
      .to(scan, { opacity: 1, duration: 0.06 }, 0)
      .to(scan, { top: "100%", duration: 0.55, ease: "power1.inOut" }, 0)
      .to(scan, { opacity: 0, duration: 0.08 }, 0.5)
      .to(caption, { opacity: 1, duration: 0.12 }, 0.45);

    if (badge) {
      const counter = { v: 0 };
      tl.to(
        counter,
        {
          v: 1280,
          duration: 0.55,
          ease: "power1.inOut",
          onUpdate: () => {
            badge.textContent = String(Math.round(counter.v)).padStart(4, "0");
          },
        },
        0,
      );
    }
  }

  /* ---------------- protocols: horizontal rail ---------------- */
  function initProtocols() {
    const section = $(".protocols");
    const railEl = $(".h-rail");
    if (!section || !railEl) return;

    const distance = () => Math.max(0, railEl.scrollWidth - window.innerWidth + 80);

    gsap.to(railEl, {
      x: () => -distance(),
      ease: "none",
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: () => `+=${distance() + window.innerHeight * 0.4}`,
        pin: true,
        scrub: 0.4,
        invalidateOnRefresh: true,
        anticipatePin: 1,
      },
    });
  }

  /* ---------------- numbers ---------------- */
  function initNumbers() {
    $$(".num b").forEach((el) => {
      const target = Number(el.dataset.value || 0);
      const suffix = el.dataset.suffix || "";
      const prefix = el.dataset.prefix || "";
      const format = (v) => `${prefix}${Math.round(v).toLocaleString("en-GB")}${suffix}`;
      el.textContent = format(target);

      const proxy = { v: 0 };
      ScrollTrigger.create({
        trigger: el,
        start: "top 85%",
        once: true,
        onEnter: () =>
          gsap.to(proxy, {
            v: target,
            duration: 1.4,
            ease: "power2.out",
            onUpdate: () => {
              el.textContent = format(proxy.v);
            },
          }),
      });
    });
  }

  /* ---------------- reveals ---------------- */
  function initReveals() {
    gsap.utils.toArray(".reveal").forEach((el) => {
      gsap.from(el, {
        y: 26,
        opacity: 0,
        duration: 0.7,
        ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      });
    });

    gsap.utils.toArray(".compare tbody tr").forEach((row, i) => {
      gsap.from(row, {
        opacity: 0,
        x: -12,
        duration: 0.45,
        delay: i * 0.05,
        ease: "power2.out",
        scrollTrigger: { trigger: row, start: "top 92%", once: true },
      });
    });
  }

  function boot() {
    if (!hasGsap) return;
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    initRail();
    initHero();
    const wide = window.matchMedia("(min-width: 1081px)").matches;
    if (wide) {
      initRemote();
      initScreen();
      initProtocols();
    } else {
      // Sticky choreography is off on narrow screens: show everything at once.
      gsap.set(".step", { opacity: 1, y: 0 });
      gsap.set(".reveal-frame", { clipPath: "none" });
      gsap.set(".reveal-caption", { opacity: 1 });
    }
    initNumbers();
    initReveals();

    // Images change layout height; recalculate once they are in.
    window.addEventListener("load", () => ScrollTrigger.refresh());
    setTimeout(() => ScrollTrigger.refresh(), 600);
  }

  if (reduce || !hasGsap) {
    // Reduced motion: keep the page fully readable, no pinning, no scrubbing.
    document.documentElement.classList.add("no-motion");
    $$(".reveal-frame").forEach((f) => (f.style.clipPath = "none"));
    if (hasGsap) {
      // Fades only (Tier 2/3): no displacement.
      gsap.utils.toArray(".reveal").forEach((el) => {
        gsap.from(el, {
          opacity: 0,
          duration: 0.3,
          scrollTrigger: { trigger: el, start: "top 92%", once: true },
        });
      });
    }
    return;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
