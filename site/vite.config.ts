import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The website on crestisland.app (Cloudflare Pages). `npm run site:build` builds it into dist-site/ and then the app itself, in
// demo mode, into dist-site/demo/ (see src/dev/demo.ts). One HTML file per page; public/_headers sets the security headers.
const page = (path: string) => resolve(import.meta.dirname, path);

export default defineConfig({
  plugins: [react()],
  root: "site",
  base: "/",
  publicDir: "public",
  build: {
    outDir: "../dist-site",
    emptyOutDir: true,
    // Every image a file of its own: the CSP allows no data: images on these pages.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        home: page("index.html"),
        whatsNew: page("whats-new/index.html"),
        privacy: page("privacy/index.html"),
        press: page("press/index.html"),
        feedback: page("feedback/index.html"),
        notFound: page("404.html"),
      },
    },
  },
  server: { port: 1431, strictPort: true },
});
