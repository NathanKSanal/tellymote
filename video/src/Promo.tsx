import React from "react";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { Backdrop, Body, DrawRule, PALETTE, Pill, Scene, ShotCard, WordReveal, useEnter } from "./components";

const DISPLAY = 'Bahnschrift, "Segoe UI Variable Display", "Segoe UI", sans-serif';
const TEXT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

const Eyebrow: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
  const { opacity, y } = useEnter(delay, 200, 120);
  return (
    <div
      style={{
        fontFamily: TEXT,
        fontSize: 15,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: PALETTE.accent,
        fontWeight: 600,
        marginBottom: 24,
        opacity,
        transform: `translateY(${y * 0.5}px)`,
      }}
    >
      {children}
    </div>
  );
};

const Copy: React.FC<{
  eyebrow: string;
  headline: string;
  body: string;
  accentWords?: number[];
}> = ({ eyebrow, headline, body, accentWords }) => (
  <div style={{ position: "absolute", left: 130, top: 300, width: 560 }}>
    <Eyebrow delay={6}>{eyebrow}</Eyebrow>
    <div
      style={{
        fontFamily: DISPLAY,
        fontSize: 62,
        lineHeight: 1.06,
        letterSpacing: "-0.02em",
        color: PALETTE.ink,
        marginBottom: 26,
      }}
    >
      <WordReveal text={headline} delay={10} stagger={3} accentWords={accentWords} />
    </div>
    <Body
      text={body}
      delay={18}
      style={{ fontFamily: TEXT, fontSize: 24, lineHeight: 1.5, color: PALETTE.muted }}
    />
  </div>
);

const TitleScene: React.FC = () => {
  const brand = useEnter(2, 190, 110);
  const sub = useEnter(26, 200, 110);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 300,
          display: "flex",
          alignItems: "center",
          gap: 22,
          opacity: brand.opacity,
          transform: `translateY(${brand.y}px) scale(${brand.scale})`,
        }}
      >
        <div
          style={{
            width: 76,
            height: 76,
            borderRadius: 18,
            background: PALETTE.accent,
            color: PALETTE.accentInk,
            display: "grid",
            placeItems: "center",
            fontFamily: DISPLAY,
            fontSize: 40,
            fontWeight: 700,
          }}
        >
          T
        </div>
        <div style={{ fontFamily: DISPLAY, fontSize: 62, color: PALETTE.ink }}>TellyMote</div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 140,
          top: 400,
          width: 1280,
          fontFamily: DISPLAY,
          fontSize: 96,
          lineHeight: 1.02,
          letterSpacing: "-0.03em",
          color: PALETTE.ink,
        }}
      >
        <WordReveal text="Your TV," delay={6} stagger={4} />
        <br />
        <WordReveal text="on your desktop." delay={16} stagger={4} accentWords={[2]} />
      </div>

      <div style={{ position: "absolute", left: 144, top: 668 }}>
        <DrawRule delay={30} width={96} />
      </div>

      <div
        style={{
          position: "absolute",
          left: 144,
          top: 700,
          width: 900,
          fontFamily: TEXT,
          fontSize: 30,
          lineHeight: 1.4,
          color: PALETTE.muted,
          opacity: sub.opacity,
          transform: `translateY(${sub.y * 0.45}px)`,
        }}
      >
        A remote and live screen viewer for Android TV, Google TV and Roku — over your own network.
      </div>

      <div style={{ position: "absolute", left: 144, top: 800, display: "flex", gap: 14 }}>
        <Pill label="No account" delay={38} />
        <Pill label="No cloud relay" delay={43} />
        <Pill label="No telemetry" delay={48} />
      </div>
    </AbsoluteFill>
  );
};

const DashboardScene: React.FC = () => (
  <AbsoluteFill>
    <Copy
      eyebrow="Dashboard"
      headline="Remote and screen, in one window."
      body="Latency, capture rate and capability status are measured on your network, not estimated."
    />
    <div style={{ position: "absolute", left: 720, top: 138 }}>
      <ShotCard src={staticFile("dashboard.png")} delay={4} />
    </div>
  </AbsoluteFill>
);

const RemoteScene: React.FC = () => (
  <AbsoluteFill>
    <Copy
      eyebrow="Remote"
      headline="D-pad, volume and media keys from your keyboard."
      body="Type a search with a real keyboard. Bind any key. Pair once, then it is instant."
    />
    <div style={{ position: "absolute", left: 720, top: 138 }}>
      <ShotCard src={staticFile("remote.png")} delay={4} />
    </div>
  </AbsoluteFill>
);

const DevicesScene: React.FC = () => (
  <AbsoluteFill>
    <Copy
      eyebrow="Discovery"
      headline="Finds the TV. And the Roku."
      body="Three protocols on your local network. No platform-tools required."
    />
    <div style={{ position: "absolute", left: 130, top: 700, display: "flex", gap: 12 }}>
      <Pill label="Android TV Remote v2" delay={26} />
      <Pill label="ADB" delay={31} />
      <Pill label="Roku ECP" delay={36} />
    </div>
    <div style={{ position: "absolute", left: 720, top: 138 }}>
      <ShotCard src={staticFile("devices.png")} delay={4} />
    </div>
  </AbsoluteFill>
);

