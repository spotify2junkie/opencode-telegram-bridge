import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  minify: false,
  outDir: "dist",
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
  noExternal: [],
});
