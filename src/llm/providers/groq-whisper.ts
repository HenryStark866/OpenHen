import { promises as fs } from "node:fs";

type GroqWhisperOptions = {
  apiKey: string;
};

export class GroqWhisper {
  private readonly apiKey: string;

  constructor(options: GroqWhisperOptions) {
    this.apiKey = options.apiKey;
  }

  async transcribe(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer]), "audio.ogg");
    formData.append("model", "whisper-large-v3");
    formData.append("response_format", "json");
    formData.append("language", "es");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq Whisper error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as { text: string };
    return data.text;
  }
}
