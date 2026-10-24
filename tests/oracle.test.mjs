import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { compile } from "../dist/index.js";

test("both Tempo interfaces match the independent Alloy macro oracle", () => {
  const oracle = JSON.parse(
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
  function canonical(abi) {
    const clean = (value) =>
      Array.isArray(value)
        ? value.map(clean)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => key !== "internalType")
                .map(([key, v]) => [key, clean(v)]),
            )
          : value;
    return clean(abi).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
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
    assert.deepEqual(canonical(contract.abi), canonical(oracle[contract.name]));
    for (const member of contract.members)
      assert.equal(
        source.subarray(member.start, member.end).toString(),
        member.name,
      );
  }
});
