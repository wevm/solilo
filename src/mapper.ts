import { dirname, join, resolve } from "node:path";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { tmpdir } from "node:os";
import { compile } from "./index.js";
import { project, watchProject, type Project } from "./project.js";
import type { Contract } from "./engine.js";
import type { AbiParameter } from "abitype";

interface State {
  config: Project;
  close(): void;
}
const projects = new Map<string, State>();

function parameterType(param: AbiParameter): string {
  return "components" in param
    ? `(${param.components.map(parameterType).join(",")})${param.type.slice(5)}`
    : param.type;
}

function render(contracts: Contract[]) {
  let text = "";
  const mappings: number[][] = [];
  const append = (chunk: string, start: number, end: number) => {
    mappings.push([
      Buffer.byteLength(text),
      Buffer.byteLength(chunk),
      start,
      end - start,
      1,
      8 | 16,
    ]);
    text += chunk;
  };
  for (const [i, contract] of contracts.entries()) {
    append(`const abi${i} = [\n`, contract.start, contract.end);
    for (const item of contract.abi) {
      const signature =
        "name" in item
          ? `${item.name}(${item.inputs.map(parameterType).join(",")})`
          : "";
      const loc =
        contract.members.find((m) => m.signature === signature) ?? contract;
      append(`  ${JSON.stringify(item)},\n`, loc.start, loc.end);
    }
    append(
      `] as const;\nexport { abi${i} as ${JSON.stringify(contract.name)} };\n`,
      contract.start,
      contract.end,
    );
  }
  return { text: text || "export {};\n", mappings };
}

// TS watches a fixed set of paths. A private sentinel also catches files created after openProject.
// It contains only a content fingerprint, never generated bindings or source text.
function watchState(config: Project) {
  const dir = mkdtempSync(join(tmpdir(), "solilo-watch-"));
  const sentinel = join(dir, "identity");
  const initial = watchProject(config);
  let identity = initial.configIdentity;
  writeFileSync(sentinel, identity);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchers: FSWatcher[] = [];
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = watchProject(config).configIdentity;
      if (next !== identity) {
        identity = next;
        writeFileSync(sentinel, identity);
      }
    }, 50);
  };
  for (const root of new Set(config.allowed)) {
    if (existsSync(root))
      watchers.push(
        watch(root, { recursive: true, persistent: false }, refresh),
      );
  }
  return {
    ...initial,
    watchedFiles: [...initial.watchedFiles, sentinel],
    close() {
      clearTimeout(timer);
      for (const w of watchers) w.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const handlers: Record<string, (params: any) => unknown> = {
  initialize() {
    return {
      protocolVersion: 1,
      positionEncoding: "utf-8",
      diagnosticSource: "solilo",
    };
  },
  openProject(p: {
    projectHandle: string;
    configFileName: string;
    options?: Record<string, unknown>;
  }) {
    const config = project(dirname(p.configFileName));
    const watched = watchState(config);
    projects.set(p.projectHandle, { config, close: watched.close });
    return {
      watchedFiles: watched.watchedFiles,
      configIdentity: watched.configIdentity,
      optionDiagnostics: Object.keys(p.options ?? {}).map((key) => ({
        path: [key],
        code: 1,
        messageText:
          "Use solilo.json or Foundry effective configuration, not mapper options.",
      })),
    };
  },
  transform(p: { fileName: string; content: string; projectHandle: string }) {
    const size = Buffer.byteLength(p.content);
    try {
      const state = projects.get(p.projectHandle);
      if (!state)
        throw new Error(
          "Missing mapper project; restart the TypeScript server",
        );
      const result = compile(p.fileName, p.content, state.config);
      const diagnostics = result.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => {
          const loc = d.sourceLocation;
          const sameFile =
            loc && resolve(state.config.root, loc.file) === resolve(p.fileName);
          const start = sameFile ? Math.min(loc.start, size) : 0;
          return {
            code: Number(d.errorCode) || 1,
            messageText:
              sameFile || !loc ? d.message : `${loc.file}: ${d.message}`,
            start,
            length: sameFile
              ? Math.max(0, Math.min(loc.end, size) - start)
              : Math.min(size, 1),
          };
        });
      // Invalid input drops old types immediately; no stale ABI can masquerade as fresh.
      return { extension: ".ts", ...render(result.contracts), diagnostics };
    } catch (error) {
      return {
        extension: ".ts",
        text: "export {};\n",
        mappings: [],
        diagnostics: [
          {
            code: 1,
            messageText: String(error),
            start: 0,
            length: Math.min(size, 1),
          },
        ],
      };
    }
  },
  closeProject(p: { projectHandle: string }) {
    projects.get(p.projectHandle)?.close();
    projects.delete(p.projectHandle);
    return {};
  },
};

// JSON-RPC 2.0 with LSP Content-Length framing. stdout is protocol-only.
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) break;
    const length = Number(
      /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1],
    );
    if (!Number.isSafeInteger(length) || length < 0)
      throw new Error("Invalid mapper frame");
    if (buffer.length < end + 4 + length) break;
    const message = JSON.parse(
      buffer.subarray(end + 4, end + 4 + length).toString(),
    );
    buffer = buffer.subarray(end + 4 + length);
    let response;
    try {
      const handler = handlers[message.method];
      if (!handler) throw new Error(`Unknown method: ${message.method}`);
      response = {
        jsonrpc: "2.0",
        id: message.id,
        result: handler(message.params) ?? {},
      };
    } catch (error) {
      response = {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: String(error) },
      };
    }
    if (message.id === undefined) continue;
    const body = Buffer.from(JSON.stringify(response));
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
  }
});
process.stdin.on("end", () => {
  for (const p of projects.values()) p.close();
  process.exit(0);
});
