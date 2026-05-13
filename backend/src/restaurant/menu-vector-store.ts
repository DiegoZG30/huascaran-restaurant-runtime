import { MenuCatalog } from "./menu-catalog.js";
import { normalizeText } from "./text.js";
import type { MenuItem } from "./types.js";

const VECTOR_SIZE = 128;
const DEFAULT_COLLECTION = "huascaran_menu";

interface QdrantEnvelope<T> {
  result?: T;
}

interface QdrantSearchPoint {
  score?: number;
  payload?: {
    menuItemId?: unknown;
  };
}

export interface MenuKnowledgeStatus {
  configured: boolean;
  ready: boolean;
  collection: string;
  indexedCount: number;
  lastError?: string;
}

export interface MenuSearchResult {
  item: MenuItem;
  score: number;
  source: "qdrant" | "local";
}

export class MenuVectorStore {
  private readonly qdrantUrl: string | null;
  private readonly collection: string;
  private readonly catalog: MenuCatalog;
  private ready = false;
  private indexedCount = 0;
  private lastError: string | undefined;
  private initPromise: Promise<void> | undefined;

  constructor(catalog: MenuCatalog, opts: { qdrantUrl?: string; collection?: string } = {}) {
    this.catalog = catalog;
    this.qdrantUrl = normalizeBaseUrl(opts.qdrantUrl ?? process.env.QDRANT_URL);
    this.collection = opts.collection ?? process.env.QDRANT_COLLECTION ?? DEFAULT_COLLECTION;
  }

  async ensureReady(): Promise<MenuKnowledgeStatus> {
    if (!this.qdrantUrl) return this.status();
    this.initPromise ??= this.initializeQdrant();
    await this.initPromise.catch(() => undefined);
    return this.status();
  }

  async search(query: string, limit = 4): Promise<MenuSearchResult[]> {
    await this.ensureReady();
    if (this.ready) {
      const qdrantResults = await this.searchQdrant(query, limit).catch((error: unknown) => {
        this.ready = false;
        this.lastError = error instanceof Error ? error.message : String(error);
        return [];
      });
      if (qdrantResults.length > 0) return qdrantResults;
    }
    return this.searchLocal(query, limit);
  }

  status(): MenuKnowledgeStatus {
    return {
      configured: Boolean(this.qdrantUrl),
      ready: this.ready,
      collection: this.collection,
      indexedCount: this.indexedCount,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  private async initializeQdrant(): Promise<void> {
    if (!this.qdrantUrl) return;
    try {
      await this.ensureCollection();
      await this.upsertMenu();
      this.ready = true;
      this.lastError = undefined;
    } catch (error) {
      this.ready = false;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async ensureCollection(): Promise<void> {
    const response = await fetch(`${this.qdrantUrl}/collections/${encodeURIComponent(this.collection)}`, {
      signal: AbortSignal.timeout(2500),
    });
    if (response.ok) return;
    if (response.status !== 404) throw new Error(`qdrant collection check failed ${response.status}`);

    await this.request(`/collections/${encodeURIComponent(this.collection)}`, {
      method: "PUT",
      body: JSON.stringify({
        vectors: {
          size: VECTOR_SIZE,
          distance: "Cosine",
        },
      }),
    });
  }

  private async upsertMenu(): Promise<void> {
    const points = this.catalog.all().map((item, index) => ({
      id: index + 1,
      vector: vectorize(menuSearchText(item)),
      payload: {
        menuItemId: item.id,
        name: item.name,
        description: item.description,
        aliases: item.aliases,
        priceCents: item.priceCents,
      },
    }));
    await this.request(`/collections/${encodeURIComponent(this.collection)}/points?wait=true`, {
      method: "PUT",
      body: JSON.stringify({ points }),
    });
    this.indexedCount = points.length;
  }

  private async searchQdrant(query: string, limit: number): Promise<MenuSearchResult[]> {
    const response = await this.request<QdrantEnvelope<QdrantSearchPoint[]>>(
      `/collections/${encodeURIComponent(this.collection)}/points/search`,
      {
        method: "POST",
        body: JSON.stringify({
          vector: vectorize(query),
          limit,
          with_payload: true,
        }),
      },
    );
    const byId = new Map(this.catalog.all().map((item) => [item.id, item]));
    return (response.result ?? [])
      .map((point): MenuSearchResult | null => {
        const menuItemId = typeof point.payload?.menuItemId === "string" ? point.payload.menuItemId : "";
        const item = byId.get(menuItemId);
        if (!item || item.status !== "available") return null;
        return { item, score: point.score ?? 0, source: "qdrant" };
      })
      .filter((result): result is MenuSearchResult => result !== null);
  }

  private searchLocal(query: string, limit: number): MenuSearchResult[] {
    const queryVector = vectorize(query);
    return this.catalog.available()
      .map((item) => ({ item, score: dot(queryVector, vectorize(menuSearchText(item))), source: "local" as const }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private async request<T = QdrantEnvelope<unknown>>(path: string, init: RequestInit): Promise<T> {
    if (!this.qdrantUrl) throw new Error("qdrant url not configured");
    const response = await fetch(`${this.qdrantUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`qdrant request failed ${response.status}`);
    return (await response.json()) as T;
  }
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/u, "");
}

function menuSearchText(item: MenuItem): string {
  return `${item.name} ${item.description} ${item.aliases.join(" ")} ${item.allergens.join(" ")}`;
}

function vectorize(input: string): number[] {
  const vector = Array.from({ length: VECTOR_SIZE }, () => 0);
  const tokens = expandTokens(normalizeText(input).split(/\s+/u).filter((token) => token.length > 1));
  for (const token of tokens) {
    const index = hashToken(token) % VECTOR_SIZE;
    vector[index] += token.length > 4 ? 1.2 : 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

function expandTokens(tokens: string[]): string[] {
  const expanded = [...tokens];
  for (const token of tokens) {
    const synonyms = TOKEN_SYNONYMS[token];
    if (synonyms) expanded.push(...synonyms);
  }
  for (let index = 0; index < tokens.length - 1; index += 1) {
    expanded.push(`${tokens[index]}_${tokens[index + 1]}`);
  }
  return expanded;
}

const TOKEN_SYNONYMS: Record<string, string[]> = {
  beef: ["carne", "res", "lomo"],
  carne: ["beef", "res", "lomo"],
  carnes: ["beef", "res", "lomo"],
  res: ["beef", "carne", "lomo"],
  pasta: ["tallarin", "tallarines", "noodles"],
  carbonada: ["carbonara", "pasta", "tallarin", "tallarines"],
  carbonara: ["carbonada", "pasta", "tallarin", "tallarines"],
  fettuccine: ["pasta", "tallarin", "tallarines"],
  spaghetti: ["pasta", "tallarin", "tallarines"],
  noodles: ["pasta", "tallarin", "tallarines"],
  tallarin: ["pasta", "noodles"],
  tallarines: ["pasta", "noodles"],
};

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}
