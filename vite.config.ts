import deno from "@deno/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

// https://vite.dev/config/
export default defineConfig({
  base: "/MyDenicek/",
  optimizeDeps: {
    include: ["@mydenicek/core"],
  },
  plugins: [
    deno(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    wasm(),
    topLevelAwait(),
  ],
});
