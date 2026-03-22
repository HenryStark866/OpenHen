#!/usr/bin/env node
/**
 * OpenHen - Script de verificación pre-despliegue
 * Verifica que todas las herramientas, credenciales y dependencias están OK.
 * 
 * Uso: npx tsx verify.ts
 */

import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

dotenv.config();

type CheckResult = { name: string; status: "✅" | "❌" | "⚠️"; detail: string };
const results: CheckResult[] = [];

function check(name: string, condition: boolean, okDetail: string, failDetail: string, warn = false): void {
  results.push({
    name,
    status: condition ? "✅" : warn ? "⚠️" : "❌",
    detail: condition ? okDetail : failDetail,
  });
}

// ── Variables de entorno ────────────────────────────────────────────────────
const ENV_VARS = [
  ["TELEGRAM_BOT_TOKEN", "Token del bot de Telegram"],
  ["TELEGRAM_ALLOWED_USER_IDS", "IDs de usuarios de Telegram permitidos"],
  ["GROQ_API_KEY", "Clave API de Groq (LLM fallback)"],
  ["OPENROUTER_API_KEY", "Clave API de OpenRouter (LLM principal + Vision)"],
  ["FIREBASE_DATABASE_URL", "URL de Firebase Realtime Database"],
];

console.log("\n🔍  OpenHen — Verificación Pre-Despliegue\n");
console.log("═".repeat(55));
console.log("  VARIABLES DE ENTORNO");
console.log("─".repeat(55));

for (const [name, label] of ENV_VARS) {
  const val = process.env[name]?.trim();
  check(label, !!val, `Presente (${val?.slice(0, 8)}...)`, `FALTA: ${name}`);
}

// ── Credenciales Firebase ───────────────────────────────────────────────────
console.log("─".repeat(55));
console.log("  CREDENCIALES FIREBASE");
console.log("─".repeat(55));

const localSA = join(process.cwd(), "service-account.json");
const hasSAFile = existsSync(localSA);
const hasSAEnv = !!process.env.FIREBASE_SERVICE_ACCOUNT?.trim();

if (hasSAFile) {
  try {
    const sa = JSON.parse(readFileSync(localSA, "utf8"));
    check(
      "service-account.json",
      !!sa.private_key && !!sa.project_id,
      `Válido — Proyecto: ${sa.project_id}`,
      "Archivo inválido o incompleto"
    );
  } catch {
    check("service-account.json", false, "", "El archivo existe pero no es JSON válido");
  }
} else if (hasSAEnv) {
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
    check(
      "FIREBASE_SERVICE_ACCOUNT (env)",
      !!sa.private_key && !!sa.project_id,
      `Válido — Proyecto: ${sa.project_id}`,
      "Variable existe pero JSON inválido"
    );
  } catch {
    check("FIREBASE_SERVICE_ACCOUNT (env)", false, "", "La variable existe pero no es JSON válido");
  }
} else {
  check(
    "Credenciales Firebase",
    false,
    "",
    "FALTA: Crea service-account.json o env FIREBASE_SERVICE_ACCOUNT"
  );
}

// ── Archivos críticos ───────────────────────────────────────────────────────
console.log("─".repeat(55));
console.log("  ARCHIVOS DEL PROYECTO");
console.log("─".repeat(55));

const critical_files = [
  ["src/index.ts", "Punto de entrada principal"],
  ["src/agent/loop.ts", "Bucle del agente"],
  ["src/agent/tools.ts", "Registro de herramientas"],
  ["src/agent/firebase_tool.ts", "Herramienta Firebase Master"],
  ["src/db/firebase.ts", "Inicialización Firebase"],
  ["src/config/env.ts", "Configuración de entorno"],
  ["src/telegram/bot.ts", "Bot de Telegram"],
  ["src/llm/providers/openrouter.ts", "Proveedor OpenRouter (Vision)"],
  ["tsconfig.json", "Configuración TypeScript"],
  ["Dockerfile", "Imagen Docker para producción"],
];

for (const [file, label] of critical_files) {
  check(label, existsSync(join(process.cwd(), file)), file, `FALTA: ${file}`);
}

// ── Opcionales ──────────────────────────────────────────────────────────────
console.log("─".repeat(55));
console.log("  OPCIONALES (no bloquean)");
console.log("─".repeat(55));

check(
  "ElevenLabs TTS",
  !!process.env.ELEVENLABS_API_KEY?.trim(),
  "Clave presente",
  "Sin clave — voz desactivada",
  true
);
check(
  "Herramientas peligrosas",
  process.env.OPENHEN_UNSAFE_TOOLS === "true",
  "ACTIVADAS (ej: gh, git push, npm install)",
  "Desactivadas (solo comandos de lectura)",
  true
);

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log("═".repeat(55));
console.log("  RESULTADOS");
console.log("═".repeat(55));

let errors = 0;
let warnings = 0;
for (const r of results) {
  console.log(`  ${r.status}  ${r.name}`);
  if (r.status !== "✅") {
    console.log(`       → ${r.detail}`);
  }
  if (r.status === "❌") errors++;
  if (r.status === "⚠️") warnings++;
}

console.log("═".repeat(55));
if (errors === 0) {
  console.log(`\n✅  LISTO PARA DESPLIEGUE — ${warnings} advertencia(s)\n`);
  process.exit(0);
} else {
  console.log(`\n❌  ${errors} error(es) — Corrígelos antes de desplegar\n`);
  process.exit(1);
}
