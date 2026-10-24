# solilo

This repository contains one npm package. `src/` owns host loading, configuration,
caching, mapper and runtime adapters. `bridge/` owns Rust token extraction and
Solar semantic analysis. Solar is pinned in Cargo.toml; never add a solc fallback.
`tests/oracle/` uses Alloy only as an independent test oracle.

Run `npm run build` after bridge changes, then `npm run check`,
`npm run test:types`, and `npm test`. Source `$HOME/.cargo/env` if needed.
`npm test` starts and stops a disposable Anvil; it uses no shared chain or secrets.
Tests must exercise the built package, and packaging tests install the tarball
offline. Build output belongs in ignored `dist/` and `target/`, not source files.

Preserve the direct-import API: named readonly ABI arrays, no generated clients,
default export, hidden downloads, or runtime compiler in browser bundles.
Treat unsupported Rust/Cargo expansion and incompatible Solidity pragmas as errors.
Never infer ABI from storage macros. Source mappings use original UTF-8 byte offsets.

Use `cargo fmt` for Rust. Keep examples, README, and license notices current.
Publishing, remote creation, and pushing require separate user authorization.
