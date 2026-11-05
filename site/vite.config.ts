import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The project page on GitHub Pages. `npm run site:build` builds it into dist-site/ and then the app itself,
// in demo mode, into dist-site/demo/ (see src/dev/demo.ts). Relative paths, so it works under /crest/ or anywhere.
export default defineConfig({
  plugins: [react()],
  root: "site",
  base: "./",
  publicDir: "public",
  build: { outDir: "../dist-site", emptyOutDir: true },
  server: { port: 1431, strictPort: true },
});
