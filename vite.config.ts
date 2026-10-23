import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router"],
          data: ["@supabase/supabase-js", "@tanstack/react-query"],
        },
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "netlify/lib/**/*.test.ts", "scripts/**/*.test.mjs"],
    environment: "node",
  },
});
