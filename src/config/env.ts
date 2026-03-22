import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  telegramBotToken: string;
  allowedUserIds: Set<number>;
  groqApiKey: string;
  groqModel: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
  dbPath: string;
  firebaseDatabaseUrl: string;
  maxAgentIterations: number;
  unsafeTools: boolean;
  audioEnabled: boolean;
  groqWhisperModel: string;
  elevenlabsApiKey: string;
  elevenlabsVoiceId: string;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Falta variable requerida: ${name}`);
  }
  return value;
}

function parseAllowedUserIds(raw: string): Set<number> {
  const ids = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x));

  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error(
      "TELEGRAM_ALLOWED_USER_IDS debe contener IDs numericos separados por coma.",
    );
  }

  return new Set(ids);
}

export function loadConfig(): AppConfig {
  const telegramBotToken = required("TELEGRAM_BOT_TOKEN");
  const allowedUserIds = parseAllowedUserIds(required("TELEGRAM_ALLOWED_USER_IDS"));
  const groqApiKey = required("GROQ_API_KEY");
  const groqModel = process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim() || undefined;
  const openRouterModel = process.env.OPENROUTER_MODEL?.trim() || undefined;
  const dbPath = process.env.DB_PATH?.trim() || "./memory.db";
  const firebaseDatabaseUrl = required("FIREBASE_DATABASE_URL");
  const maxIterationsRaw = Number(process.env.MAX_AGENT_ITERATIONS ?? "6");
  const maxAgentIterations =
    Number.isInteger(maxIterationsRaw) && maxIterationsRaw >= 1 && maxIterationsRaw <= 12
      ? maxIterationsRaw
      : 6;
  const unsafeTools = (process.env.OPENHEN_UNSAFE_TOOLS ?? "false").trim().toLowerCase() === "true";
  const audioEnabled = (process.env.AUDIO_ENABLED ?? "true").trim().toLowerCase() === "true";
  const groqWhisperModel = process.env.GROQ_WHISPER_MODEL || "whisper-large-v3";
  const elevenlabsApiKey = process.env.ELEVENLABS_API_KEY || "";
  const elevenlabsVoiceId = process.env.ELEVENLABS_VOICE_ID || "pNInz6ovhhqcGnl71OMo";

  return {
    telegramBotToken,
    allowedUserIds,
    groqApiKey,
    groqModel,
    openRouterApiKey,
    openRouterModel,
    dbPath,
    firebaseDatabaseUrl,
    maxAgentIterations,
    unsafeTools,
    audioEnabled,
    groqWhisperModel,
    elevenlabsApiKey,
    elevenlabsVoiceId,
  };
}
