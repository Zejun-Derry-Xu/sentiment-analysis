import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "frontend",
  plugins: [react()],
  preview: {
    proxy: {
      "/api": "http://127.0.0.1:5180",
      "/health": "http://127.0.0.1:5180",
      "/ready": "http://127.0.0.1:5180",
    },
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
      "/ready": "http://127.0.0.1:8000",
    },
  },
});
