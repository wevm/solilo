import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyze, type Analysis } from "./engine.js";
import { fingerprint, permitted, project, type Project } from "./project.js";
export type { Analysis, Contract, Diagnostic } from "./engine.js";

export interface Result extends Analysis {
  dependencies: string[];
}
const cache = new Map<string, { key: string; result: Result }>();

/** Analyze an imported file. Only `content` overlays disk; dependencies always come from disk. */
export function compile(
  file: string,
  content?: string,
  config?: Project,
): Result {
  file = resolve(file);
  const p = config ?? project(dirname(file));
  const source = content ?? readFileSync(file, "utf8");
  const previous = cache.get(file);
  const key = (files: string[]) =>
    fingerprint(
      files.filter((f) => f !== file),
      p.configIdentity + "\0" + source,
    );
  if (previous && previous.key === key(previous.result.dependencies))
    return previous.result;
  const sources: Record<string, string> = { [file]: source };
  const dependencies = new Set([...p.watchedFiles, file]);
  let result: Analysis;
  // Solar requests paths through its own resolver. The host never parses Solidity imports.
  for (;;) {
    result = analyze({
      entry: file,
      root: p.root,
      sources,
      remappings: p.remappings,
      includePaths: p.includePaths,
    });
    let added = false;
    for (const requested of result.requested) {
      const path = resolve(p.root, requested);
      dependencies.add(path);
      if (
        Object.hasOwn(sources, path) ||
        !existsSync(path) ||
        !statSync(path).isFile()
      )
        continue;
      if (!permitted(path, p))
        throw new Error(`Import outside configured source roots: ${path}`);
      sources[path] = readFileSync(path, "utf8");
      added = true;
    }
    if (!added) break;
  }
  const output = { ...result, dependencies: [...dependencies] };
  // Bounded process-local cache. No generated bindings or stale disk artifacts.
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(file, { key: key(output.dependencies), result: output });
  return output;
}

/** Emit runtime JS; invalid source always fails, even if a previous analysis succeeded. */
export function runtimeModule(file: string): {
  code: string;
  dependencies: string[];
} {
  const result = compile(file);
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length)
    throw new Error(
      errors
        .map((d) => `${d.sourceLocation?.file ?? file}: ${d.message}`)
        .join("\n"),
    );
  const code = result.contracts
    .map(
      (c, i) =>
        `const abi${i} = ${JSON.stringify(c.abi)}; export { abi${i} as ${JSON.stringify(c.name)} };`,
    )
    .join("\n");
  return { code, dependencies: result.dependencies };
}
