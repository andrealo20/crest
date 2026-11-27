import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed port and shouldn't watch the Rust files.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // The in-browser demo (see src/dev/demo.ts) is a page of its own: English, named, and kept out of search results.
    {
      name: "demo-html",
      apply: () => mode === "demo",
      transformIndexHtml: (html: string) =>
        html.replace('lang="de"', 'lang="en"').replace("<title>Crest</title>", '<title>Crest demo</title>\n    <meta name="robots" content="noindex" />'),
    },
    // The Store package leaves out the wallpapers of unknown source, the numeric names (scripts/store-package.ps1 sets CREST_STORE):
    // their thumbnails load as nothing, so none is bundled, and the gallery shows only the pictures it has (thumbs.ts).
    {
      name: "store-wallpapers",
      enforce: "pre" as const,
      apply: () => !!process.env.CREST_STORE,
      load: (id: string) => (/[\\/]assets[\\/]wallpapers[\\/]\d+\.jpg$/.test(id) ? 'export default "";' : undefined),
    },
  ],
  // The Store package's build, for the tools it leaves out (src/platform/storeBuild.ts).
  define: { "import.meta.env.CREST_STORE": JSON.stringify(process.env.CREST_STORE ?? "") },
  clearScreen: false,
  // More pages: the detached timer window, the copies of the closed notch on other monitors, the settings window and the
  // taskbar (the demo has none of them).
  build: {
    rollupOptions: {
      input: { main: "index.html", ...(mode === "demo" ? {} : { timer: "timer.html", mirror: "mirror.html", settings: "settings.html", taskbar: "taskbar.html" }) } as Record<string, string>,
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/target-shared/**", "**/.claude/**"] },
  },
}));
