import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  getContract,
} from "viem";
import { foundry } from "viem/chains";
import solc from "solc";

test("Counter deploys on disposable Anvil and viem reads/writes use the imported ABI", async (t) => {
  const anvil = spawn(
    process.execPath,
    ["node_modules/@foundry-rs/anvil/bin.mjs", "--port", "18547", "--silent"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let failure = "";
  anvil.stderr.on("data", (b) => {
    failure += b;
  });
  t.onTestFinished(async () => {
    const exited = new Promise((r) => anvil.once("exit", r));
    anvil.kill("SIGTERM");
    await exited;
  });
  const client = createPublicClient({
    chain: foundry,
    transport: http("http://127.0.0.1:18547", { retryCount: 0 }),
    pollingInterval: 20,
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await client.getBlockNumber();
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  assert.ok(ready, failure);
  const wallet = createWalletClient({
    chain: foundry,
    transport: http("http://127.0.0.1:18547"),
  });
  const [account] = await wallet.getAddresses();
  const input = readFileSync("examples/Counter.sol", "utf8");
  const oracle = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "Counter.sol": { content: input } },
        settings: {
          evmVersion: "cancun",
          outputSelection: { "*": { "*": ["evm.bytecode.object"] } },
        },
      }),
    ),
  );
  // A native Node subprocess exercises registerHooks rather than Vitest's loader.
  const Counter = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "./dist/register.js",
        "--input-type=module",
        "-e",
        "import { Counter } from './examples/Counter.sol'; console.log(JSON.stringify(Counter));",
      ],
      { encoding: "utf8" },
    ),
  );
  const hash = await wallet.deployContract({
    account,
    abi: Counter,
    bytecode: `0x${oracle.contracts["Counter.sol"].Counter.evm.bytecode.object}`,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  const c = getContract({
    abi: Counter,
    address: receipt.contractAddress,
    client: { public: client, wallet },
  });
  assert.equal(await c.read.number(), 0n);
  await client.waitForTransactionReceipt({
    hash: await c.write.setNumber([9007199254740993n], { account }),
  });
  assert.equal(await c.read.number(), 9007199254740993n);
  await client.waitForTransactionReceipt({
    hash: await c.write.increment({ account }),
  });
  assert.equal(await c.read.number(), 9007199254740994n);
});

test("WASM is host-import-free and repeated analysis stabilizes memory, including invalid requests", () => {
  const module = new WebAssembly.Module(readFileSync("dist/engine.wasm"));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const e = new WebAssembly.Instance(module).exports;
  const source = readFileSync("examples/Counter.sol", "utf8");
  function call(input) {
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
  let warm;
  for (let i = 0; i < 400; i++) {
    assert.ok(call("{invalid json").error);
    const r = call(
      JSON.stringify({
        entry: "/Counter.sol",
        root: "/",
        sources: { "/Counter.sol": `${source}\n// ${i}` },
        remappings: [],
        includePaths: [],
      }),
    );
    assert.equal(r.contracts[0].abi.length, 3);
    if (i === 50) warm = e.memory.buffer.byteLength;
  }
  assert.equal(e.memory.buffer.byteLength, warm);
});

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
  const result = JSON.parse(output);
  assert.deepEqual(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assert.ok(result.contracts[0].abi.some((item) => item.name === "positions"));
});
