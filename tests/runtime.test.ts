import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Abi } from "abitype";
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
  assert.ok(account);
  const input = readFileSync("examples/Counter.sol", "utf8");
  const oracle: {
    contracts: {
      "Counter.sol": { Counter: { evm: { bytecode: { object: string } } } };
    };
  } = JSON.parse(
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
  const Counter: Abi = JSON.parse(
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
  assert.ok(receipt.contractAddress);
  const c = getContract({
    abi: Counter,
    address: receipt.contractAddress,
    client: { public: client, wallet },
  });
  assert.equal(await c.read.number!(), 0n);
  await client.waitForTransactionReceipt({
    hash: await c.write.setNumber!([9007199254740993n], { account }),
  });
  assert.equal(await c.read.number!(), 9007199254740993n);
  await client.waitForTransactionReceipt({
    hash: await c.write.increment!([], { account }),
  });
  assert.equal(await c.read.number!(), 9007199254740994n);
});
