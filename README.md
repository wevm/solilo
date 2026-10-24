# solilo

Import Solidity contracts and literal Alloy Rust interfaces as **readonly, literal ABI arrays**. Use the arrays with viem, ox, or abitype; there is no generated client or user-maintained bindings file.

```ts
import { getContract } from "viem";
import { Counter } from "./Counter.sol";

const counter = getContract({ abi: Counter, address, client });
const number = await counter.read.number(); // bigint
await counter.write.setNumber([42n]);
```

```ts
import { ITIP20, IRolesAuth } from "./tip20.rs";

// Separate exports; compose only when that is the interface you want.
const combined = [...ITIP20, ...IRolesAuth] as const;
```

This is an initial local package, **not an npm publication**. The npm tarball includes the analysis engine. Consumers need Node 24.22.1+ for tooling, but not Rust, solc, native libraries, or a postinstall download. Browser bundles contain ordinary ABI arrays, not the compiler.

## Install and enable TypeScript

```sh
npm install ./solilo-0.1.0.tgz viem
npm install --save-dev --legacy-peer-deps typescript@7.1.0-dev.20261023.1
```

Content mapping requires TypeScript **7.1+**, not TypeScript 7.0 or tsserver plugins. This repository pins the verified nightly; upstream peer ranges such as `>=5` do not accept prereleases, hence `--legacy-peer-deps` for this nightly.

Use a patched Node release: the pinned TypeScript launcher's `process.execve` call loses its environment on Node 24.0.0, preventing mapper startup. Node 24.22.1 and 26.12.1 pass the complete suite.

Add to your `tsconfig.json`:

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

Run `tsc --noEmit --runExternalCode`. Content mappers execute code with your tooling process's privileges; enable this only for packages you trust. No wildcard `.sol` declarations or generated `.d.ts` files are needed.

### VS Code

Install Microsoft's **TypeScript 7** extension (`TypeScriptTeam.native-preview`). Trust your workspace and allow its TypeScript/content-mapper prompts. Relevant settings:

```json
{
  "js/ts.experimental.useTsgo": true,
  "js/ts.tsdk.path": "./node_modules/typescript",
  "js/ts.contentMappers.enabled": true
}
```

Select/allow the workspace compiler and check the TypeScript 7 output channel: it must resolve to the installed 7.1 compiler, not the extension's bundled 7.0. Verified with VS Code 1.143.1, TypeScript 7 extension 1.0.1, and the pinned nightly.

- Unsaved edits to the **directly imported source file** update its types and diagnostics. Dependencies are read from disk; save dependency edits first.
- Invalid sources immediately lose their old exports and produce diagnostics. solilo does not present stale types as valid. Runtime transforms/builds fail on invalid source.
- Definitions of ABI exports and ABI-item properties map to same-file declarations, including public-variable getters and individual overloads. Inherited members map to the importing contract's name.
- **viem's computed `counter.read.number` property currently returns no definition target**, although its type is precise. Arbitrary `functionName: 'transfer'` strings have no navigation promise. No cross-language rename or references are provided.
- The editor watches source roots, config files, and a private temporary fingerprint sentinel for newly created imports. It creates no bindings in your project. Changes to environment variables require restarting tooling.

## Runtime integrations

TypeScript's mapper supplies types; choose an adapter for execution:

```sh
node --import solilo/register app.ts
bun --preload solilo/register app.ts
```

Node and Bun retain their normal module-instance caches. Restart the process to reload an already imported runtime module. Vite invalidates affected modules when saved dependencies change.

```ts
// vite.config.ts or vitest.config.ts
import { defineConfig } from "vite";
import solilo from "solilo/vite";

export default defineConfig({ plugins: [solilo()] });
```

No default ABI export, wrapper client, deployment helper, or browser-side WASM loader is added. The `solilo` entrypoint also exports `compile(file, content?)` for tools that need ABI arrays, byte-offset declaration locations, diagnostics, and dependency paths. `content` overlays only that file.

## Source resolution and supported language

For Foundry projects, solilo calls **`forge config --json`** to read effective profiles, environment overrides, remappings, and library paths. Foundry users therefore need `forge` on PATH. This does not build the contracts or select Foundry's solc version. Standalone projects need no Foundry installation.

The nearest `foundry.toml`, `solilo.json`, or `package.json` establishes the project root. Optional standalone overrides in `solilo.json`:

```json
{
  "remappings": ["@contracts/=lib/contracts/"],
  "includePaths": ["node_modules"]
}
```

These replace the corresponding Foundry fields when present. Imports are resolved by Solar, not a second Solidity parser. The host loads only requested files within the project, include paths, or explicit remapping targets, checking real paths to prevent symlink escapes. Compiler import-normalization differences from solc still apply. Dependency caches hash content, including missing import probes; there is no persisted ABI cache to go stale.

### Solidity

