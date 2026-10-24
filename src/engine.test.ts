import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Analysis } from "../dist/engine.js";

test("WASM is host-import-free and repeated analysis stabilizes memory, including invalid requests", () => {
  const module = new WebAssembly.Module(readFileSync("dist/engine.wasm"));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const e = new WebAssembly.Instance(module).exports as {
    memory: WebAssembly.Memory;
    alloc(size: number): number;
    dealloc(pointer: number, size: number): void;
    analyze_json(pointer: number, size: number): bigint;
  };
  const source = readFileSync("examples/Counter.sol", "utf8");
  function call(input: string): Analysis | { error: string } {
    const b = Buffer.from(input),
      p = e.alloc(b.length);
    new Uint8Array(e.memory.buffer, p, b.length).set(b);
    const r = e.analyze_json(p, b.length),
      ptr = Number(r & 0xffffffffn),
      len = Number(r >> 32n);
    const output = JSON.parse(
      Buffer.from(e.memory.buffer, ptr, len).toString(),
    );
    e.dealloc(ptr, len);
    e.dealloc(p, b.length);
    return output;
  }
  let warm: number | undefined;
  for (let i = 0; i < 400; i++) {
    const invalid = call("{invalid json");
    assert.ok("error" in invalid && invalid.error);
    const r = call(
      JSON.stringify({
        entry: "/Counter.sol",
        root: "/",
        sources: { "/Counter.sol": `${source}\n// ${i}` },
        remappings: [],
        includePaths: [],
      }),
    );
    assert.ok("contracts" in r);
    assert.equal(r.contracts[0]?.abi.length, 3);
    if (i === 50) warm = e.memory.buffer.byteLength;
  }
  assert.equal(e.memory.buffer.byteLength, warm);
});
