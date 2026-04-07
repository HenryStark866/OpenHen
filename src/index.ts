import "dotenv/config";
import * as http from "http";
import { AgentLoop } from "./agent/loop.js";
import { loadConfig } from "./config/env.js";
import { initializeFirebase } from "./db/firebase.js";
import { LlmClient } from "./llm/client.js";
import { GroqProvider } from "./llm/providers/groq.js";
import { GroqWhisper } from "./llm/providers/groq-whisper.js";
import { ElevenLabs } from "./llm/providers/elevenlabs.js";
import { OpenRouterProvider } from "./llm/providers/openrouter.js";
import { MemoryRepository } from "./memory/repository.js";
import { createTelegramBot } from "./telegram/bot.js";
import { Logger } from "./utils/logger.js";
import { PerformanceMonitor } from "./utils/performance.js";
import { MoneyCoach } from "./coaching/moneyCoach.js";

async function main(): Promise<void> {
  try {
    // Initialize logger
    Logger.initialize();
    
    // Initialize performance monitor
    PerformanceMonitor.initialize();
    
    const config = loadConfig();
    Logger.getInstance().info("main", "Configuration loaded successfully");

    Logger.getInstance().info("main", "Initializing Firebase...");
    const app = initializeFirebase(config.firebaseDatabaseUrl);
    const memory = new MemoryRepository(app);
    Logger.getInstance().info("main", "Firebase initialized successfully");

    Logger.getInstance().info("main", "Setting up LLM providers...");
    const primary = new OpenRouterProvider({
      apiKey: config.openRouterApiKey!,
      model: "google/gemini-2.0-flash-001",
    });

    const fallback = new GroqProvider({
      apiKey: config.groqApiKey,
      model: config.groqModel,
    });

    const llm = new LlmClient({ primary, fallback });
    const agent = new AgentLoop({
      llm,
      memory,
      maxIterations: config.maxAgentIterations,
      workspaceRoot: process.cwd(),
      unsafeTools: config.unsafeTools,
    });
    Logger.getInstance().info("main", "LLM providers configured successfully");

    const whisper = config.audioEnabled
      ? new GroqWhisper({ apiKey: config.groqApiKey })
      : undefined;

    const tts = config.audioEnabled
      ? new ElevenLabs({
          apiKey: config.elevenlabsApiKey,
          voiceId: config.elevenlabsVoiceId,
        })
      : undefined;

  Logger.getInstance().info("main", "Creating Telegram bot...");
  const bot = createTelegramBot({
    token: config.telegramBotToken,
    allowedUserIds: config.allowedUserIds,
    agent,
    whisper,
    tts,
  });

  // ── MoneyCoach: Motor de Coaching Financiero Adaptativo ──────────────────
  Logger.getInstance().info("main", "🧠 Iniciando Motor de Coaching Financiero...");
  const coach = new MoneyCoach({
    db: memory.firebaseRef,
    llm,
    botToken: config.telegramBotToken,
    userIds: config.allowedUserIds,
  });

  Logger.getInstance().info("main", "Setting up process handlers...");
  process.once("SIGINT", () => {
    Logger.getInstance().info("main", "Received SIGINT, shutting down...");
    coach.stop();
    bot.stop();
  });
  process.once("SIGTERM", () => {
    Logger.getInstance().info("main", "Received SIGTERM, shutting down...");
    coach.stop();
    bot.stop();
  });

  // Start HTTP health check server for cloud platforms (Render, Railway, etc.)
  const port = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OpenHen Bot is alive!");
  });
  server.listen(port, () => {
    Logger.getInstance().info("main", `HTTP Health Check server listening on port ${port}`);
  });

  // Start the coaching loop (non-blocking)
  coach.start();

  Logger.getInstance().info("main", "🚀 OpenHen bot activo con Coaching Financiero habilitado.");
  await bot.start();
  } catch (error) {
    Logger.getInstance().fatal("main", "Failed to start OpenHen bot", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

main().catch((error) => {
  Logger.getInstance().fatal("main", "Unhandled promise rejection in main", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});
