import { LlmMessage, LlmProvider, LlmResult } from "../types.js";

type OpenRouterProviderOptions = {
  apiKey: string;
  model: string;
};

export class OpenRouterProvider implements LlmProvider {
  public readonly name = "openrouter";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  async generate(messages: LlmMessage[]): Promise<LlmResult> {
    const mappedMessages = messages.map((m) => {
      if (!m.images || m.images.length === 0) {
        return { role: m.role, content: m.content };
      }
      
      const contentParts: any[] = [{ type: "text", text: m.content }];
      for (const imgBase64 of m.images) {
        contentParts.push({
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${imgBase64}`,
          },
        });
      }
      return { role: m.role, content: contentParts };
    });

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/OpenHen", // Optional but good practice for OpenRouter
        "X-Title": "OpenHen Bot",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages: mappedMessages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("OpenRouter no devolvio contenido.");
    }

    return {
      text,
      provider: this.name,
      model: this.model,
    };
  }
}
