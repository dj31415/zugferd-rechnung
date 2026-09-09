import { defineConfig } from "vite";

// GitHub Pages liefert unter https://<user>.github.io/<repo>/ – Basis-Pfad per Umgebungsvariable setzen.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  build: { target: "es2022", assetsInlineLimit: 0 },
});
