declare module "jsr:@cbj/vignette-core@^0.2.1" {
  export * from "@cbj/vignette-core";
}

declare module "jsr:@cbj/vignette@^0.2.1" {
  export * from "@cbj/vignette";
}

declare module "npm:react@19.2.7" {
  import React = require("react");
  export = React;
}

declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
