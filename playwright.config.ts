import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 4,
  reporter: "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://test-project.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-public-key-only",
      VITE_BASE_PATH: "/",
    },
  },
});
