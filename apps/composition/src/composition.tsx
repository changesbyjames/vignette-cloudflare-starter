import { layerId, projectId, sceneId, sourceId, type LayoutStyle } from "@strangecyan/vignette-core";
import { View } from "@strangecyan/vignette-frame";
import { Broadcast, ColorSource, Layer, Scene, Sources } from "@strangecyan/vignette";
import type { ReactElement } from "react";

import { titleFrame } from "./frames/title.frame";

export const COMPOSITION_PROJECT_ID = projectId("vignette-starter");
export const COMPOSITION_CANVAS = { width: 1920, height: 1080, frameRate: 60 } as const;

const FILL: LayoutStyle = { position: "absolute", inset: 0, width: "100%", height: "100%" };

export function Composition(): ReactElement {
  return (
    <Broadcast>
      <Sources>
        <ColorSource
          id={sourceId("background")}
          color="#111827"
          size={COMPOSITION_CANVAS}
        />
      </Sources>
      <Scene id={sceneId("main")} label="Main">
        <Layer id={layerId("background")} sourceId={sourceId("background")} style={FILL} />
        <View
          id="title"
          source={titleFrame}
          params={{}}
          viewport={COMPOSITION_CANVAS}
          style={FILL}
        />
      </Scene>
    </Broadcast>
  );
}
