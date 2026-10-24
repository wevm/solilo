import { fileURLToPath } from "node:url";
import { runtimeModule } from "./index.js";

declare const Bun:
  | undefined
  | {
      plugin(plugin: {
        name: string;
        setup(build: {
          onLoad(
            options: { filter: RegExp },
            callback: (args: { path: string }) => {
              loader: string;
              contents: string;
            },
          ): void;
        }): void;
      }): void;
    };

if (typeof Bun !== "undefined") {
  Bun.plugin({
    name: "solilo",
    setup(build) {
      build.onLoad({ filter: /\.(sol|rs)$/ }, ({ path }) => ({
        loader: "js",
        contents: runtimeModule(path).code,
      }));
    },
  });
} else {
  const { registerHooks } = await import("node:module");
  registerHooks({
    load(url, context, nextLoad) {
      if (
        !url.startsWith("file:") ||
        !/\.(sol|rs)$/.test(new URL(url).pathname)
      )
        return nextLoad(url, context);
      return {
        format: "module",
        source: runtimeModule(fileURLToPath(url)).code,
        shortCircuit: true,
      };
    },
  });
}
