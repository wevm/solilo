import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Result } from "../dist/index.js";

test("Foundry effective profile and remappings are read by forge", (t) => {
  const root = mkdtempSync(join(tmpdir(), "solilo-foundry-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "foundry.toml"),
    '[profile.default]\nremappings = ["base/=wrong/"]\n[profile.solilo]\nremappings = ["base/=lib/"]\n',
  );
  symlinkSync(resolve("tests/fixtures"), join(root, "lib"));
  writeFileSync(
    join(root, "Entry.sol"),
    'pragma solidity ^0.8.13; import {Features} from "base/Features.sol"; interface Entry is Features {}',
  );
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {compile} from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)}; console.log(JSON.stringify(compile(${JSON.stringify(join(root, "Entry.sol"))})));`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        FOUNDRY_PROFILE: "solilo",
        PATH: `${resolve("node_modules/.bin")}:${process.env.PATH}`,
      },
    },
  );
  const result: Result = JSON.parse(output);
  assert.deepEqual(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assert.ok(
    result.contracts[0]?.abi.some(
      (item) => "name" in item && item.name === "positions",
    ),
  );
});
