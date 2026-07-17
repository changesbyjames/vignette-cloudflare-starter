import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "http://127.0.0.1:5198" },
  webServer: {
    command:
      "vite build && wrangler dev --config dist/cloudflare_vignette_starter/wrangler.json --port 5198",
    url: "http://127.0.0.1:5198",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
