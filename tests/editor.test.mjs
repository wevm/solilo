import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { server, position, eventually } from "./lsp.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "solilo-editor-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  symlinkSync(resolve("node_modules"), join(root, "node_modules"));
  writeFileSync(
    join(root, "tsconfig.json"),
    readFileSync("examples/tsconfig.json"),
  );
  writeFileSync(
    join(root, "Counter.sol"),
    readFileSync("examples/Counter.sol"),
  );
  return root;
}

test("TS7 infers viem bigint and rejects wrong names/arguments without generated bindings", (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, "main.ts"),
    `
import { Counter } from './Counter.sol';
import { createPublicClient, getContract, http } from 'viem';
const client = createPublicClient({ transport: http() });
const c = getContract({ abi: Counter, address: '0x0000000000000000000000000000000000000001', client });
const n: Promise<bigint> = c.read.number();
// @ts-expect-error nonexistent function must not widen to string
c.read.noSuchMethod();
// @ts-expect-error input must be bigint
c.simulate.setNumber(['wrong']);
// @ts-expect-error missing argument
c.simulate.setNumber([]);
// @ts-expect-error return must remain bigint
const wrong: Promise<string> = c.read.number();
`,
  );
  assert.equal(
    execFileSync(
      resolve("node_modules/.bin/tsc"),
      ["-p", root, "--runExternalCode"],
      {
        encoding: "utf8",
      },
    ),
    "",
  );
});

test("native TS7 definitions, getters, unsaved source edits and invalid source diagnostics", async (t) => {
  const root = fixture(t);
  const source =
    "// 🦀 café\r\n" +
    readFileSync("examples/Counter.sol", "utf8").replaceAll("\n", "\r\n");
  writeFileSync(join(root, "Counter.sol"), source);
  const text = `import { Counter } from './Counter.sol';\nimport {createPublicClient, getContract, http} from 'viem';\nconst client = createPublicClient({transport: http()});\nconst c = getContract({abi: Counter, address:'0x0000000000000000000000000000000000000001', client});\nexport const n = c.read.number();\nexport const abi = Counter;\nexport const getterName = Counter[1].name;\n`;
  writeFileSync(join(root, "main.ts"), text);
  const lsp = server(root);
  try {
    await lsp.initialize();
    const uri = pathToFileURL(join(root, "main.ts")).href;
    const sourceUri = pathToFileURL(join(root, "Counter.sol")).href;
    lsp.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "typescript", version: 1, text },
    });
    const hover = () =>
      lsp.request("textDocument/hover", {
        textDocument: { uri },
        position: position(text, "n ="),
      });
    await eventually(hover, (h) =>
      h?.contents?.value.includes("Promise<bigint>"),
    );
    const definition = await lsp.request("textDocument/definition", {
      textDocument: { uri },
      position: position(text, "abi = Counter", 6),
    });
    assert.equal(definition[0].targetUri, sourceUri);
    assert.deepEqual(
      definition[0].targetSelectionRange.start,
      position(source, "contract Counter", 9),
    );
    const viem = await lsp.request("textDocument/definition", {
      textDocument: { uri },
      position: position(text, "read.number", 5),
    });
    console.info(
      `viem read.number definition targets: ${JSON.stringify(viem)}`,
    );
    const getter = await lsp.request("textDocument/definition", {
      textDocument: { uri },
      position: position(text, "Counter[1].name", 11),
    });
    assert.ok(
      getter.some((d) => d.targetUri === sourceUri),
      JSON.stringify(getter),
    );
    assert.ok(
      getter.some(
        (d) =>
          JSON.stringify(d.targetSelectionRange.start) ===
          JSON.stringify(position(source, "public number", 7)),
      ),
      JSON.stringify(getter),
    );
    lsp.notify("textDocument/didOpen", {
      textDocument: {
        uri: sourceUri,
        languageId: "solidity",
        version: 1,
        text: source,
      },
    });
    const changed = source.replaceAll("uint256", "uint8");
    lsp.notify("textDocument/didChange", {
      textDocument: { uri: sourceUri, version: 2 },
      contentChanges: [{ text: changed }],
    });
    await eventually(hover, (h) =>
      h?.contents?.value.includes("Promise<number>"),
    );
    assert.match(
      readFileSync(join(root, "Counter.sol"), "utf8"),
      /uint256 public number/,
    );
    lsp.notify("textDocument/didChange", {
      textDocument: { uri: sourceUri, version: 3 },
      contentChanges: [{ text: "contract Counter { broken" }],
    });
    const diagnostics = () =>
      lsp.request("textDocument/diagnostic", {
        textDocument: { uri: sourceUri },
      });
    await eventually(diagnostics, (d) =>
      d?.items?.some((x) => x.severity === 1),
    );
  } finally {
    await lsp.close();
  }
});

test("native TS7 refreshes saved dependencies and newly created imports without touching the entry", async (t) => {
  const root = fixture(t);
  const base = join(root, "Base.sol");
  writeFileSync(
    base,
    "pragma solidity ^0.8.13; interface Base { function value() external view returns (uint256); }",
  );
  const source =
    'pragma solidity ^0.8.13; import {Base} from "./Base.sol"; interface Entry is Base {}';
  writeFileSync(join(root, "Entry.sol"), source);
  const text = `import {Entry} from './Entry.sol';\nimport {getContract,createPublicClient,http} from 'viem';\nconst c = getContract({abi:Entry,address:'0x0000000000000000000000000000000000000001',client:createPublicClient({transport:http()})});\nexport const value = c.read.value();\nexport const inherited = Entry[0].name;\n`;
  writeFileSync(join(root, "main.ts"), text);
  const lsp = server(root);
  try {
    await lsp.initialize();
    const uri = pathToFileURL(join(root, "main.ts")).href;
    lsp.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "typescript", version: 1, text },
    });
    const hover = () =>
      lsp.request("textDocument/hover", {
        textDocument: { uri },
        position: position(text, "value ="),
      });
    await eventually(hover, (h) =>
      h?.contents?.value.includes("Promise<bigint>"),
    );
    const inherited = await lsp.request("textDocument/definition", {
      textDocument: { uri },
      position: position(text, "Entry[0].name", 10),
    });
    assert.equal(
      inherited[0].targetUri,
      pathToFileURL(join(root, "Entry.sol")).href,
    );
    assert.deepEqual(
      inherited[0].targetSelectionRange.start,
      position(source, "interface Entry", 10),
    );
    writeFileSync(
      base,
      "pragma solidity ^0.8.13; interface Base { function value() external view returns (uint8); }",
    );
    await eventually(hover, (h) =>
      h?.contents?.value.includes("Promise<number>"),
    );
    writeFileSync(
      base,
      'pragma solidity ^0.8.13; import {New} from "./New.sol"; interface Base is New {}',
    );
    await eventually(
      () =>
        lsp.request("textDocument/diagnostic", {
          textDocument: { uri: pathToFileURL(join(root, "Entry.sol")).href },
        }),
      (d) => d?.items?.some((x) => x.severity === 1),
    );
    writeFileSync(
      join(root, "New.sol"),
      "pragma solidity ^0.8.13; interface New { function value() external view returns (bool); }",
    );
    await eventually(hover, (h) =>
      h?.contents?.value.includes("Promise<boolean>"),
    );
    assert.equal(readFileSync(join(root, "Entry.sol"), "utf8"), source);
  } finally {
    await lsp.close();
  }
});
