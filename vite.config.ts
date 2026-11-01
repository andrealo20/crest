import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed port and shouldn't watch the Rust files.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // Second page: the detached timer window.
  build: { rollupOptions: { input: { main: "index.html", timer: "timer.html" } } },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
