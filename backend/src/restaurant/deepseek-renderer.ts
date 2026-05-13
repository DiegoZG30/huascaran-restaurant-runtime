import type { RestaurantDecision, RestaurantRenderer } from "./types.js";
import { containsPaymentCardNumber } from "./text.js";

interface DeepSeekChoice {
  message?: {
    content?: string;
  };
}

interface DeepSeekResponse {
  choices?: DeepSeekChoice[];
}

export class DeterministicRestaurantRenderer implements RestaurantRenderer {
  async render(decision: RestaurantDecision): Promise<string> {
    return decision.content;
  }
}

export class DeepSeekRestaurantRenderer implements RestaurantRenderer {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fallback: RestaurantRenderer;

  constructor(opts: { apiKey: string; baseUrl?: string; model?: string; fallback?: RestaurantRenderer }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.deepseek.com";
    this.model = opts.model ?? "deepseek-v4-flash";
    this.fallback = opts.fallback ?? new DeterministicRestaurantRenderer();
  }

  async render(decision: RestaurantDecision): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: 420,
          messages: [
            {
              role: "system",
              content:
                "You are Carmen, the Huascaran restaurant AI agent from the original Nexpert n8n workflow. Reason over the provided structured restaurant decision and rewrite it naturally in the requested language. Behave like a web chat widget for Huascaran Peruvian Cuisine: bilingual ES/EN, warm, efficient, one clear next question, order/reservation aware. Treat the structured JSON as the already-grounded result of the old carmen_speech Qdrant template plus NocoDB menu check. Do not add menu items, prices, policies, phone numbers, payment states, or facts that are not present in the JSON. Keep the answer concise and WhatsApp-friendly. Do not use Markdown, bold text, code blocks, headings, or asterisks.",
            },
            {
              role: "user",
              content: JSON.stringify(decision),
            },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return this.fallback.render(decision);

      const parsed = (await response.json()) as DeepSeekResponse;
      const content = sanitizeRenderedContent(parsed.choices?.[0]?.message?.content ?? "");
      return content && isSafeRenderedContent(content) ? content : this.fallback.render(decision);
    } catch {
      return this.fallback.render(decision);
    }
  }
}

export function createRestaurantRendererFromEnv(): RestaurantRenderer {
  const useDeepSeek = process.env.HUASCARAN_USE_DEEPSEEK === "1";
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!useDeepSeek || !apiKey) return new DeterministicRestaurantRenderer();

  return new DeepSeekRestaurantRenderer({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
  });
}

export function sanitizeRenderedContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/\*\*/gu, "")
    .replace(/\*/gu, "")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/__/gu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function isSafeRenderedContent(content: string): boolean {
  if (containsPaymentCardNumber(content)) return false;
  if (content.length < 2 || content.length > 1200) return false;
  if (content.includes("**")) return false;
  return true;
}
