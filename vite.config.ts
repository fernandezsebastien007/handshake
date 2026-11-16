import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE_PATH || "/";
  return {
    base,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/@supabase/")) return "supabase";
            if (id.includes("node_modules/qr-scanner/")) return "scanner";
            if (id.includes("node_modules/qrcode.react/")) return "qr-code";
          },
        },
      },
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        includeAssets: ["icon.svg", "icons/*.png"],
        manifest: {
          id: base,
          name: "Handshake",
          short_name: "Handshake",
          description: "Private connections with people you meet.",
          start_url: base,
          scope: base,
          display: "standalone",
          background_color: "#f6f7f2",
          theme_color: "#18584c",
          icons: [
            {
              src: "icons/icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "icons/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "icons/maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // Only build assets are cached. Never cache Supabase responses or user data.
          navigateFallback: "index.html",
          navigateFallbackDenylist: [/^\/auth\//],
          globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
  };
});
