import { resolve } from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@mariozechner/pi-ai", "@mariozechner/pi-agent-core"] })],
    build: {
      target: "node22",
    },
    resolve: {
      alias: {
        "@main": resolve("src/main"),
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: "node22",
    },
    define: {
      "process.env.PLAYWRIGHT_TEST": JSON.stringify(process.env.PLAYWRIGHT_TEST ?? ""),
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      target: "chrome130",
    },
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer"),
        "@shared": resolve("src/shared"),
      },
    },
  },
})
