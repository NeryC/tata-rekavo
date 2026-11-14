import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: "./",
  // the pipeline writes the app data to ../data/app; serve it as static files
  publicDir: here("../data/app"),
  resolve: {
    alias: { "@core": here("../harmonized.js") },
  },
  server: { fs: { allow: [here("..")] } },
  build: { chunkSizeWarningLimit: 1500 },
});
