import { LlmMessage, LlmProvider, LlmRateLimitError, LlmResult } from "./types.js";

type LlmClientOptions = {
  primary: LlmProvider;
  fallback?: LlmProvider;
};

export class LlmClient {
  private readonly primary: LlmProvider;
  private readonly fallback?: LlmProvider;

  constructor(options: LlmClientOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback;
  }

  async generate(messages: LlmMessage[]): Promise<LlmResult> {
    try {
      return await this.primary.generate(messages);
    } catch (error) {
      if (!(error instanceof LlmRateLimitError) || !this.fallback) {
        throw error;
      }
      return this.fallback.generate(messages);
    }
  }
}