The only analyzer is Solar, pinned to [`7db9ef11507b1848cc1f1a117ef6337bf1957968`](https://github.com/paradigmxyz/solar/commit/7db9ef11507b1848cc1f1a117ef6337bf1957968) with solilo's release. It checks pragmas against Solidity 0.8.38. **Incompatible pragmas and `abicoder v1` are errors**, even though upstream Solar treats them as warnings. Optimizer/code-generation settings are irrelevant to this ABI extraction.

This is Solar semantic analysis, **not a promise of equivalence to your pinned solc compiler**. There is no silent fallback. See [Solar's documented divergences](https://github.com/paradigmxyz/solar/blob/7db9ef11507b1848cc1f1a117ef6337bf1957968/docs/SOLC_DIVERGENCE.md). ABI output includes public functions/getters, events, errors, constructors, fallback/receive entries, and tuple/type information. It says nothing about deployed code, storage layout, chain availability, hardfork activation, or implementation behavior.

### Rust / Alloy

Supported macro-item spellings are `sol!`, `alloy_sol_types::sol!`, and Tempo-style `crate::sol!`. Their literal bodies must contain Solidity-compatible interfaces and local types. The Rust file is parsed, but never compiled or macro-expanded. Each invocation is analyzed independently; duplicate export names across invocations are diagnosed.

Allowlisted body attributes are `doc`, `derive`, `allow`, and `sol(abi)`. They are blanked without changing byte offsets, preserving Unicode/CRLF navigation. Conditional declarations, ambiguous aliases, local `sol!` redefinitions, other semantic attributes, file/JSON/string inputs, `include!`/`concat!`, external Rust types, missing Solidity data locations, unsupported Alloy syntax, and Cargo feature-dependent expansion are not supported. Macro templates, strings, and arbitrary nested macro arguments are not treated as active interfaces. No support for arbitrary `#[contract]` frameworks is implied: Tempo's `#[contract]` describes storage, not its ABI.

`examples/tip20.rs` is a pinned Tempo source fixture. `ITIP20` and `IRolesAuth` remain separate. Its ABI is checked against real Alloy expansion; there is no live Tempo-chain requirement. ABI parity ignores `internalType` metadata but checks signatures, mutability, tuple components, events, and errors.

## Build and verify locally

Maintainers need Rust 1.98.0 with `wasm32-unknown-unknown`, Node 24.22.1+, npm, and Bun. The pinned toolchain and lockfiles make engine builds repeatable. On an Amp orb, `.agents/setup` installs prerequisites and builds; it does not publish or start services.

```sh
source "$HOME/.cargo/env" # if rustup is not already on PATH
npm ci
npm run build
npm run check
npm run check:types
npm run test:types
npm test
npm pack
```

Vite+ owns the development toolchain in `vite.config.ts`: `npm test` runs Vitest,
`npm run check` checks Oxfmt formatting and Oxlint rules without changing files,
`npm run format` applies formatting, and `npm run lint` runs Oxlint alone.
Type checks stay on the pinned TypeScript 7.1 compiler so the content mapper is exercised.

On a local Git checkout, `npm ci` installs the Vite+ hook dispatcher and recreates
`.vite-hooks/pre-commit`, which runs `vp staged`. The entire `.vite-hooks/` directory
is ignored; hook policy lives in `scripts/prepare.mjs` and `vite.config.ts`.
Run `npm run staged` manually or `npm exec -- vp hooks status` to inspect the setup.
CI and `VP_GIT_HOOKS=0` skip hook setup. Hooks are development-only and are not shipped.

The build compiles the solilo-owned bridge against Solar's public semantic APIs and copies it into `dist/engine.wasm`. The bridge uses explicit length-delimited JSON allocation/analyze/free exports, no wasm-bindgen, and no host filesystem imports. The JS host discards trapped WASM instances instead of reusing possibly damaged compiler state. `npm pack` builds first; the resulting package never builds at installation time.

Tests cover solc ABI parity, Alloy TIP20 parity, viem inference and negative typing, native TS7 navigation/unsaved edits/saved dependency changes/new imports, Unicode/CRLF offsets, stale rejection, realpath boundaries, a deployed Counter on disposable Anvil, repeated WASM analysis and stable memory, Vite dependency refresh, and offline packed-package Node/Bun/Vite/Vitest/TS7 usage. solc, Alloy, forge, and Anvil are development/oracle tools only; none is shipped in the npm package.

The packed-package test first installs its consumer dependencies to warm the npm cache, deletes the consumer's `node_modules`, then reinstalls with `npm ci --offline --ignore-scripts`. Runtime checks have only Node and Bun on PATH. The test also checks that browser output contains arrays rather than a compiler. Validation currently covers Linux; macOS/Windows have not been independently verified.

GitHub Actions runs the reusable Verify workflow on pull requests and pushes to `main`, with manual runs available. Both Node 24.22.1 and 26.12.1 build the WASM engine, check Oxfmt/Oxlint, Rust formatting and TypeScript, audit npm dependencies, and run the full Vitest suite. Actions are SHA-pinned with monthly Dependabot updates; jobs use read-only repository permissions and require no secrets. CI does not publish packages or deploy anything.

`scripts/notices.mjs` regenerates third-party notices from the locked WASM build graph. It may fetch pinned upstream license text when a crate archive omits it; this is a maintainer action, never an install hook. Rust's standard-library notices are also included. See `THIRD_PARTY_NOTICES.md` and `licenses/`.
