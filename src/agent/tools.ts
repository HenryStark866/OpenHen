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
  web_search: async (_context, args) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return { ok: false, error: "Debes enviar una consulta de busqueda." };
    }

    try {
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });

      if (!response.ok) {
        return { ok: false, error: `Error en busqueda web: ${response.status}` };
      }

      const html = await response.text();
      const results: Array<{ title: string; url: string; snippet: string }> = [];

      const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/g;

      let titleMatch;
      while ((titleMatch = titleRegex.exec(html)) !== null) {
        const url = titleMatch[1] || "";
        const title = (titleMatch[2] || "").replace(/<[^>]*>/g, "").trim();

        const snippetMatch = snippetRegex.exec(html);
        const snippet = snippetMatch && snippetMatch[1] ? snippetMatch[1].replace(/<[^>]*>/g, "").trim() : "";

        if (title && url && url.startsWith("http")) {
          results.push({ title, url, snippet });
        }

        if (results.length >= 10) break;
      }

      return {
        ok: true,
        data: {
          query,
          results,
          count: results.length,
          source: "DuckDuckGo"
        }
      };
    } catch (error) {
      return { ok: false, error: `Error en busqueda web: ${toErrorMessage(error)}` };
    }
  },

  web_fetch: async (_context, args) => {
    const url = typeof args.url === "string" ? args.url.trim() : "";
    if (!url.startsWith("https://")) {
      return { ok: false, error: "Solo se permiten URLs HTTPS." };
    }

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });

      if (!response.ok) {
        return { ok: false, error: `Error al obtener URL: ${response.status}` };
      }

      const html = await response.text();
      const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);

      return {
        ok: true,
        data: {
          url,
          content: textContent,
          length: textContent.length,
          status: response.status
        }
      };
    } catch (error) {
      return { ok: false, error: `Error al obtener URL: ${toErrorMessage(error)}` };
    }
  },

  code_search: async (_context, args) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const language = typeof args.language === "string" ? args.language.trim() : "";
    if (!query) {
      return { ok: false, error: "Debes enviar una consulta de busqueda de codigo." };
    }

    try {
      const searchQuery = language ? `${query} ${language} example` : query;
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery + " site:github.com OR site:npmjs.com OR site:pypi.org")}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });

      if (!response.ok) {
        return { ok: false, error: `Error en busqueda de codigo: ${response.status}` };
      }

      const html = await response.text();
      const results: Array<{ title: string; url: string; snippet: string }> = [];

      const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/g;

      let titleMatch;
      while ((titleMatch = titleRegex.exec(html)) !== null) {
        const url = titleMatch[1] || "";
        const title = (titleMatch[2] || "").replace(/<[^>]*>/g, "").trim();

        const snippetMatch = snippetRegex.exec(html);
        const snippet = snippetMatch && snippetMatch[1] ? snippetMatch[1].replace(/<[^>]*>/g, "").trim() : "";

        if (title && url && url.startsWith("http")) {
          results.push({ title, url, snippet });
        }

        if (results.length >= 8) break;
      }

      return {
        ok: true,
        data: {
          query,
          language: language || "any",
          results,
          count: results.length,
          source: "GitHub/NPM/PyPi via DuckDuckGo"
        }
      };
    } catch (error) {
      return { ok: false, error: `Error en busqueda de codigo: ${toErrorMessage(error)}` };
    }
  },

  github_repo: async (context, args) => {
    const action = typeof args.action === "string" ? args.action.trim() : "";
    const repo = typeof args.repo === "string" ? args.repo.trim() : "";
    const query_text = typeof args.query === "string" ? args.query.trim() : "";

    if (!action) {
      return { ok: false, error: "Debes especificar una accion: search, info, issues, commits" };
    }

    try {
      const headers: Record<string, string> = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "OpenHen-Bot"
      };

      if (action === "search") {
        if (!query_text) {
          return { ok: false, error: "Debes enviar una consulta de busqueda." };
        }

        const response = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query_text)}&per_page=5`, { headers });

        if (!response.ok) {
          return { ok: false, error: `Error en busqueda de GitHub: ${response.status}` };
        }

        const data = await response.json();
        const repos = data.items.map((repo: any) => ({
          name: repo.full_name,
          description: repo.description || "Sin descripcion",
          stars: repo.stargazers_count,
          language: repo.language || "N/A",
          url: repo.html_url
        }));

        return {
          ok: true,
          data: {
            query: query_text,
            results: repos,
            count: repos.length
          }
        };
      }

      if (action === "info") {
        if (!repo) {
          return { ok: false, error: "Debes especificar un repositorio (owner/repo)." };
        }

        const response = await fetch(`https://api.github.com/repos/${repo}`, { headers });

        if (!response.ok) {
          return { ok: false, error: `Error al obtener info del repo: ${response.status}` };
        }

        const data = await response.json();
        return {
          ok: true,
          data: {
            name: data.full_name,
            description: data.description || "Sin descripcion",
            stars: data.stargazers_count,
            forks: data.forks_count,
            language: data.language || "N/A",
            topics: data.topics || [],
            url: data.html_url,
            created: data.created_at,
            updated: data.updated_at
          }
        };
      }

      if (action === "issues") {
        if (!repo) {
          return { ok: false, error: "Debes especificar un repositorio (owner/repo)." };
        }

        const response = await fetch(`https://api.github.com/repos/${repo}/issues?per_page=5`, { headers });

        if (!response.ok) {
          return { ok: false, error: `Error al obtener issues: ${response.status}` };
        }

        const data = await response.json();
        const issues = data.map((issue: any) => ({
          title: issue.title,
          number: issue.number,
          state: issue.state,
          url: issue.html_url,
          created: issue.created_at
        }));

        return {
          ok: true,
          data: {
            repo,
            issues,
            count: issues.length
          }
        };
      }

      if (action === "commits") {
        if (!repo) {
          return { ok: false, error: "Debes especificar un repositorio (owner/repo)." };
        }

        const response = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=5`, { headers });

        if (!response.ok) {
          return { ok: false, error: `Error al obtener commits: ${response.status}` };
        }

        const data = await response.json();
        const commits = data.map((commit: any) => ({
          message: commit.commit.message.split("\n")[0],
          author: commit.commit.author.name,
          date: commit.commit.author.date,
          sha: commit.sha.slice(0, 7),
          url: commit.html_url
        }));

        return {
          ok: true,
          data: {
            repo,
            commits,
            count: commits.length
          }
        };
      }

      return { ok: false, error: `Accion no soportada: ${action}. Usa: search, info, issues, commits` };
    } catch (error) {
      return { ok: false, error: `Error en GitHub: ${toErrorMessage(error)}` };
    }
  },

  data_analyze: async (_context, args) => {
    const data_text = typeof args.data === "string" ? args.data.trim() : "";
    const operation = typeof args.operation === "string" ? args.operation.trim() : "summary";

    if (!data_text) {
      return { ok: false, error: "Debes enviar datos para analizar." };
    }

    try {
      let parsed: any[];
      try {
        parsed = JSON.parse(data_text);
        if (!Array.isArray(parsed)) {
          parsed = [parsed];
        }
      } catch {
        parsed = data_text.split("\n").filter(line => line.trim()).map(line => {
          const parts = line.split(",").map(p => p.trim());
          return parts.reduce((obj: Record<string, string>, val, idx) => {
            obj[`col_${idx}`] = val;
            return obj;
          }, {});
        });
      }

      if (parsed.length === 0) {
        return { ok: false, error: "No se encontraron datos para analizar." };
      }

      const result: Record<string, any> = {
        recordCount: parsed.length,
        columns: Object.keys(parsed[0] || {}),
        operation
      };

      if (operation === "summary") {
        result.sample = parsed.slice(0, 3);
        result.statistics = {
          firstRecord: parsed[0],
          lastRecord: parsed[parsed.length - 1],
          hasNulls: parsed.some(record => Object.values(record).some(v => v === null || v === undefined))
        };
      } else if (operation === "count") {
        result.count = parsed.length;
      } else if (operation === "keys") {
        result.keys = Object.keys(parsed[0] || {});
        result.sampleValues = parsed.slice(0, 5).map((record: Record<string, any>) =>
          Object.values(record).slice(0, 3)
        );
      }

      return {
        ok: true,
        data: result
      };
    } catch (error) {
      return { ok: false, error: `Error al analizar datos: ${toErrorMessage(error)}` };
    }
  },

  security_scan: async (context, args) => {
    const target = typeof args.target === "string" ? args.target.trim() : "";
    const scanType = typeof args.scanType === "string" ? args.scanType.trim() : "basic";

    if (!target) {
      return { ok: false, error: "Debes especificar un objetivo para el escaneo." };
    }

    if (!context.unsafeTools) {
      return { ok: false, error: "Escaneo de seguridad requiere unsafeTools activado." };
    }

    try {
      const results: Record<string, any> = {
        target,
        scanType,
        timestamp: new Date().toISOString(),
        findings: []
      };

      if (scanType === "basic" || scanType === "headers") {
        try {
          const url = target.startsWith("http") ? target : `https://${target}`;
          const response = await fetch(url, { method: "HEAD" });

          const headers: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });

          results.headers = headers;

          const securityHeaders = [
            "strict-transport-security",
            "content-security-policy",
            "x-content-type-options",
            "x-frame-options",
            "x-xss-protection"
          ];

          const missing = securityHeaders.filter(h => !headers[h]);
          if (missing.length > 0) {
            results.findings.push({
              type: "info",
              message: `Encabezados de seguridad faltantes: ${missing.join(", ")}`,
              severity: "low"
            });
          }

          results.findings.push({
            type: "info",
            message: `Estado HTTP: ${response.status}`,
            severity: "info"
          });
        } catch (err) {
          results.findings.push({
            type: "error",
            message: `No se pudo conectar al objetivo: ${toErrorMessage(err)}`,
            severity: "high"
          });
        }
      }

      if (scanType === "basic" || scanType === "dependencies") {
        try {
          const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
          const deps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies
          };

          results.dependencies = Object.keys(deps).length;
          results.dependencyList = Object.entries(deps).slice(0, 20).map(([name, version]) => ({
            name,
            version: version as string
          }));

          results.findings.push({
            type: "info",
            message: `${Object.keys(deps).length} dependencias encontradas`,
            severity: "info"
          });
        } catch {
          results.findings.push({
            type: "info",
            message: "No se encontro package.json para analisis de dependencias",
            severity: "info"
          });
        }
      }

      return {
        ok: true,
        data: results
      };
    } catch (error) {
      return { ok: false, error: `Error en escaneo de seguridad: ${toErrorMessage(error)}` };
    }
  },

  monitor_system: async (_context, _args) => {
    try {
      const os = await import("node:os");
      const { promises: fs } = await import("node:fs");

      const uptime = os.uptime();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const cpuCount = os.cpus().length;
      const platform = os.platform();
      const arch = os.arch();

      const loadAvg = os.loadavg();

      return {
        ok: true,
        data: {
          status: "healthy",
          uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
          memory: {
            total: `${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
            free: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
            used: `${((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(2)} GB`,
            usagePercent: `${(((totalMem - freeMem) / totalMem) * 100).toFixed(1)}%`
          },
          cpu: {
            cores: cpuCount,
            loadAverage: loadAvg.map(l => l.toFixed(2))
          },
          system: {
            platform,
            architecture: arch,
            nodeVersion: process.version
          },
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      return { ok: false, error: `Error en monitoreo: ${toErrorMessage(error)}` };
    }
  },

  task_delegation: async (context, args) => {
    const task = typeof args.task === "string" ? args.task.trim() : "";
    const priority = typeof args.priority === "string" ? args.priority.trim() : "medium";

    if (!task) {
      return { ok: false, error: "Debes describir la tarea a delegar." };
    }

    try {
      const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await context.memory.firebaseRef
        .ref(`users/${context.userId}/tasks/${taskId}`)
        .set({
          task,
          priority,
          status: "pending",
          createdAt: Date.now(),
          createdBy: "agent",
          userId: context.userId
        });

      return {
        ok: true,
        data: {
          taskId,
          task,
          priority,
          status: "queued",
          message: `Tarea '${task.slice(0, 50)}...' agregada a la cola con prioridad ${priority}`
        }
      };
    } catch (error) {
      return { ok: false, error: `Error al delegar tarea: ${toErrorMessage(error)}` };
    }
  },

  deploy_app: async (context, args) => {
    const platform = typeof args.platform === "string" ? args.platform.trim() : "";
    const appName = typeof args.appName === "string" ? args.appName.trim() : "";

    if (!platform) {
      return { ok: false, error: "Debes especificar una plataforma: railway, render, flyio" };
    }

    if (!context.unsafeTools) {
      return { ok: false, error: "Despliegue requiere unsafeTools activado." };
    }

    try {
      const deploymentInfo: Record<string, any> = {
        platform,
        appName: appName || "openhen",
        status: "ready_to_deploy",
        timestamp: new Date().toISOString(),
        instructions: {}
      };

      if (platform === "railway") {
        deploymentInfo.instructions = {
          step1: "Ve a https://railway.app y inicia sesion con GitHub",
          step2: "Crea un nuevo proyecto y selecciona 'Deploy from GitHub'",
          step3: "Selecciona el repositorio OpenHen",
          step4: "Agrega las variables de entorno desde tu archivo .env",
          step5: "Railway detectara automaticamente el Dockerfile y desplegara",
          url: "https://railway.app",
          free_tier: "500 horas/mes gratis"
        };
      } else if (platform === "render") {
        deploymentInfo.instructions = {
          step1: "Ve a https://render.com y crea una cuenta",
          step2: "Crea un nuevo 'Web Service' desde GitHub",
          step3: "Configura las variables de entorno",
          step4: "Render usara el Dockerfile automaticamente",
          url: "https://render.com",
          free_tier: "750 horas/mes gratis"
        };
      } else if (platform === "flyio") {
        deploymentInfo.instructions = {
          step1: "Instala flyctl: https://fly.io/docs/hands-on/install-flyctl/",
          step2: "Ejecuta 'fly auth login' y 'fly launch'",
          step3: "Configura las variables de entorno con 'fly secrets set'",
          step4: "Despliega con 'fly deploy'",
          url: "https://fly.io",
          free_tier: "3 VMs compartidas gratis"
        };
      } else {
        return { ok: false, error: `Plataforma no soportada: ${platform}. Usa: railway, render, flyio` };
      }

      await context.memory.firebaseRef
        .ref(`users/${context.userId}/deployments/${platform}`)
        .set(deploymentInfo);

      return {
        ok: true,
        data: deploymentInfo
      };
    } catch (error) {
      return { ok: false, error: `Error en despliegue: ${toErrorMessage(error)}` };
    }
  },

  notify_user: async (context, args) => {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) {
      return { ok: false, error: "Debes enviar un mensaje no vacío." };
    }

    try {
      // Store notification in Firebase under a special path for user communication
      await context.memory.firebaseRef
        .ref(`users/${context.userId}/notifications`)
        .push({
          message,
          timestamp: Date.now(),
          from: "agent",
        });

      return { ok: true, data: { sent: true, message } };
    } catch (error) {
      return { ok: false, error: `Error al enviar notificación: ${toErrorMessage(error)}` };
    }
  },

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
        name: "web_search",
        description: "Busca informacion en tiempo real en internet usando DuckDuckGo.",
        input: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "Consulta de busqueda" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "web_fetch",
        description: "Obtiene el contenido de una pagina web y extrae el texto.",
        input: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", description: "URL HTTPS de la pagina web" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "code_search",
        description: "Busca codigo, librerias y documentacion de APIs en GitHub, NPM y PyPi.",
        input: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "Consulta de busqueda de codigo" },
            language: { type: "string", description: "Lenguaje de programacion (opcional)" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "github_repo",
        description: "Busca repositorios, obtiene informacion, issues y commits de GitHub.",
        input: {
          type: "object",
          required: ["action"],
          properties: {
            action: { type: "string", enum: ["search", "info", "issues", "commits"], description: "Accion a realizar" },
            repo: { type: "string", description: "Repositorio en formato owner/repo" },
            query: { type: "string", description: "Consulta de busqueda (para action=search)" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "data_analyze",
        description: "Analiza datos JSON o CSV y proporciona estadisticas y resumenes.",
        input: {
          type: "object",
          required: ["data"],
          properties: {
            data: { type: "string", description: "Datos en formato JSON o CSV" },
            operation: { type: "string", enum: ["summary", "count", "keys"], description: "Tipo de analisis" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "security_scan",
        description: "Escanea vulnerabilidades basicas en sitios web y dependencias.",
        input: {
          type: "object",
          required: ["target"],
          properties: {
            target: { type: "string", description: "URL o dominio objetivo" },
            scanType: { type: "string", enum: ["basic", "headers", "dependencies"], description: "Tipo de escaneo" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "monitor_system",
        description: "Monitorea el estado del sistema: CPU, memoria, uptime.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "task_delegation",
        description: "Delega tareas complejas al sistema para procesamiento en segundo plano.",
        input: {
          type: "object",
          required: ["task"],
          properties: {
            task: { type: "string", description: "Descripcion de la tarea" },
            priority: { type: "string", enum: ["low", "medium", "high"], description: "Prioridad de la tarea" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "deploy_app",
        description: "Proporciona instrucciones y configuracion para desplegar aplicaciones en la nube.",
        input: {
          type: "object",
          required: ["platform"],
          properties: {
            platform: { type: "string", enum: ["railway", "render", "flyio"], description: "Plataforma de despliegue" },
            appName: { type: "string", description: "Nombre de la aplicacion" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "notify_user",
        description: "Envia una notificacion directa al usuario a traves de Firebase.",
        input: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string", description: "Mensaje a enviar al usuario" },
          },
          additionalProperties: false,
        },
      },
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
