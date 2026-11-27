import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": new URL("./", import.meta.url).pathname } },
  // tsconfig says jsx: "preserve" (Next compiles it); tests that render a component need it compiled.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["test/**/*.test.ts"] },
});
