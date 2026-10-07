import { cloudflare } from "@cloudflare/vite-plugin";
import { vignette } from "@strangecyan/vignette-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // Discovers *.frame.tsx and composition assets at build time and emits
    // virtual:vignette/frames, virtual:vignette/assets, and the frame client entries.
    // The Durable Object hosts the composer, so the plugin's dev composer is not used.
    vignette(),
    react(),
    tailwindcss(),
    cloudflare(),
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
