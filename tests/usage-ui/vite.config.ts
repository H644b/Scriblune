import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  define: {
    "process.env.NEXT_PUBLIC_SITE_URL": JSON.stringify("http://127.0.0.1:4317"),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      "next/navigation": fileURLToPath(
        new URL("./navigation.ts", import.meta.url),
      ),
      "next/link": fileURLToPath(new URL("./link.tsx", import.meta.url)),
    },
  },
  server: { host: "127.0.0.1", port: 4317, strictPort: true },
});
