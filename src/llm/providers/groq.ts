import { LlmMessage, LlmProvider, LlmRateLimitError, LlmResult } from "../types.js";

type GroqProviderOptions = {
  apiKey: string;
  model: string;
};

export class GroqProvider implements LlmProvider {
  public readonly name = "groq";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: GroqProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  async generate(messages: LlmMessage[]): Promise<LlmResult> {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages,
      }),
    });

    if (response.status === 429) {
      throw new LlmRateLimitError("Groq rate limit alcanzado.");
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("Groq no devolvio contenido.");
    }

    return {
      text,
      provider: this.name,
      model: this.model,
    };
  }
}
