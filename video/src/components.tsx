import React from "react";
import { spring, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

export const PALETTE = {
  bg: "#0b0c0f",
  surface: "#111318",
  line: "#23262e",
  ink: "#e7e9ee",
  muted: "#9aa1ac",
  faint: "#6d7480",
  accent: "#e0ad63",
  accentInk: "#1a1308",
};

const DISPLAY = 'Bahnschrift, "Segoe UI Variable Display", "Segoe UI", sans-serif';
const TEXT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

/** Opacity + offset driven by a spring, for entrance motion. */
export function useEnter(delay = 0, damping = 200, stiffness = 120) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping, stiffness, mass: 0.8 } });
  return {
    progress: s,
    opacity: interpolate(s, [0, 1], [0, 1], { extrapolateRight: "clamp" }),
    y: interpolate(s, [0, 1], [42, 0], { extrapolateRight: "clamp" }),
    scale: interpolate(s, [0, 1], [0.97, 1], { extrapolateRight: "clamp" }),
  };
}

/** Word-by-word mask reveal for display type. */
export const WordReveal: React.FC<{
  text: string;
  delay?: number;
  stagger?: number;
  style?: React.CSSProperties;
  accentWords?: number[];
}> = ({ text, delay = 0, stagger = 3, style, accentWords = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  return (
    <span style={{ display: "inline-block", ...style }}>
      {words.map((word, i) => {
        const s = spring({
          frame: frame - delay - i * stagger,
          fps,
          config: { damping: 200, stiffness: 110, mass: 0.9 },
        });
        const accent = accentWords.includes(i);
        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: "inline-block",
              overflow: "hidden",
              verticalAlign: "bottom",
              marginRight: "0.26em",
            }}
          >
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - s) * 105}%)`,
                opacity: s,
                color: accent ? PALETTE.accent : undefined,
              }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </span>
  );
};

/** Animated accent rule that draws itself. */
export const DrawRule: React.FC<{ delay?: number; width?: number; height?: number }> = ({
  delay = 0,
  width = 96,
  height = 3,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200, stiffness: 90 } });
  return (
    <div
      style={{
        width: width * s,
        height,
        background: PALETTE.accent,
        borderRadius: height,
      }}
    />
  );
};

/** Screenshot card that wipes in from the right with a slow drift afterwards. */
export const ShotCard: React.FC<{
  src: string;
  delay?: number;
  width?: number;
  style?: React.CSSProperties;
}> = ({ src, delay = 0, width = 1150, style }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const wipe = spring({ frame: frame - delay, fps, config: { damping: 26, stiffness: 60, mass: 1.1 } });
  const drift = interpolate(frame, [0, durationInFrames], [0, 22], { extrapolateRight: "clamp" });
  const lift = interpolate(wipe, [0, 1], [70, 0]);
  return (
    <div
      style={{
        width,
        borderRadius: 18,
        overflow: "hidden",
        border: `1px solid ${PALETTE.line}`,
        boxShadow: "0 50px 120px rgba(0,0,0,0.65)",
        clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0 round 18px)`,
        transform: `translateY(${lift - drift * 0.4}px) scale(${interpolate(wipe, [0, 1], [0.985, 1])})`,
        background: PALETTE.surface,
        ...style,
      }}
    >
      <img src={src} style={{ display: "block", width: "100%", height: "auto" }} />
    </div>
  );
};

/** Small labelled pill. */
export const Pill: React.FC<{ label: string; delay?: number }> = ({ label, delay = 0 }) => {
  const { opacity, y } = useEnter(delay, 200, 140);
  return (
    <div
      style={{
        border: `1px solid ${PALETTE.line}`,
        background: "rgba(17,19,24,0.85)",
        borderRadius: 8,
        padding: "12px 18px",
        fontSize: 20,
        color: PALETTE.muted,
        fontFamily: TEXT,
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      {label}
    </div>
  );
};

/** Soft drifting background glow + faint grid, shared by every scene. */
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;
  return (
    <div style={{ position: "absolute", inset: 0, background: PALETTE.bg, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: 1500,
          height: 1500,
          borderRadius: "50%",
          left: 900 + Math.sin(t * 6.28) * 90,
          top: -700 + Math.cos(t * 5) * 50,
          background: "radial-gradient(circle, rgba(224,173,99,0.14), rgba(224,173,99,0) 62%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "120px 120px",
          maskImage: "radial-gradient(ellipse at 30% 40%, #000 35%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse at 30% 40%, #000 35%, transparent 78%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at 50% 45%, transparent 45%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </div>
  );
};

/** Scene wrapper that fades itself in and out, relative to its Sequence. */
export const Scene: React.FC<{
  duration: number;
  children: React.ReactNode;
}> = ({ duration, children }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [duration - 12, duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: Math.min(fadeIn, fadeOut),
      }}
    >
      {children}
    </div>
  );
};

export const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** Body copy that fades and rises as one block (word-stagger reads badly at paragraph length). */
export const Body: React.FC<{
  text: string;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ text, delay = 12, style }) => {
  const { opacity, y } = useEnter(delay, 200, 110);
  return (
    <div style={{ opacity, transform: `translateY(${y * 0.4}px)`, ...style }}>
      {text}
    </div>
  );
};
