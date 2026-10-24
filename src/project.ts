import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface Project {
  root: string;
  remappings: string[];
  includePaths: string[];
  allowed: string[];
  watchedFiles: string[];
  configIdentity: string;
}

export function project(from: string): Project {
  let root = resolve(from);
  for (let dir = root; ; dir = dirname(dir)) {
    if (
      ["foundry.toml", "solilo.json", "package.json"].some((f) =>
        existsSync(join(dir, f)),
      )
    ) {
      root = dir;
      break;
    }
    if (dirname(dir) === dir) break;
  }
  let remappings: string[] = [];
  let includePaths: string[] = [];
  const watchedFiles = [
    join(root, "foundry.toml"),
    join(root, "solilo.json"),
    join(root, "remappings.txt"),
  ];
  if (existsSync(join(root, "foundry.toml")) || process.env.FOUNDRY_CONFIG) {
    // Foundry, not a partial TOML reimplementation, owns profile/env/library resolution.
    const config = JSON.parse(
      execFileSync("forge", ["config", "--json", "--root", root], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    remappings = config.remappings ?? [];
    includePaths = [...(config.libs ?? []), ...(config.include_paths ?? [])];
    if (process.env.FOUNDRY_CONFIG)
      watchedFiles.push(resolve(process.env.FOUNDRY_CONFIG));
    if (process.env.HOME)
      watchedFiles.push(join(process.env.HOME, ".foundry", "foundry.toml"));
  }
  if (existsSync(join(root, "solilo.json"))) {
    const config = JSON.parse(readFileSync(join(root, "solilo.json"), "utf8"));
    for (const key of Object.keys(config))
      if (!["remappings", "includePaths"].includes(key))
        throw new Error(`Unknown solilo.json option: ${key}`);
    for (const key of ["remappings", "includePaths"]) {
      if (
        config[key] !== undefined &&
        (!Array.isArray(config[key]) ||
          config[key].some((v: unknown) => typeof v !== "string"))
      )
        throw new Error(`${key} must be an array of strings`);
    }
    remappings = config.remappings ?? remappings;
    includePaths = config.includePaths ?? includePaths;
  }
  includePaths = includePaths.map((p) => resolve(root, p));
  const allowed = [
    root,
    ...includePaths,
    ...remappings.map((m) => resolve(root, m.slice(m.indexOf("=") + 1))),
  ];
  const configIdentity = fingerprint(
    [...watchedFiles],
    JSON.stringify({ root, remappings, includePaths }),
  );
  return {
    root,
    remappings,
    includePaths,
    allowed,
    watchedFiles,
    configIdentity,
  };
}

export function permitted(file: string, p: Project): boolean {
  const real = realpathSync(file);
  return p.allowed.some((base) => {
    const rel = relative(existsSync(base) ? realpathSync(base) : base, real);
    return (
      rel === "" ||
      (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
    );
  });
}

export function fingerprint(files: string[], seed = ""): string {
  const hash = createHash("sha256").update(seed);
  for (const file of [...new Set(files)].sort()) {
    hash.update(file).update("\0");
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update("<missing>");
    }
  }
  return hash.digest("hex");
}

// Project-level mapper invalidation: include directories to discover newly added imports, too.
export function watchProject(p: Project): {
  watchedFiles: string[];
  configIdentity: string;
} {
  const files = new Set(p.watchedFiles);
  const visited = new Set<string>();
  function walk(dir: string) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
    const real = realpathSync(dir);
    if (visited.has(real)) return;
    visited.add(real);
    files.add(dir);
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (
        [
          ".git",
          "node_modules",
          "target",
          "out",
          "cache",
          "dist",
          ".amp",
        ].includes(item.name)
      )
        continue;
      const path = join(dir, item.name);
      if (item.isDirectory()) walk(path);
      else if (/\.(sol|rs)$/.test(item.name)) files.add(path);
    }
  }
  for (const root of p.allowed) walk(root);
  const watchedFiles = [...files];
  return {
    watchedFiles,
    configIdentity: fingerprint(watchedFiles, p.configIdentity),
  };
}
