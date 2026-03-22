import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MemoryRepository } from "../memory/repository.js";

export type ToolExecutionContext = {
  userId: number;
  memory: MemoryRepository;
  workspaceRoot: string;
  unsafeTools: boolean;
};

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type ToolHandler = (
  context: ToolExecutionContext,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

import { firebase_master_tool } from "./firebase_tool.js";

const MAX_FILE_BYTES = 100_000;
const MAX_OUTPUT_CHARS = 12_000;
const ALLOWED_BINARIES = new Set(["node", "npm", "npx", "git", "gog", "gog.exe", "gh", "gh.exe", "n8n"]);
const ALLOWED_GIT_SUBCOMMANDS = new Set(["status", "log", "diff", "branch", "show", "push", "commit", "add"]);
const BLOCKED_DIRS = new Set(["node_modules", ".git", "dist"]);

const tools: Record<string, ToolHandler> = {
  get_current_time: async (_context, args) => {
    const timezone =
      typeof args.timezone === "string" && args.timezone.trim().length > 0
        ? args.timezone.trim()
        : "UTC";

    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("es-ES", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: timezone,
      }).format(now);

      return {
        ok: true,
        data: {
          iso: now.toISOString(),
          formatted,
          timezone,
        },
      };
    } catch {
      return {
        ok: false,
        error: `Zona horaria invalida: ${String(args.timezone ?? "")}`,
      };
    }
  },

  remember_note: async (context, args) => {
    const key = typeof args.key === "string" ? args.key.trim() : "";
    const value = typeof args.value === "string" ? args.value.trim() : "";
    if (!key || !value) {
      return { ok: false, error: "Debes enviar key y value como strings no vacios." };
    }

    if (key.length > 120 || value.length > 2000) {
      return { ok: false, error: "key/value exceden el tamano permitido." };
    }

    await context.memory.upsertNote(context.userId, key, value);
    return { ok: true, data: { key, saved: true } };
  },

  recall_note: async (context, args) => {
    const key = typeof args.key === "string" ? args.key.trim() : "";
    if (!key) {
      return { ok: false, error: "Debes enviar key como string no vacio." };
    }

    const value = await context.memory.getNote(context.userId, key);
    return {
      ok: true,
      data: {
        key,
        found: typeof value === "string",
        value: value ?? null,
      },
    };
  },

  list_notes: async (context, args) => {
    const rawLimit = Number(args.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? clamp(Math.floor(rawLimit), 1, 50) : 20;
    const notes = await context.memory.listNotes(context.userId, limit);
    return { ok: true, data: { notes } };
  },

  list_directory: async (context, args) => {
    try {
      const target = safeResolvePath(context.workspaceRoot, asPathArg(args.path));
      const entries = await fs.readdir(target, { withFileTypes: true });
      const items = entries.slice(0, 200).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : "file",
      }));
      return { ok: true, data: { path: toRelative(context.workspaceRoot, target), items } };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  },

  search_files: async (context, args) => {
    const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    if (!query) {
      return { ok: false, error: "Debes enviar query como string no vacio." };
    }

    const rawMaxDepth = Number(args.maxDepth ?? 4);
    const maxDepth = Number.isFinite(rawMaxDepth) ? clamp(Math.floor(rawMaxDepth), 1, 8) : 4;
    const rawLimit = Number(args.limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? clamp(Math.floor(rawLimit), 1, 200) : 50;
    const startDir = safeResolvePath(context.workspaceRoot, asPathArg(args.path));

    try {
      const matches = await searchByName(context.workspaceRoot, startDir, query, maxDepth, limit);
      return { ok: true, data: { matches } };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  },

  read_text_file: async (context, args) => {
    const fileArg = asPathArg(args.path);
    if (!fileArg) {
      return { ok: false, error: "Debes enviar path." };
    }

    try {
      const target = safeResolvePath(context.workspaceRoot, fileArg);
      const stat = await fs.stat(target);
      if (!stat.isFile()) {
        return { ok: false, error: "El path no es un archivo." };
      }
      if (stat.size > MAX_FILE_BYTES) {
        return { ok: false, error: `Archivo demasiado grande (${stat.size} bytes).` };
      }

      const content = await fs.readFile(target, "utf8");
      return {
        ok: true,
        data: {
          path: toRelative(context.workspaceRoot, target),
          bytes: stat.size,
          content,
        },
      };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  },

  write_text_file: async (context, args) => {
    const fileArg = asPathArg(args.path);
    const content = typeof args.content === "string" ? args.content : "";
    if (!fileArg) {
      return { ok: false, error: "Debes enviar path." };
    }
    if (content.length > MAX_FILE_BYTES) {
      return { ok: false, error: "Contenido demasiado grande." };
    }

    try {
      const target = safeResolvePath(context.workspaceRoot, fileArg);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
      return { ok: true, data: { path: toRelative(context.workspaceRoot, target), bytes: content.length } };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  },

  append_text_file: async (context, args) => {
    const fileArg = asPathArg(args.path);
    const content = typeof args.content === "string" ? args.content : "";
    if (!fileArg) {
      return { ok: false, error: "Debes enviar path." };
    }
    if (!content) {
      return { ok: false, error: "Debes enviar content no vacio." };
    }
    if (content.length > MAX_FILE_BYTES) {
      return { ok: false, error: "Contenido demasiado grande." };
    }

    try {
      const target = safeResolvePath(context.workspaceRoot, fileArg);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.appendFile(target, content, "utf8");
      return { ok: true, data: { path: toRelative(context.workspaceRoot, target), appendedBytes: content.length } };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  },

  execute_command: async (context, args) => {
    const commandText = typeof args.command === "string" ? args.command.trim() : "";
    if (!commandText) {
      return { ok: false, error: "Debes enviar command no vacio." };
    }

    const timeoutSecRaw = Number(args.timeoutSec ?? 20);
    const timeoutSec = Number.isFinite(timeoutSecRaw) ? clamp(Math.floor(timeoutSecRaw), 1, 60) : 20;
    const parsed = parseCommand(commandText);
    if (!parsed) {
      return { ok: false, error: "Comando invalido." };
    }

    const [bin, ...cmdArgs] = parsed;
    if (!bin) {
      return { ok: false, error: "Comando invalido." };
    }
    if (!context.unsafeTools) {
      if (!ALLOWED_BINARIES.has(bin)) {
        return { ok: false, error: `Binario no permitido: ${bin}` };
      }
      if (bin === "git") {
        const gitSub = cmdArgs[0] ?? "";
        if (!ALLOWED_GIT_SUBCOMMANDS.has(gitSub)) {
          return { ok: false, error: `Subcomando git no permitido: ${gitSub}` };
        }
      }
    }

    try {
      let finalBin = bin;
      // On Windows, if we are calling a local binary like gog or gh, append .exe and use local path
      if (process.platform === "win32") {
        const isLocal = ["gog", "gh"].includes(bin.toLowerCase().replace(".exe", ""));
        if (isLocal) {
          const exeName = bin.endsWith(".exe") ? bin : `${bin}.exe`;
          finalBin = path.join(context.workspaceRoot, exeName);
        }
      }

      const output = await runCommand(finalBin, cmdArgs, context.workspaceRoot, timeoutSec * 1000);
      return { ok: true, data: output };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  },

  http_get: async (_context, args) => {
    const url = typeof args.url === "string" ? args.url.trim() : "";
    if (!url.startsWith("https://")) {
      return { ok: false, error: "Solo se permiten URLs HTTPS." };
    }

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        return { ok: false, error: `Error ${resp.status}: ${await resp.text()}` };
      }
      return { ok: true, data: { text: await resp.text() } };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  },

  firebase_master: firebase_master_tool,
};

export function getToolSchema(): string {
  return JSON.stringify(
    [
      {
        name: "firebase_master",
        description: "Control total de Firebase Realtime Database (CRUD).",
        input: {
          type: "object",
          required: ["operation", "path"],
          properties: {
            operation: { enum: ["get", "set", "push", "update", "delete"] },
            path: { type: "string" },
            data: { type: "any" },
          },
        },
      },
      {
        name: "get_current_time",
        description: "Obtiene fecha y hora actual en una zona horaria.",
        input: {
          type: "object",
          properties: {
            timezone: { type: "string", description: "IANA timezone, ejemplo: Europe/Madrid o UTC" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "remember_note",
        description: "Guarda una nota persistente por usuario.",
        input: {
          type: "object",
          required: ["key", "value"],
          properties: {
            key: { type: "string" },
            value: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "recall_note",
        description: "Recupera una nota persistente por key.",
        input: {
          type: "object",
          required: ["key"],
          properties: {
            key: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "list_notes",
        description: "Lista notas recientes guardadas.",
        input: {
          type: "object",
          properties: {
            limit: { type: "number" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "list_directory",
        description: "Lista archivos y carpetas en una ruta del workspace.",
        input: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "search_files",
        description: "Busca archivos por nombre dentro del workspace.",
        input: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            path: { type: "string" },
            maxDepth: { type: "number" },
            limit: { type: "number" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "read_text_file",
        description: "Lee el contenido de un archivo de texto del workspace.",
        input: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "write_text_file",
        description: "Escribe o reemplaza un archivo de texto en el workspace.",
        input: {
          type: "object",
          required: ["path", "content"],
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "append_text_file",
        description: "Agrega texto al final de un archivo en el workspace.",
        input: {
          type: "object",
          required: ["path", "content"],
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "execute_command",
        description: "Ejecuta comandos locales permitidos (node, npm, git read-only).",
        input: {
          type: "object",
          required: ["command"],
          properties: {
            command: { type: "string" },
            timeoutSec: { type: "number" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "http_get",
        description: "Hace una peticion HTTP GET a URL HTTPS.",
        input: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    ],
    null,
    2,
  );
}

export async function executeTool(
  name: string,
  context: ToolExecutionContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const handler = tools[name];
  if (!handler) {
    return { ok: false, error: `La herramienta '${name}' no existe.` };
  }
  return handler(context, args);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asPathArg(raw: unknown): string {
  if (typeof raw !== "string") {
    return ".";
  }
  const value = raw.trim();
  return value || ".";
}

function safeResolvePath(workspaceRoot: string, userPath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, userPath);
  const rootNorm = normalizeForCompare(root);
  const resolvedNorm = normalizeForCompare(resolved);
  const separator = path.sep.toLowerCase();

  if (resolvedNorm !== rootNorm && !resolvedNorm.startsWith(rootNorm + separator)) {
    throw new Error("Ruta fuera del workspace no permitida.");
  }
  return resolved;
}

function normalizeForCompare(target: string): string {
  return path.normalize(target).toLowerCase();
}

function toRelative(workspaceRoot: string, absolutePath: string): string {
  const relative = path.relative(workspaceRoot, absolutePath);
  return relative || ".";
}

async function searchByName(
  workspaceRoot: string,
  startDir: string,
  query: string,
  maxDepth: number,
  limit: number,
): Promise<string[]> {
  const output: string[] = [];

  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || output.length >= limit) {
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (output.length >= limit) {
        return;
      }

      if (entry.name.startsWith(".") && entry.name !== ".env") {
        continue;
      }
      if (BLOCKED_DIRS.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relative = toRelative(workspaceRoot, fullPath);

      if (entry.name.toLowerCase().includes(query)) {
        output.push(relative);
      }

      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
      }
    }
  }

  await visit(startDir, 0);
  return output;
}

function parseCommand(command: string): string[] | null {
  if (command.length > 300 || command.includes("\n")) {
    return null;
  }

  const parts: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null = regex.exec(command);
  while (match) {
    const token = match[1] ?? match[2] ?? match[3] ?? "";
    if (token) {
      parts.push(token);
    }
    match = regex.exec(command);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts;
}

async function runCommand(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-MAX_OUTPUT_CHARS);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-MAX_OUTPUT_CHARS);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Error desconocido";
}

function headersToObject(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}
