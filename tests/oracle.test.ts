import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Abi } from "abitype";
import { compile } from "../dist/index.js";
import { canonical } from "./abi.js";

test("both Tempo interfaces match the independent Alloy macro oracle", () => {
  const oracle: Record<string, Abi> = JSON.parse(
    execFileSync(
      "cargo",
      [
        "run",
        "--quiet",
        "--locked",
        "--manifest-path",
        "tests/oracle/Cargo.toml",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CARGO_TARGET_DIR: new URL("../target/oracle", import.meta.url)
            .pathname,
        },
        timeout: 180000,
      },
    ),
  );
  const result = compile("examples/tip20.rs");
  assert.deepEqual(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assert.deepEqual(result.contracts.map((c) => c.name).sort(), [
    "IRolesAuth",
    "ITIP20",
  ]);
  const source = readFileSync("examples/tip20.rs");
  for (const contract of result.contracts) {
    assert.deepEqual(
      canonical(contract.abi),
      canonical(oracle[contract.name]!),
    );
    for (const member of contract.members)
      assert.equal(
        source.subarray(member.start, member.end).toString(),
        member.name,
      );
  }
});
