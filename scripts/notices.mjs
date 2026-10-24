// Maintainer-only license collection. Network is used only when crate archives omit their license.
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--filter-platform",
      "wasm32-unknown-unknown",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  ),
);
const tree = execFileSync(
  "cargo",
  [
    "tree",
    "--locked",
    "--target",
    "wasm32-unknown-unknown",
    "-e",
    "normal,build",
    "--prefix",
    "none",
    "--format",
    "{p}",
  ],
  { encoding: "utf8" },
);
const used = new Set(
  tree.split("\n").map((line) => line.split(" ").slice(0, 2).join(" ")),
);
let output =
  "# Third-party notices\n\nGenerated from Cargo.lock and the pinned WASM build graph (including build dependencies).\n\nSolar is MIT OR Apache-2.0. No libsolc C header or compiler fork is included.\n\nRust standard-library notices and their license texts are in `licenses/rust/`.\n\n";
const fetched = new Map();
for (const pkg of metadata.packages
  .filter(
    (p) => p.name !== "solilo-bridge" && used.has(`${p.name} v${p.version}`),
  )
  .sort((a, b) => a.name.localeCompare(b.name))) {
  let dir = dirname(pkg.manifest_path);
  const local = [];
  for (
    let depth = 0;
    depth < (pkg.name.startsWith("solar-") ? 3 : 1);
    depth++, dir = dirname(dir)
  ) {
    for (const name of readdirSync(dir).filter((n) =>
      /^(licen[sc]e|copying|notice|unlicense)([._-]|$)/i.test(n),
    )) {
      const file = join(dir, name);
      if (statSync(file).isFile())
        local.push([name, readFileSync(file, "utf8")]);
    }
    if (local.length) break;
  }
  if (!local.length) {
    const vcs = JSON.parse(
      readFileSync(
        join(dirname(pkg.manifest_path), ".cargo_vcs_info.json"),
        "utf8",
      ),
    );
    const repo = pkg.repository
      .replace(/\/$/, "")
      .replace(/\.git$/, "")
      .replace("https://github.com/", "");
    for (const filename of [
      "LICENSE-MIT",
      "LICENSE",
      "LICENSE.txt",
      "LICENSE.md",
      "LICENCE-MIT",
    ]) {
      const url = `https://raw.githubusercontent.com/${repo}/${vcs.git.sha1}/${filename}`;
      let text = fetched.get(url);
      if (text === undefined) {
        const response = await fetch(url);
        text = response.ok ? await response.text() : null;
        fetched.set(url, text);
      }
      if (text) {
        local.push([url, text]);
        break;
      }
    }
  }
  if (!local.length) throw new Error(`License text missing for ${pkg.name}`);
  output += `## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license}\n\nSource: ${pkg.repository}\n\n`;
  if (pkg.authors.length) output += `Authors: ${pkg.authors.join(", ")}\n\n`;
  for (const [name, text] of local)
    output += `### ${name}\n\n\`\`\`text\n${text.trim()}\n\`\`\`\n\n`;
}
output += `## abitype 1.2.3\n\n\`\`\`text\n${readFileSync("node_modules/abitype/LICENSE", "utf8").trim()}\n\`\`\`\n\n`;
output += `## Tempo TIP20 example\n\nCopied from tempoxyz/tempo at b2cd42c125367e606d7287a63994c8077c78f8dc, crates/contracts/src/precompiles/tip20.rs.\n\n\`\`\`text\n${readFileSync("licenses/tempo-MIT.txt", "utf8").trim()}\n\`\`\`\n`;
writeFileSync("THIRD_PARTY_NOTICES.md", output);
