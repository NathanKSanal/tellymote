import React from "react";
import { Composition, registerRoot } from "remotion";
import { Promo } from "./Promo";
import { FPS, TOTAL_FRAMES } from "./timing";

const Root: React.FC = () => (
  <>
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  </>
);

registerRoot(Root);
