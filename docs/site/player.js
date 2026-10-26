/* TellyMote film player: custom transport, chapters, captions,
   transcript sync, the muted hero loop, and the lazy tour video.
   Functional without GSAP; only the small caption fades need motion. */
(() => {
  "use strict";

  const TM = window.TM || { reduce: false };
  const film = document.getElementById("film-video");
  const player = document.getElementById("player");
  const heroVideo = document.querySelector(".hero-video");
  if (!film || !player) return;

  const poster = player.querySelector(".poster-play");
  const playBtn = player.querySelector(".player-controls [data-play]");
  const icon = player.querySelector("[data-icon]");
  const seek = player.querySelector("[data-seek]");
  const fill = player.querySelector("[data-fill]");
  const time = player.querySelector("[data-time]");
  const muteBtn = player.querySelector("[data-mute]");
  const muteIcon = player.querySelector("[data-mute-icon]");
  const ccBtn = player.querySelector("[data-captions]");
  const fsBtn = player.querySelector("[data-fullscreen]");
  const chapterButtons = Array.from(document.querySelectorAll("[data-chapter]"));
  const transcriptItems = Array.from(document.querySelectorAll(".transcript li[data-t]"));
  const captionTrack = film.textTracks && film.textTracks[0];
  /* markup ships with native controls for no-JS visitors; the custom
     transport takes over once this script is alive */
  film.controls = false;

  const fmt = (s) => {
    const v = Math.max(0, Math.floor(s || 0));
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
  };
  const fadeCaption = (el, text) => {
    el.textContent = text;
    if (window.gsap && !TM.reduce) {
      gsap.fromTo(el, { opacity: 0.4 }, { opacity: 1, duration: 0.3, ease: "power2.out" });
    }
  };

  const setPlayIcon = () => {
    const playing = !film.paused && !film.ended;
    icon.textContent = playing ? "❚❚" : "▶";
    playBtn.setAttribute("aria-label", playing ? "Pause film" : "Play film");
  };
  const setMuteIcon = () => {
    muteIcon.textContent = film.muted ? "UNMUTE" : "MUTE";
    muteBtn.setAttribute("aria-label", film.muted ? "Unmute film" : "Mute film");
  };

  const paint = () => {
    const duration = film.duration || 30;
    const pct = Math.min(100, (film.currentTime / duration) * 100);
    fill.style.width = `${pct}%`;
    seek.setAttribute("aria-valuenow", String(Math.round(film.currentTime)));
    time.textContent = `${fmt(film.currentTime)} / ${fmt(duration)}`;
    chapterButtons.forEach((b) => {
      const at = Number(b.dataset.chapter);
      const next = chapterButtons
        .map((x) => Number(x.dataset.chapter))
        .filter((v) => v > at)
        .sort((a, b2) => a - b2)[0];
      const current = film.currentTime >= at && (next === undefined || film.currentTime < next);
      b.classList.toggle("is-current", current);
    });
    /* transcript sync */
    let active = -1;
    transcriptItems.forEach((li, i) => {
      const t = Number(li.dataset.t);
      const nextT = transcriptItems[i + 1] ? Number(transcriptItems[i + 1].dataset.t) : Infinity;
      if (film.currentTime >= t && film.currentTime < nextT) active = i;
    });
    transcriptItems.forEach((li, i) => li.classList.toggle("is-active", i === active));
  };

  const play = () => {
    const p = film.play();
    if (p && p.catch) p.catch(() => undefined);
    if (heroVideo) heroVideo.pause();
  };
  const pause = () => film.pause();

  TM.playFilmWithSound = () => {
    if (poster) poster.hidden = true;
    film.muted = false;
    setMuteIcon();
    film.currentTime = 0;
    play();
  };

  const hidePoster = () => {
    if (poster) poster.hidden = true;
  };
  if (poster) {
    poster.addEventListener("click", () => {
      hidePoster();
      film.muted = false;
      setMuteIcon();
      play();
    });
  }

  playBtn.addEventListener("click", () => {
    hidePoster();
    if (film.paused) play();
    else pause();
  });
  film.addEventListener("play", setPlayIcon);
  film.addEventListener("pause", setPlayIcon);
  film.addEventListener("timeupdate", paint);
  film.addEventListener("play", hidePoster);
  film.addEventListener("loadedmetadata", paint);
  film.addEventListener("click", () => (film.paused ? play() : pause()));

  /* seeking: click, drag, keyboard */
  const seekTo = (clientX) => {
    const rect = seek.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    film.currentTime = ratio * (film.duration || 30);
    paint();
  };
  let dragging = false;
  seek.addEventListener("pointerdown", (e) => {
    dragging = true;
    seek.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  });
  seek.addEventListener("pointermove", (e) => {
    if (dragging) seekTo(e.clientX);
  });
  seek.addEventListener("pointerup", () => {
    dragging = false;
  });
  seek.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowRight") {
      film.currentTime = Math.min(film.duration || 30, film.currentTime + step);
      e.preventDefault();
      paint();
    }
    if (e.key === "ArrowLeft") {
      film.currentTime = Math.max(0, film.currentTime - step);
      e.preventDefault();
      paint();
    }
  });

  muteBtn.addEventListener("click", () => {
    film.muted = !film.muted;
    setMuteIcon();
  });

  if (captionTrack) {
    ccBtn.addEventListener("click", () => {
      const on = captionTrack.mode === "showing";
      captionTrack.mode = on ? "hidden" : "showing";
      ccBtn.setAttribute("aria-pressed", String(!on));
    });
  } else {
    ccBtn.hidden = true;
  }

  fsBtn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (player.requestFullscreen) player.requestFullscreen();
  });

  chapterButtons.forEach((b) => {
    b.addEventListener("click", () => {
      hidePoster();
      film.currentTime = Number(b.dataset.chapter);
      film.muted = false;
      setMuteIcon();
      play();
    });
  });

  /* transcript lines seek on click */
  transcriptItems.forEach((li) => {
    li.addEventListener("click", () => {
      hidePoster();
      film.currentTime = Number(li.dataset.t);
      paint();
      player.scrollIntoView({ block: "nearest", behavior: TM.reduce ? "auto" : "smooth" });
    });
  });

  /* hero: the film stays quiet until asked */
  const heroToggle = document.querySelector(".sound-toggle");
  const openFilm = () => {
    if (TM.scrollTo) TM.scrollTo("#thefilm");
    else document.getElementById("thefilm")?.scrollIntoView();
    window.setTimeout(() => TM.playFilmWithSound(), 700);
  };
  [heroToggle, ...document.querySelectorAll("[data-open-film]")].forEach((el) => {
    if (el) el.addEventListener("click", openFilm);
  });

  if (heroVideo) {
    const SEGMENT_IN = 12.2;
    const SEGMENT_OUT = 18.6;
    heroVideo.addEventListener("loadedmetadata", () => {
      if (heroVideo.currentTime < SEGMENT_IN) heroVideo.currentTime = SEGMENT_IN;
    });
    heroVideo.addEventListener("timeupdate", () => {
      if (heroVideo.currentTime >= SEGMENT_OUT) heroVideo.currentTime = SEGMENT_IN;
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !TM.reduce) {
            const p = heroVideo.play();
            if (p && p.catch) p.catch(() => undefined);
          } else {
            heroVideo.pause();
          }
        });
      },
      { threshold: 0.15 },
    );
    io.observe(heroVideo);
    if (TM.reduce) {
      heroVideo.autoplay = false;
      heroVideo.removeAttribute("autoplay");
      heroVideo.pause();
    }
  }

  /* the 47s tour: only load when it is near the viewport */
  const promo = document.querySelector(".promo video");
  if (promo) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            promo.preload = "auto";
            io.disconnect();
          }
        });
      },
      { rootMargin: "400px" },
    );
    io.observe(promo);
  }

  setPlayIcon();
  setMuteIcon();
  paint();
})();
