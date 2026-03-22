export type LlmRole = "system" | "user" | "assistant" | "tool";

export type LlmMessage = {
  role: LlmRole;
  content: string;
  images?: string[]; // base64 strings
};

export type LlmResult = {
  text: string;
  provider: string;
  model: string;
};

export type LlmProvider = {
  name: string;
  generate(messages: LlmMessage[]): Promise<LlmResult>;
};

export class LlmRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmRateLimitError";
  }
}
