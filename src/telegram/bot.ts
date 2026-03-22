import { Bot, Context, InputFile } from "grammy";
import { AgentLoop } from "../agent/loop.js";
import { GroqWhisper } from "../llm/providers/groq-whisper.js";
import { ElevenLabs } from "../llm/providers/elevenlabs.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Logger } from "../utils/logger.js";

type TelegramBotOptions = {
  token: string;
  allowedUserIds: Set<number>;
  agent: AgentLoop;
  whisper?: GroqWhisper;
  tts?: ElevenLabs;
};

export function createTelegramBot(options: TelegramBotOptions): Bot<Context> {
  const bot = new Bot<Context>(options.token);
  const logger = Logger.getInstance();

  bot.use(async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId || !options.allowedUserIds.has(fromId)) {
      if (ctx.message) {
        await ctx.reply("No autorizado.");
      }
      logger.warn("telegram-bot", "Unauthorized access attempt", {
        userId: fromId,
        username: ctx.from?.username
      });
      return;
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    await ctx.reply("OpenHen activo. Enviame un mensaje de texto o audio para comenzar.");
    logger.info("telegram-bot", "Start command received", {
      userId: ctx.from?.id,
      username: ctx.from?.username
    });
  });

  async function handleInput(ctx: Context, text: string, isVoice: boolean, images?: string[]): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    logger.info("telegram-bot", "Processing user input", {
      userId,
      isVoice,
      hasImages: !!images?.length,
      textLength: text.length
    });

    try {
      const reply = await options.agent.run(userId, text, images);

      if (isVoice && options.tts) {
        const tempPath = path.join(os.tmpdir(), `reply-${Date.now()}.mp3`);
        await options.tts.synthesize(reply, tempPath);
        await ctx.replyWithVoice(new InputFile(tempPath));
        await fs.unlink(tempPath).catch(() => {});
        logger.info("telegram-bot", "Voice response sent", { userId });
      } else {
        await ctx.reply(reply);
        logger.info("telegram-bot", "Text response sent", { userId, responseLength: reply.length });
      }
    } catch (error) {
      logger.error("telegram-bot", "Error processing user input", {
        userId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      await ctx.reply("Error interno del agente. Revisa logs locales.");
    }
  }

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text?.trim();
    if (!text) return;
    await handleInput(ctx, text, false);
  });

  bot.on("message:photo", async (ctx) => {
    try {
      const photo = ctx.message.photo;
      if (!photo || photo.length === 0) return;
      
      const largest = photo[photo.length - 1];
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${options.token}/${file.file_path}`;
      
      const response = await fetch(fileUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString("base64");

      const caption = ctx.message.caption || "Analiza esta imagen.";
      await handleInput(ctx, caption, false, [base64]);
      logger.info("telegram-bot", "Photo processed", {
        userId: ctx.from?.id,
        hasCaption: !!caption
      });
    } catch (error) {
      logger.error("telegram-bot", "Error processing photo", {
        userId: ctx.from?.id,
        error: error instanceof Error ? error.message : String(error)
      });
      await ctx.reply("Error procesando imagen.");
    }
  });

  bot.on("message:voice", async (ctx) => {
    if (!options.whisper) {
      await ctx.reply("La función de audio no está configurada.");
      logger.warn("telegram-bot", "Voice message received but Whisper not configured", {
        userId: ctx.from?.id
      });
      return;
    }

    try {
      const file = await ctx.getFile();
      const tempPath = path.join(os.tmpdir(), `voice-${Date.now()}.ogg`);
      const fileUrl = `https://api.telegram.org/file/bot${options.token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(tempPath, buffer);

      const transcribed = await options.whisper.transcribe(tempPath);
      await fs.unlink(tempPath).catch(() => {});

      if (!transcribed.trim()) {
        await ctx.reply("No pude entender el audio.");
        logger.warn("telegram-bot", "Could not transcribe voice message", {
          userId: ctx.from?.id
        });
        return;
      }

      await ctx.reply(`🎙 Transcripción: ${transcribed}`);
      await handleInput(ctx, transcribed, true);
      logger.info("telegram-bot", "Voice message processed and transcribed", {
        userId: ctx.from?.id,
        transcriptionLength: transcribed.length
      });
    } catch (error) {
      logger.error("telegram-bot", "Error processing voice message", {
        userId: ctx.from?.id,
        error: error instanceof Error ? error.message : String(error)
      });
      await ctx.reply("Error procesando audio.");
    }
  });

  return bot;
}
