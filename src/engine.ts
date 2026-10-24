import { readFileSync } from "node:fs";
import type { Abi } from "abitype";

export interface Location {
  start: number;
  end: number;
}
export interface Contract extends Location {
  name: string;
  abi: Abi;
  members: (Location & { name: string; signature: string })[];
}
export interface Diagnostic {
  severity: string;
  message: string;
  errorCode?: string;
  sourceLocation?: Location & { file: string };
}
export interface Analysis {
  contracts: Contract[];
  diagnostics: Diagnostic[];
  requested: string[];
}
export interface Input {
  entry: string;
  root: string;
  sources: Record<string, string>;
  remappings: string[];
  includePaths: string[];
}
type Exports = {
  memory: WebAssembly.Memory;
  alloc(size: number): number;
  dealloc(pointer: number, size: number): void;
  analyze_json(pointer: number, size: number): bigint;
};
let module: WebAssembly.Module | undefined;
let instance: Exports | undefined;

export function analyze(input: Input): Analysis {
  module ??= new WebAssembly.Module(
    readFileSync(new URL("./engine.wasm", import.meta.url)),
  );
  instance ??= new WebAssembly.Instance(module).exports as Exports;
  const engine = instance;
  const bytes = Buffer.from(JSON.stringify(input));
  let pointer: number | undefined;
  let output: number | undefined;
  let length = 0;
  try {
    pointer = engine.alloc(bytes.length);
    new Uint8Array(engine.memory.buffer, pointer, bytes.length).set(bytes);
    const result = engine.analyze_json(pointer, bytes.length);
    output = Number(result & 0xffffffffn);
    length = Number(result >> 32n);
    const parsed = JSON.parse(
      Buffer.from(engine.memory.buffer, output, length).toString("utf8"),
    );
    if (parsed.error) throw new Error(parsed.error);
    return parsed as Analysis;
  } catch (error) {
    // A trapped Rust instance may contain partially initialized compiler globals. Never reuse it.
    instance = undefined;
    throw new Error("solilo analysis failed; no ABI was emitted", {
      cause: error,
    });
  } finally {
    if (instance === engine) {
      if (output !== undefined) engine.dealloc(output, length);
      if (pointer !== undefined) engine.dealloc(pointer, bytes.length);
    }
  }
}
