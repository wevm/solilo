import { test } from "vitest";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import solc from "solc";
import type { Abi } from "abitype";
import { compile, runtimeModule } from "../dist/index.js";
import { canonical } from "../tests/abi.js";

test("Solar matches solc ABI for getters, overloads, tuples, events, errors and inheritance", () => {
  for (const file of ["examples/Counter.sol", "tests/fixtures/Features.sol"]) {
    const source = readFileSync(file, "utf8");
    const oracle: {
      errors?: { severity: string }[];
      contracts: Record<string, Record<string, { abi: Abi }>>;
    } = JSON.parse(
      solc.compile(
        JSON.stringify({
          language: "Solidity",
          sources: { [file]: { content: source } },
          settings: { outputSelection: { "*": { "*": ["abi"] } } },
        }),
      ),
    );
    assert.deepEqual(
      oracle.errors?.filter((e) => e.severity === "error") ?? [],
      [],
    );
    const result = compile(file);
    assert.deepEqual(
      result.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    assert.equal(
      result.contracts.length,
      Object.keys(oracle.contracts[file]!).length,
    );
    for (const contract of result.contracts) {
      assert.deepEqual(
        canonical(contract.abi),
        canonical(oracle.contracts[file]![contract.name]!.abi),
      );
      for (const member of contract.members)
        assert.equal(
          Buffer.from(source).subarray(member.start, member.end).toString(),
          member.name,
        );
    }
  }
});

test("source overlays, saved dependencies, new imports and deleted dependencies cannot reuse stale ABI", (t) => {
  const root = mkdtempSync(join(tmpdir(), "solilo-imports-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(
    join(root, "solilo.json"),
    JSON.stringify({ remappings: ["base/=lib/"] }),
  );
  mkdirSync(join(root, "lib"));
  const base = join(root, "lib/Base.sol"),
    entry = join(root, "Entry.sol");
  writeFileSync(
    base,
    "pragma solidity ^0.8.13; interface Base { function old() external returns (bool); }",
  );
  const source =
    'pragma solidity ^0.8.13; import {Base} from "base/Base.sol"; interface Entry is Base {}';
  writeFileSync(entry, source);
  const names = () =>
    compile(entry).contracts[0]?.abi.map((x) =>
      "name" in x ? x.name : undefined,
    );
  assert.deepEqual(names(), ["old"]);
  writeFileSync(
    base,
    "pragma solidity ^0.8.13; interface Base { function fresh(uint256 x) external returns (uint256); }",
  );
  assert.deepEqual(names(), ["fresh"]);
  assert.equal(
    compile(entry, source.replace("Entry is", "Overlay is")).contracts[0]?.name,
    "Overlay",
  );
  assert.equal(compile(entry).contracts[0]?.name, "Entry");
  const changed = source.replace("base/Base.sol", "base/New.sol");
  assert.ok(
    compile(entry, changed).diagnostics.some((d) => d.severity === "error"),
  );
  writeFileSync(join(root, "lib/New.sol"), readFileSync(base));
  const item = compile(entry, changed).contracts[0]?.abi[0];
  assert.ok(item && "name" in item);
  assert.equal(item.name, "fresh");
  rmSync(base);
  assert.throws(() => runtimeModule(entry), /not found|resolve|import/i);
  writeFileSync(entry, "contract Entry { invalid }");
  assert.throws(() => runtimeModule(entry));
});

test("unsupported compiler modes and Rust expansion fail closed; subsequent analysis still works", () => {
  for (const source of [
    "pragma solidity 0.7.6; contract X {}",
    "pragma abicoder v1; contract X {}",
  ]) {
    const r = compile("/tmp/X.sol", source);
    assert.equal(r.contracts.length, 0);
    assert.ok(r.diagnostics.some((d) => d.severity === "error"));
  }
  for (const source of [
    'alloy_sol_types::sol!("abi.json");',
    '#[cfg(feature="x")] sol! { interface I {} }',
    '#[cfg(feature="x")] mod m { sol! { interface I {} } }',
    '#![cfg(feature="x")] sol! { interface I {} }',
    "#[rewrite] sol! { interface I {} }",
    "use not_alloy::sol; sol! { interface I {} }",
    "macro_rules! sol { ($($x:tt)*) => {}; } sol! { interface I {} }",
    'sol! { #[sol(rename="Oops")] interface I {} }',
    "sol! { interface I { function f(External value) external; } }",
    "macro_rules! hidden { () => { sol! { interface I {} } } }",
    'fn example() { let x = "sol! { interface Fake {} }"; }',
  ]) {
    const r = compile("/tmp/X.rs", source);
    assert.equal(r.contracts.length, 0, source);
    assert.ok(
      r.diagnostics.some((d) => d.severity === "error"),
      source,
    );
  }
  assert.equal(compile("examples/Counter.sol").contracts[0]?.name, "Counter");
});

test("Rust extraction keeps original Unicode/CRLF offsets and does not infer from storage macros", () => {
  const source =
    "// 🦀 café\r\n#[contract]\r\nstruct Storage { x: u64 }\r\ncrate::sol! {\r\n #[derive(Debug)]\r\n #[sol(abi)]\r\n interface I { function read() external view returns (uint256); }\r\n}\r\n";
  const r = compile("/tmp/I.rs", source);
  assert.deepEqual(
    r.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assert.deepEqual(
    r.contracts.map((c) => c.name),
    ["I"],
  );
  const member = r.contracts[0]?.members[0];
  assert.ok(member);
  assert.equal(
    member.start,
    Buffer.byteLength(source.slice(0, source.indexOf("read()"))),
  );
  assert.equal(
    Buffer.from(source).subarray(member.start, member.end).toString(),
    "read",
  );
});

test("import reads enforce real source roots, including symlinks", (t) => {
  const root = mkdtempSync(join(tmpdir(), "solilo-roots-"));
  const outside = mkdtempSync(join(tmpdir(), "solilo-outside-"));
  t.onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(outside, "Private.sol"), "interface Private {}");
  symlinkSync(join(outside, "Private.sol"), join(root, "Alias.sol"));
  const entry = join(root, "Entry.sol");
  writeFileSync(entry, 'import "./Alias.sol"; interface Entry {}');
  assert.throws(() => compile(entry), /outside configured source roots/);
});

test("Solidity names that are JavaScript keywords remain valid named ABI exports", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "solilo-names-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "Names.sol");
  writeFileSync(
    file,
    "contract class { function await() external {} } contract arguments {}",
  );
  const { code } = runtimeModule(file);
  const module = await import(
    `data:text/javascript,${encodeURIComponent(code)}`
  );
  assert.deepEqual(Object.keys(module).sort(), ["arguments", "class"]);
  assert.equal(module.class[0].name, "await");
});
