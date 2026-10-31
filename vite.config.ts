import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The dashboard builds into dist/public, next to the server bundle
// that serves it. In development Vite serves the UI and proxies
// API, webhook and socket traffic to the server on its port.
const server = `http://localhost:${process.env.PORT || 8080}`;

export default defineConfig({
  root: path.resolve(import.meta.dirname, "web"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "web/src"),
      "@shared": path.resolve(import.meta.dirname, "src/shared"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: "localhost",
    fs: { strict: true },
    proxy: {
      "/api": server,
      "/health": server,
      "/voice": server,
      "/events": { target: server, ws: true },
    },
  },
});
