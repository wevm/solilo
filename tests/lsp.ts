import { spawn } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  ConfigurationParams,
  DidChangeWatchedFilesRegistrationOptions,
  RegistrationParams,
  UnregistrationParams,
} from "vscode-languageserver-protocol";

type Message = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

/** Native TS7 LSP, with the same protocol and watched-file notifications VS Code uses. */
export function server(root: string) {
  const child = spawn(
    fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url)),
    ["--lsp", "--stdio"],
    { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
  );
  const pending = new Map<
      number,
      {
        resolve(value: unknown): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
    watchers = new Map<string, FSWatcher[]>();
  let buffer = Buffer.alloc(0),
    id = 0,
    stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  function write(message: Message) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    child.stdin.write(body);
  }
  function notify(method: string, params: unknown) {
    write({ method, params });
  }
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = Number(
        /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())![1],
      );
      if (buffer.length < end + 4 + length) return;
      const message: Message = JSON.parse(
        buffer.subarray(end + 4, end + 4 + length).toString(),
      );
      buffer = buffer.subarray(end + 4 + length);
      if (message.method && message.id !== undefined) {
        if (message.method === "client/registerCapability") {
          for (const registration of (message.params as RegistrationParams)
            .registrations) {
            const list: FSWatcher[] = [];
            const options = registration.registerOptions as
              | DidChangeWatchedFilesRegistrationOptions
              | undefined;
            for (const item of options?.watchers ?? []) {
              const pattern = item.globPattern;
              // Exact files from the mapper (including its new-file sentinel).
              if (typeof pattern !== "string" || /[*?{}]/.test(pattern))
                continue;
              try {
                list.push(
                  watch(pattern, () =>
                    notify("workspace/didChangeWatchedFiles", {
                      changes: [{ uri: pathToFileURL(pattern).href, type: 2 }],
                    }),
                  ),
                );
              } catch {}
            }
            watchers.set(registration.id, list);
          }
        }
        if (message.method === "client/unregisterCapability") {
          for (const reg of (message.params as UnregistrationParams)
            .unregisterations ?? []) {
            for (const watcher of watchers.get(reg.id) ?? []) watcher.close();
            watchers.delete(reg.id);
          }
        }
        write({
          id: message.id,
          result:
            message.method === "workspace/configuration"
              ? (message.params as ConfigurationParams).items.map(() => null)
              : null,
        });
      } else if (message.id !== undefined) {
        const entry = pending.get(message.id);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(message.id);
          if (message.error)
            entry.reject(new Error(JSON.stringify(message.error)));
          else entry.resolve(message.result);
        }
      }
    }
  });
  function request<T = unknown>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => {
        pending.delete(key);
        reject(new Error(`${method} timed out: ${stderr}`));
      }, 20000);
      pending.set(key, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      write({ id: key, method, params });
    });
  }
  return {
    request,
    notify,
    async initialize() {
      await request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(root).href,
        initializationOptions: { runExternalCode: true },
        capabilities: {
          textDocument: {
            definition: { linkSupport: true },
            hover: { contentFormat: ["markdown"] },
          },
          workspace: {
            didChangeWatchedFiles: {
              dynamicRegistration: true,
              relativePatternSupport: false,
            },
          },
        },
      });
      notify("initialized", {});
    },
    async close() {
      for (const list of watchers.values())
        for (const watcher of list) watcher.close();
      await request("shutdown", undefined);
      notify("exit", undefined);
      await new Promise((resolve) => child.once("exit", resolve));
    },
  };
}

export function position(text: string, needle: string, offset = 0) {
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`Missing ${needle}`);
  const lines = text.slice(0, index + offset).split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}

export async function eventually<T>(
  fn: () => T | Promise<T>,
  predicate: (value: T) => boolean | undefined,
) {
  let value: T | undefined;
  for (let i = 0; i < 80; i++) {
    value = await fn();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition not reached: ${JSON.stringify(value)}`);
}
