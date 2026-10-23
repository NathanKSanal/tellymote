/* Film layer: scroll drives the narration.
   One clip per chapter, cross-faded; captions always visible; nothing plays until asked. */
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SECTION_IDS = ["top", "remote", "screen", "protocols", "numbers", "compare", "download"];
  const STORAGE_KEY = "tellymote-sound";

  const gate = document.getElementById("gate");
  const hud = document.getElementById("film-hud");
  const hudPlay = document.getElementById("hud-play");
  const hudMute = document.getElementById("hud-mute");
  const hudChapter = document.getElementById("hud-chapter");
  const hudTime = document.getElementById("hud-time");
  const hudFill = document.getElementById("hud-fill");
  const caption = document.getElementById("caption");
  const captionText = caption ? caption.querySelector("span") : null;
  const startBtn = document.getElementById("gate-start");
  const silentBtn = document.getElementById("gate-silent");

  let manifest = [];
  let clips = [];
  let current = -1;
  let enabled = false;
  let muted = false;
  let started = false;
  let pendingPlay = 0;
  let flash = null;
  const pendingGesture = { value: false };

  const fmt = (s) => {
    const v = Math.max(0, Math.round(s || 0));
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
  };

  flash = document.createElement("div");
  flash.className = "chapter-flash";
  flash.setAttribute("aria-hidden", "true");
  document.body.appendChild(flash);

  const progress = document.createElement("div");
  progress.className = "scroll-progress";
  progress.setAttribute("aria-hidden", "true");
  document.body.appendChild(progress);

  /* ---------- audio ---------- */
  const fade = (audio, to, ms = 260) => {
    const from = audio.volume;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      audio.volume = Math.min(1, Math.max(0, from + (to - from) * t));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const stopClip = (audio, hard = false) => {
    if (!audio) return;
    fade(audio, 0, 200);
    setTimeout(() => {
      if (audio.volume <= 0.02) {
        audio.pause();
        if (hard) audio.currentTime = 0;
      }
    }, 220);
  };

  const setHud = (index) => {
    if (!manifest[index]) return;
    const item = manifest[index];
    if (hudChapter) hudChapter.textContent = `${String(index + 1).padStart(2, "0")} · ${title(item.chapter)}`;
    if (captionText) captionText.textContent = item.text;
    if (caption) caption.classList.add("is-on");
    if (hudTime) hudTime.textContent = `0:00 / ${fmt(item.seconds)}`;
    if (hudFill) hudFill.style.width = "0%";
    if (hud) hud.classList.add("is-on");
  };

  function title(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  const playIndex = (index) => {
    if (!enabled || index < 0 || !clips[index]) return;
    if (current === index && !clips[index].paused) return;
    clips.forEach((clip, i) => {
      if (i !== index && !clip.paused) stopClip(clip);
    });
    const clip = clips[index];
    clip.currentTime = 0;
    clip.volume = 0;
    clip.muted = muted;
    const p = clip.play();
    if (p && typeof p.catch === "function") p.catch(() => undefined);
    fade(clip, muted ? 0 : 0.9, 320);
    if (hud) {
      hud.classList.add("is-playing");
      hudPlay.querySelector(".hud-icon").textContent = "❚❚";
      hudPlay.setAttribute("aria-label", "Pause narration");
    }
  };

  const pauseAll = () => {
    window.clearTimeout(pendingPlay);
    clips.forEach((clip) => {
      if (!clip.paused) stopClip(clip, true);
    });
    if (hud) {
      hud.classList.remove("is-playing");
      hudPlay.querySelector(".hud-icon").textContent = "▶";
      hudPlay.setAttribute("aria-label", "Play narration");
    }
  };

  const setChapter = (index) => {
    if (index === current) return;
    current = index;
    setHud(index);
    if (flash && started) {
      flash.animate([{ opacity: 0 }, { opacity: 0.14 }, { opacity: 0 }], {
        duration: 460,
        easing: "ease-in-out",
      });
    }
    window.clearTimeout(pendingPlay);
    if (enabled) {
      pendingPlay = window.setTimeout(() => playIndex(current), 240);
    }
  };


  const detectChapter = () => {
    const mark = window.innerHeight * 0.55;
    let index = 0;
    SECTION_IDS.forEach((id, i) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.getBoundingClientRect().top <= mark) index = i;
    });
    return index;
  };

  /* ---------- chapters from scroll ---------- */
  const wireChapters = () => {
    SECTION_IDS.forEach((id, index) => {
      const section = document.getElementById(id);
      if (!section || !window.ScrollTrigger) return;
      ScrollTrigger.create({
        trigger: section,
        start: "top 55%",
        end: "bottom 45%",
        onEnter: () => setChapter(index),
        onEnterBack: () => setChapter(index),
      });
    });

    if (window.ScrollTrigger) {
      ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: (self) => {
          progress.style.setProperty("--film-progress", `${(self.progress * 100).toFixed(2)}%`);
          progress.style.width = `${(self.progress * 100).toFixed(2)}%`;
        },
      });
    }
  };

  /* ---------- controls ---------- */
  const start = (withSound) => {
    enabled = withSound && clips.length > 0;
    started = true;
    try {
      localStorage.setItem(STORAGE_KEY, withSound ? "on" : "off");
    } catch {
      /* private mode */
    }
    if (gate) {
      gate.classList.add("is-leaving");
      setTimeout(() => gate.setAttribute("hidden", ""), 400);
    }
    current = detectChapter();
    setChapter(current);
    if (enabled) playIndex(current);
    else if (hud) hud.classList.add("is-on");
  };

  if (startBtn) startBtn.addEventListener("click", () => start(true));
  if (silentBtn) silentBtn.addEventListener("click", () => start(false));

  if (hudPlay)
    hudPlay.addEventListener("click", () => {
      if (!enabled) return;
      const clip = clips[current];
      if (!clip) return;
      if (clip.paused) playIndex(current);
      else pauseAll();
    });

  const setMuted = (value) => {
    muted = value;
    clips.forEach((clip) => {
      clip.muted = muted;
      if (!clip.paused) clip.volume = muted ? 0 : 0.9;
    });
    if (hudMute) {
      hudMute.textContent = muted ? "Unmute" : "Mute";
      hudMute.setAttribute("aria-pressed", muted ? "true" : "false");
    }
  };
  if (hudMute) hudMute.addEventListener("click", () => setMuted(!muted));

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseAll();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "m" || event.key === "M") {
      if (!started) return;
      setMuted(!muted);
    }
  });

  /* ---------- boot ---------- */
  const load = async () => {
    try {
      const response = await fetch("site/audio/manifest.json", { cache: "force-cache" });
      if (!response.ok) throw new Error(String(response.status));
      manifest = await response.json();
    } catch {
      // No narration available: the page stays fully usable and silent.
      if (gate) gate.setAttribute("hidden", "");
      return;
    }

    clips = manifest.map((item) => {
      const audio = new Audio(`site/audio/${item.file}`);
      audio.preload = "auto";
      audio.volume = 0;
      audio.addEventListener("timeupdate", () => {
        if (!enabled || current < 0) return;
        const idx = clips.indexOf(audio);
        if (idx !== current) return;
        const item = manifest[idx];
        if (hudFill) hudFill.style.width = `${Math.min(100, (audio.currentTime / (item.seconds || 1)) * 100).toFixed(1)}%`;
        if (hudTime) hudTime.textContent = `${fmt(audio.currentTime)} / ${fmt(item.seconds)}`;
      });
      audio.addEventListener("ended", () => {
        if (clips.indexOf(audio) !== current) return;
        if (hud) {
          hud.classList.remove("is-playing");
          hudPlay.querySelector(".hud-icon").textContent = "▶";
        }
      });
      return audio;
    });

    wireChapters();

    let stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }

    if (stored === "on") {
      // Returning visitor: sound is wanted, but a gesture is still required by the browser.
      enabled = true;
      started = true;
      if (gate) gate.setAttribute("hidden", "");
      pendingGesture.value = true;
      const unlock = () => {
        pendingGesture.value = false;
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
        window.removeEventListener("wheel", unlock, { passive: true });
        playIndex(current >= 0 ? current : 0);
      };
      window.addEventListener("pointerdown", unlock, { once: true });
      window.addEventListener("keydown", unlock, { once: true });
      window.addEventListener("wheel", unlock, { once: true, passive: true });
    } else if (stored === "off") {
      started = true;
      if (gate) gate.setAttribute("hidden", "");
    }

    if (startBtn) startBtn.focus({ preventScroll: true });
    if (hud) hud.classList.add("is-visible");
  };

  window.__film = {
    state: () => ({
      enabled,
      muted,
      started,
      current,
      chapter: manifest[current] ? manifest[current].chapter : null,
      playing: clips[current] ? !clips[current].paused : false,
      time: clips[current] ? Number(clips[current].currentTime.toFixed(2)) : 0,
      duration: manifest[current] ? manifest[current].seconds : 0,
      loaded: clips.length,
    }),
  };

  if (reduce) {
    // No motion tier changes here: audio is user-initiated and captions are always shown.
    document.documentElement.classList.add("film-reduced");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load, { once: true });
  } else {
    load();
  }
})();
