import { copyFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
copyFileSync(
  new URL(
    "../target/wasm32-unknown-unknown/release/solilo_bridge.wasm",
    import.meta.url,
  ),
  new URL("../dist/engine.wasm", import.meta.url),
);
// Exercise package resolution in this repository exactly as consumer projects do.
const self = new URL("../node_modules/solilo", import.meta.url);
if (!existsSync(self)) symlinkSync("..", self, "dir");
for (const tool of ["forge", "anvil"]) {
  const bin = new URL(`../node_modules/.bin/${tool}`, import.meta.url);
  if (!existsSync(bin)) symlinkSync(`../@foundry-rs/${tool}/bin.mjs`, bin);
}