const TrustCard: React.FC<{ title: string; body: string; delay: number }> = ({ title, body, delay }) => {
  const { opacity, y } = useEnter(delay, 200, 120);
  return (
    <div
      style={{
        flex: 1,
        border: `1px solid ${PALETTE.line}`,
        background: "rgba(17,19,24,0.9)",
        borderRadius: 14,
        padding: "26px 26px 30px",
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      <div style={{ fontFamily: DISPLAY, fontSize: 22, color: PALETTE.ink, marginBottom: 10 }}>{title}</div>
      <div style={{ fontFamily: TEXT, fontSize: 19, lineHeight: 1.45, color: PALETTE.muted }}>{body}</div>
    </div>
  );
};

const TrustScene: React.FC = () => (
  <AbsoluteFill>
    <div style={{ position: "absolute", left: 140, top: 280, width: 1400 }}>
      <Eyebrow delay={6}>Trust</Eyebrow>
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 78,
          lineHeight: 1.06,
          letterSpacing: "-0.025em",
          color: PALETTE.ink,
          marginBottom: 30,
        }}
      >
        <WordReveal text="Unsigned build." delay={8} stagger={3} />
        <br />
        <WordReveal text="Published hashes." delay={16} stagger={3} />
      </div>
      <Body
        text="There is no paid code-signing certificate behind this project, so Windows will warn once. Every file ships with a SHA-256, and you can build it yourself."
        delay={22}
        style={{ fontFamily: TEXT, fontSize: 28, lineHeight: 1.5, color: PALETTE.muted, width: 1150 }}
      />
      <div style={{ display: "flex", gap: 18, marginTop: 54 }}>
        <TrustCard title="SHA256SUMS.txt" body="In every release, next to the binaries." delay={34} />
        <TrustCard title="No account, no relay" body="Traffic goes laptop to TV, nowhere else." delay={39} />
        <TrustCard title="Source available" body="FSL-1.1-MIT. Read it, build it, fork it." delay={44} />
      </div>
    </div>
  </AbsoluteFill>
);

const CtaScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const badge = spring({ frame: frame - 10, fps, config: { damping: 14, stiffness: 90, mass: 1.1 } });
  const url = useEnter(18, 200, 110);
  const underline = spring({ frame: frame - 30, fps, config: { damping: 200, stiffness: 80 } });
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 140, top: 330 }}>
        <Eyebrow delay={4}>Free for non-competing use</Eyebrow>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 84,
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            color: PALETTE.ink,
          }}
        >
          <WordReveal text="Windows, macOS" delay={8} stagger={3} />
          <br />
          <WordReveal text="and Linux." delay={16} stagger={3} />
        </div>

        <div
          style={{
            marginTop: 44,
            opacity: url.opacity,
            transform: `translateY(${url.y * 0.5}px)`,
          }}
        >
          <div style={{ fontFamily: "Consolas, monospace", fontSize: 30, color: PALETTE.ink }}>
            github.com/NathanKSanal/tellymote
          </div>
          <div
            style={{
              height: 2,
              width: 560 * underline,
              background: PALETTE.accent,
              marginTop: 10,
            }}
          />
        </div>

        <div style={{ marginTop: 34, fontFamily: TEXT, fontSize: 22, color: PALETTE.faint }}>
          Android client in preview · built for a Mi TV 4A, works with other Android TV sets
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 150,
          top: 400,
          width: 300,
          height: 300,
          borderRadius: 32,
          background: PALETTE.accent,
          color: PALETTE.accentInk,
          display: "grid",
          placeItems: "center",
          fontFamily: DISPLAY,
          fontSize: 150,
          fontWeight: 700,
          opacity: badge,
          transform: `scale(${interpolate(badge, [0, 1], [0.8, 1])})`,
          boxShadow: "0 40px 90px rgba(224,173,99,0.22)",
        }}
      >
        T
      </div>
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: PALETTE.bg }}>
      <Backdrop />

      <Sequence from={0} durationInFrames={124} name="Title">
        <Scene duration={124}>
          <TitleScene />
        </Scene>
      </Sequence>

      <Sequence from={124} durationInFrames={206} name="Dashboard">
        <Scene duration={206}>
          <DashboardScene />
        </Scene>
      </Sequence>

      <Sequence from={330} durationInFrames={180} name="Remote">
        <Scene duration={180}>
          <RemoteScene />
        </Scene>
      </Sequence>

      <Sequence from={510} durationInFrames={152} name="Devices">
        <Scene duration={152}>
          <DevicesScene />
        </Scene>
      </Sequence>

      <Sequence from={662} durationInFrames={120} name="Trust">
        <Scene duration={120}>
          <TrustScene />
        </Scene>
      </Sequence>

      <Sequence from={782} durationInFrames={118} name="CTA">
        <Scene duration={118}>
          <CtaScene />
        </Scene>
      </Sequence>
    </AbsoluteFill>
  );
};
