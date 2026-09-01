import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/migrate.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  sourcemap: true,
  noExternal: [/^@starlight\/launchpad-contracts(?:\/.*)?$/],
});
