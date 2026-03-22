import { ElevenLabs } from "./src/llm/providers/elevenlabs.js";
import dotenv from "dotenv";
dotenv.config();

async function test() {
  const tts = new ElevenLabs({
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    voiceId: process.env.ELEVENLABS_VOICE_ID || "",
  });
  try {
    await tts.synthesize("Hola, esto es una prueba.", "./test-audio.mp3");
    console.log("Éxito!");
  } catch (e) {
    console.error("Error:", e.message);
  }
}
test();
