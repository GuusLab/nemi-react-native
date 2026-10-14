import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  // Peers and the core SDK are resolved by the app's bundler (Metro), never inlined.
  external: [
    "@guuslab/nemi",
    "react",
    "react/jsx-runtime",
    "react-native",
    "expo-web-browser",
    "expo-secure-store",
    "expo-crypto",
  ],
  outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".js" }),
});
