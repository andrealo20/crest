import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { type Downloads, type Release, summarize } from "./src/downloads";

// The website on crestisland.app (Cloudflare Pages). `npm run site:build` builds it into dist-site/ and then the app itself, in
// demo mode, into dist-site/demo/ (see src/dev/demo.ts). One HTML file per page; public/_headers sets the security headers.
const page = (path: string) => resolve(import.meta.dirname, path);
// What public/media holds now, so a page shows a film only once its files are there (src/release.ts).
const media = resolve(import.meta.dirname, "public/media");

/**
 * The releases' download counts for /stats/, read from GitHub once per build so the page asks nothing of GitHub itself. GITHUB_TOKEN,
 * when set (as in Actions), lifts the rate limit. Offline or refused, the page simply goes without them.
 * shortcut: one page of 100 releases, enough for years at today's pace; follow the Link header past that.
 */
async function downloads(): Promise<Downloads | null> {
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "crest-site-build" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch("https://api.github.com/repos/andrealo20/crest/releases?per_page=100", { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return summarize((await res.json()) as Release[], new Date());
  } catch (e) {
    console.warn("Stats page without download counts:", (e as Error).message);
    return null;
  }
}

export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    __SITE_MEDIA__: JSON.stringify(existsSync(media) ? readdirSync(media) : []),
    __SITE_DOWNLOADS__: JSON.stringify(await downloads()),
  },
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
        stats: page("stats/index.html"),
        notFound: page("404.html"),
      },
    },
  },
  server: { port: 1431, strictPort: true },
}));
