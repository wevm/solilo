import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import solilo from "../dist/vite.js";
import { eventually } from "./lsp.mjs";

test("Vite refreshes dependent ABI modules and rejects an invalid saved edit", async () => {
  const root = mkdtempSync(join(tmpdir(), "solilo-vite-"));
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(
    join(root, "Base.sol"),
    "interface Base { function first() external; }",
  );
  writeFileSync(
    join(root, "Entry.sol"),
    'import "./Base.sol"; interface Entry is Base {}',
  );
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [solilo()],
    appType: "custom",
    server: { middlewareMode: true },
  });
  try {
    assert.match((await server.transformRequest("/Entry.sol")).code, /first/);
    writeFileSync(
      join(root, "Base.sol"),
      "interface Base { function second(uint256 x) external; }",
    );
    await eventually(
      () => server.transformRequest("/Entry.sol"),
      (result) => result?.code.includes("second"),
    );
    writeFileSync(join(root, "Base.sol"), "interface Base { invalid syntax");
    const failed = await eventually(
      async () => {
        try {
          await server.transformRequest("/Entry.sol");
          return false;
        } catch {
          return true;
        }
      },
      (value) => value,
    );
    assert.equal(failed, true);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
