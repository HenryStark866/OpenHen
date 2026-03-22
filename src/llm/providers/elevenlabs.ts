import { promises as fs } from "node:fs";

type ElevenLabsOptions = {
  apiKey: string;
  voiceId: string;
};

export class ElevenLabs {
  private readonly apiKey: string;
  private readonly voiceId: string;

  constructor(options: ElevenLabsOptions) {
    this.apiKey = options.apiKey;
    this.voiceId = options.voiceId || "pNInz6ovhhqcGnl71OMo"; // Adam (Elegant, Deep)
  }

  async synthesize(text: string, outputPath: string): Promise<void> {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": this.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs error (${response.status}): ${errText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputPath, buffer);
  }
}
