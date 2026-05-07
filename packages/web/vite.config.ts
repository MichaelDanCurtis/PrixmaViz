import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER = process.env.PRIXMAVIZ_SERVER ?? "http://localhost:5180";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    proxy: {
      "/api": SERVER,
      "/ws": { target: SERVER.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
