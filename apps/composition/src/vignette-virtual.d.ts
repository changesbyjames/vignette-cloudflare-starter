/**
 * Application-local declarations for the virtual modules emitted by @cbj/vignette-vite.
 * JSR cannot ship ambient module declarations, so these stay in the app.
 */
declare module "virtual:vignette/frames" {
  export const frames: import("@cbj/vignette-frame/server").FrameBundle;
}

declare module "virtual:vignette/assets" {
  export const assets: import("@cbj/vignette-core").AssetManifest;
}
