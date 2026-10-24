import { runtimeModule } from "./index.js";
import { existsSync, statSync } from "node:fs";
import type { Plugin } from "vite";

export default function solilo(): Plugin {
  const imports = new Map<string, Set<string>>();
  return {
    name: "solilo",
    enforce: "pre" as const,
    load(id) {
      if (!/\.(sol|rs)$/.test(id)) return null;
      const { code, dependencies } = runtimeModule(id);
      imports.set(id, new Set(dependencies));
      for (const file of dependencies) {
        if (existsSync(file) && statSync(file).isFile())
          this.addWatchFile(file);
      }
      return { code, map: null };
    },
    handleHotUpdate({ file, modules, server }) {
      const affected = new Set(modules);
      for (const [id, dependencies] of imports) {
        if (!dependencies.has(file)) continue;
        const module = server.moduleGraph.getModuleById(id);
        if (module) {
          server.moduleGraph.invalidateModule(module);
          affected.add(module);
        }
      }
      return [...affected];
    },
  };
}
