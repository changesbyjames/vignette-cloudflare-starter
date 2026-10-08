import { Broadcast, ColorSource, defineComposition, fill, Layer, Scene, Sources } from "@strangecyan/vignette";
import { View } from "@strangecyan/vignette-frame";
import type { ReactElement } from "react";

import { titleFrame } from "./frames/title.frame";

function Show(): ReactElement {
  return (
    <Broadcast>
      <Sources>
        <ColorSource id="background" color="#111827" />
      </Sources>
      <Scene id="main" label="Main">
        <Layer id="background" sourceId="background" style={fill} />
        <View id="title" source={titleFrame} style={fill} />
      </Scene>
    </Broadcast>
  );
}

/** The project's identity: `id` is the managed OBS namespace and must match `vignette obs --project`. */
export const composition = defineComposition({
  id: "vignette-starter",
  canvas: { width: 1920, height: 1080, frameRate: 60 },
  component: Show,
});
