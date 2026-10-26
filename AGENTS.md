# solilo

This repository contains one npm package. `src/` owns host loading, configuration,
caching, mapper and runtime adapters. `bridge/` owns Rust token extraction and
Solar semantic analysis. Solar is pinned in Cargo.toml; never add a solc fallback.
`tests/oracle/` uses Alloy only as an independent test oracle.

Run `pnpm run build` after bridge changes, then `pnpm run check`,
`pnpm run check:types`, `pnpm run test:types`, and `pnpm test` (Vitest via Vite+).
Source `$HOME/.cargo/env` if needed. Tests start and stop a disposable Anvil;
they use no shared chain or secrets.
Tests must exercise the built package, and packaging tests install the tarball
offline. Build output belongs in ignored `dist/` and `target/`, not source files.
Write tests in TypeScript. Colocate module tests as `src/<module>.test.ts`;
keep package-wide, editor, chain, and independent-oracle integration tests in
`tests/`. `pnpm run check:types` checks both source and tests. Test files must not
be emitted into `dist/` or included in the npm package.

Preserve the direct-import API: named readonly ABI arrays, no generated clients,
default export, hidden downloads, or runtime compiler in browser bundles.
Treat unsupported Rust/Cargo expansion and incompatible Solidity pragmas as errors.
Never infer ABI from storage macros. Source mappings use original UTF-8 byte offsets.

Use `pnpm run format` (Oxfmt) and `pnpm run lint` (Oxlint), configured in
`vite.config.ts`. Use `cargo fmt` for Rust. `pnpm install --frozen-lockfile` recreates ignored
`.vite-hooks/` locally; the pre-commit hook runs `vp staged`.
Keep examples, README, and license notices current.
Publishing, remote creation, and pushing require separate user authorization.
