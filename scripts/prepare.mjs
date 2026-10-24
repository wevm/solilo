import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

// Hooks are contributor-local, never an installed package's responsibility.
if (existsSync(".git") && !process.env.CI && process.env.VP_GIT_HOOKS !== "0") {
  execFileSync("vp", ["config", "--no-agent"], { stdio: "inherit" });
  mkdirSync(".vite-hooks", { recursive: true });
  writeFileSync(".vite-hooks/pre-commit", "vp staged\n", { mode: 0o755 });
}
