import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 8080,
    hmr: {
      overlay: true,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
      },
    },
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react-core";
          if (id.includes("/node_modules/lucide-react/")) return "icons-core";
          if (id.includes("/node_modules/wouter/")) return "router-core";
          if (id.includes("/node_modules/zod/")) return "validation-core";
          if (id.includes("/node_modules/@tanstack/")) return "query-core";
          if (
            id.includes("/node_modules/@radix-ui/")
            || id.includes("/node_modules/sonner/")
          ) return "ui-core";
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
});
