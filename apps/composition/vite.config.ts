import { cloudflare } from "@cloudflare/vite-plugin";
import { vignette } from "@cbj/vignette-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const yogaCloudflare = fileURLToPath(new URL("./src/yoga-cloudflare.ts", import.meta.url));
const workerYoga: Plugin = {
  name: "worker-yoga-wasm-web",
  enforce: "pre",
  resolveId(source) {
    return source === "yoga-layout" && this.environment.name === "cloudflare_vignette_starter"
      ? yogaCloudflare
      : null;
  },
};

export default defineConfig({
  plugins: [
    workerYoga,
    // Discovers *.frame.tsx and composition assets at build time; emits
    // virtual:vignette/frames (registry + module host), virtual:vignette/assets
    // (content-versioned AssetManifest), deterministic frame client entries, and the
    // shared hydration client. No manual frame inputs or client manifest needed.
    vignette(),
    react(),
    tailwindcss(),
    cloudflare(),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: { exclude: ["yoga-layout"] },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
