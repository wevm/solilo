# solilo

Import Solidity contracts and literal Alloy Rust interfaces as typed ABI arrays.
Use them with viem, ox, or abitype—no generated bindings or wrapper clients.

```ts
import { getContract } from "viem";
import { Counter } from "./Counter.sol";

const counter = getContract({ abi: Counter, address, client });
await counter.read.number(); // bigint
await counter.write.setNumber([42n]);
```

Rust interfaces work the same way: `import { ITIP20 } from './tip20.rs'`.

## Install

Requires Node **24.22.1+** and TypeScript **7.1+**. The initial 0.0.1 release is
being prepared; once published, install from the npm registry:

```sh
pnpm add -D solilo typescript@7.1.0-dev.20261023.1
pnpm add viem
```

The package includes its WASM compiler. No Rust, solc, or postinstall downloads
are needed. Keep solilo as a regular dependency if production uses its Node/Bun
runtime adapter.

Add to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "nodenext",
    "strict": true,
    "noEmit": true
  },
  "contentMappers": [{ "package": "solilo", "extensions": [".sol", ".rs"] }]
}
```

Run `pnpm exec tsc --runExternalCode`. Content mappers execute code with your
tooling process's privileges; enable only packages you trust.

For VS Code, install Microsoft's **TypeScript 7** extension
(`TypeScriptTeam.native-preview`), trust the workspace, allow its mapper prompts,
and select the workspace compiler:

```json
{
  "js/ts.experimental.useTsgo": true,
  "js/ts.tsdk.path": "./node_modules/typescript",
  "js/ts.contentMappers.enabled": true
}
```

The extension must use the installed 7.1 compiler, not its bundled 7.0.

## Runtime

Choose an adapter alongside TypeScript's type checking:

```sh
node --import solilo/register app.ts
bun --preload solilo/register app.ts
```

For Vite or Vitest:

```ts
import { defineConfig } from "vite";
import solilo from "solilo/vite";

export default defineConfig({ plugins: [solilo()] });
```

Browser bundles contain ordinary ABI arrays, not the compiler.

## Scope

- Solidity uses a pinned [Solar](https://github.com/paradigmxyz/solar) compiler,
  not your project's solc. Incompatible pragmas and `abicoder v1` are rejected.
- Foundry projects use `forge config --json` for layout and remappings and need
  `forge` on PATH. Standalone projects do not. Optional `solilo.json` fields are
  `remappings: string[]` and `includePaths: string[]`.
- Rust supports literal Solidity-compatible interfaces in `sol!`,
  `alloy_sol_types::sol!`, and `crate::sol!`. No Cargo compilation, conditional
  expansion, external macro inputs, or arbitrary `#[contract]` frameworks.
- Unsaved edits work for directly imported files; save dependency edits first.
  Invalid source fails instead of retaining valid-looking stale exports.
- Same-file ABI declarations support navigation; inherited members point to the
  importing contract. viem's computed `counter.read.number` is typed but has no
  definition target. Cross-language rename/references are not supported.
- ABI extraction only: no storage layout, deployment, or chain-availability
  guarantees. Experimental; validated on Linux, not yet macOS/Windows.

See [examples](examples) for Counter and Tempo interfaces,
[contributor guidance](AGENTS.md) for build/test commands, and the
[release guide](.changeset/README.md) for Changesets and manual trusted publishing.
PRs and `main` receive **pkg.pr.new previews**, separate from npm releases; copy
the install URL from the successful workflow log or PR comment. The
[pkg.pr.new App](https://github.com/apps/pkg-pr-new) must be enabled for this repo.
