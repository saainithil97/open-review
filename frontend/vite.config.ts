import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        // Disable proxy timeouts so long-lived SSE connections survive
        // the full review duration (can be 5-10+ minutes).
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          // Disable socket timeout on the outbound proxy request for SSE
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.url?.includes("/stream")) {
              proxyReq.socket?.setTimeout(0);
            }
          });
          // Prevent response buffering for SSE streams
          proxy.on("proxyRes", (_proxyRes, req, res) => {
            if (req.url?.includes("/stream")) {
              res.setHeader("X-Accel-Buffering", "no");
            }
          });
        },
      },
    },
  },
});
