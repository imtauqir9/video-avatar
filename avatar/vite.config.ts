import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND_PORT = process.env.BACKEND_PORT || "8787";

// The dev server proxies /api to the local backend so the browser stays same-origin
// and the Tavus API key never reaches the client.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${BACKEND_PORT}`,
    },
  },
});
