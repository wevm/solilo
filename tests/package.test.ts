import { onTestFinished, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  copyFileSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

test.each(["npm", "pnpm"])(
  "packed package installs offline with %s and works in Node, Bun, Vite, Vitest and TS7 without a toolchain",
  (manager) => {
    const root = mkdtempSync(join(tmpdir(), "solilo-packed-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const packed: { filename: string; files: { path: string }[] } = JSON.parse(
      execFileSync(
        "pnpm",
        ["pack", "--json", "--out", join(root, "solilo.tgz")],
        {
          encoding: "utf8",
          env: { ...process.env, npm_config_ignore_scripts: "true" },
        },
      ),
    );
    assert.ok(packed);
    assert.ok(packed.files.some((f) => f.path === "dist/engine.wasm"));
    assert.ok(packed.files.some((f) => f.path === "THIRD_PARTY_NOTICES.md"));
    assert.ok(
      !packed.files.some((f) =>
        /(?:target\/|\.rs$|solc|\.node$|\.test\.)/.test(f.path),
      ),
    );
    const dependencies = Object.fromEntries(
      ["viem", "vitest"].map((name) => [
        name,
        JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8"))
          .version,
      ]),
    );
    // Test ordinary Vite consumers too, independently of our Vite+ development alias.
    dependencies.vite = "8.3.5";
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        type: "module",
        packageManager: JSON.parse(readFileSync("package.json", "utf8"))
          .packageManager,
        dependencies: {
          ...dependencies,
          solilo: `file:./${basename(packed.filename)}`,
        },
      }),
    );
    // Warm each consumer's cache, then require a frozen offline reinstall.
    // Keep npm consumer coverage independent of the repository's pnpm layout.
    const installArgs =
      manager === "npm"
        ? ["--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund"]
        : ["--ignore-scripts", "--config.auto-install-peers=false"];
    execFileSync(manager, ["install", ...installArgs], {
      cwd: root,
      encoding: "utf8",
    });
    rmSync(join(root, "node_modules"), { recursive: true, force: true });
    execFileSync(
      manager,
      manager === "npm"
        ? ["ci", "--offline", ...installArgs]
        : ["install", "--offline", "--frozen-lockfile", ...installArgs],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    const bin = join(root, "bin");
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, "node"));
    symlinkSync(
      execFileSync("bun", ["-p", "process.execPath"], {
        encoding: "utf8",
      }).trim(),
      join(bin, "bun"),
    );
    const env = { ...process.env, PATH: bin };
    copyFileSync("examples/Counter.sol", join(root, "Counter.sol"));
    copyFileSync("examples/tip20.rs", join(root, "tip20.rs"));
    copyFileSync("examples/tsconfig.json", join(root, "tsconfig.json"));
    writeFileSync(
      join(root, "main.ts"),
      `import {Counter} from './Counter.sol'; import {ITIP20,IRolesAuth} from './tip20.rs'; export const names = Counter.map(i=>i.name); export const sizes = [ITIP20.length,IRolesAuth.length]; console.log(JSON.stringify({names,sizes}));`,
    );
    const expected = {
      names: ["increment", "number", "setNumber"],
      sizes: [83, 9],
    };
    for (const [runtime, args] of [
      [process.execPath, ["--import", "solilo/register", "main.ts"]],
      ["bun", ["--preload", "solilo/register", "main.ts"]],
    ] as const) {
      assert.deepEqual(
        JSON.parse(
          execFileSync(runtime, args, { cwd: root, encoding: "utf8", env }),
        ),
        expected,
      );
    }
    assert.equal(
      execFileSync(
        process.execPath,
        [
          resolve("node_modules/typescript/bin/tsc"),
          "-p",
          root,
          "--runExternalCode",
        ],
        {
          encoding: "utf8",
          env,
        },
      ),
      "",
    );
    writeFileSync(
      join(root, "vite.config.mjs"),
      `import solilo from 'solilo/vite'; export default {plugins:[solilo()],build:{lib:{entry:'main.ts',formats:['es'],fileName:'bundle'}}};`,
    );
    execFileSync(
      process.execPath,
      [join(root, "node_modules/vite/bin/vite.js"), "build"],
      {
        cwd: root,
        encoding: "utf8",
        env,
      },
    );
    const bundle = readFileSync(join(root, "dist/bundle.js"), "utf8");
    assert.doesNotMatch(bundle, /WebAssembly|readFileSync|solilo\/register/);
    assert.deepEqual(
      JSON.parse(
        execFileSync(process.execPath, ["dist/bundle.js"], {
          cwd: root,
          encoding: "utf8",
          env,
        }),
      ),
      expected,
    );
    writeFileSync(
      join(root, "abi.test.ts"),
      `import {expect,test} from 'vitest'; import {Counter} from './Counter.sol'; test('ABI array',()=>expect(Counter.map(x=>x.name)).toEqual(['increment','number','setNumber']));`,
    );
    const output = execFileSync(
      process.execPath,
      [join(root, "node_modules/vitest/vitest.mjs"), "run", "abi.test.ts"],
      {
        cwd: root,
        encoding: "utf8",
        env,
      },
    );
    assert.match(output, /1 passed/);
  },
);
