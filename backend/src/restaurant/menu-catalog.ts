import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CartItem, MenuItem } from "./types.js";
import { escapeRegex, normalizeText } from "./text.js";

interface RawMenuFile {
  items?: RawMenuItem[];
}

interface RawMenuItem {
  idp?: unknown;
  name?: unknown;
  description?: unknown;
  price?: unknown;
  status?: unknown;
  vegan?: unknown;
  spicy?: unknown;
}

const FALLBACK_ITEMS: MenuItem[] = [
  makeItem("p004", "Ceviche Mixto Especial", "Camarones, vieiras, pescado y calamar marinados en limon.", 2395, ["ceviche mixto", "seafood ceviche"], ["seafood"]),
  makeItem("p005", "Ceviche de Pescado", "Pescado fresco marinado en limon, cebolla y aji.", 1995, ["ceviche", "sebiche"], ["seafood"]),
  makeItem("p014", "House Salad", "Lechuga, tomate, cebolla y zanahoria.", 695, ["house salad", "ensalada de casa"], []),
  makeItem("p030", "Seco de Carne", "Carne de res estofada con cilantro, arroz, papas y frijoles.", 1995, ["seco"], []),
  makeItem("p031", "Lomo Saltado a la Criolla", "Res salteada con cebolla, tomate, papas fritas y arroz.", 2295, ["lomo", "lomo saltado", "lomo saltado a la criolla"], []),
  makeItem("p032", "Tallarín Saltado de Carne", "Lomo de res salteado con tallarines.", 2295, ["tallarin saltado", "tallarin saltado de carne"], ["gluten"]),
  makeItem("p095", "Chicha Morada / Purple Corn drink", "Bebida peruana no alcoholica de maiz morado.", 500, ["chicha", "chicha morada"], []),
  makeItem("p097", "Sodas: Inka Cola, Coca Cola, assorted", "Sodas populares: Inca Kola, Coca-Cola y otras.", 300, ["inka kola", "inca kola", "soda"], []),
  makeItem("p102", "Jugo de Piña / Pineapple Juice", "Jugo natural de pina.", 500, ["jugo de pina", "pineapple juice"], []),
];

const EXTRA_ALIASES: Record<string, string[]> = {
  "Papa a la Huancaina": ["papa huancaina", "papa a la huancaina"],
  "Jugo Especial / Mixed Juices w/Milk and Egg": ["jugo especial", "special juice"],
  "Imported Beer (Heineken, Corona, Modelo, Cristal)": ["cerveza cristal", "cristal", "beer", "cerveza"],
  "Glass Wine (House)": ["house wine", "vino de la casa"],
  "Flan / Caramelized Custard": ["flan"],
  "Arroz con Leche / Rice Pudding": ["arroz con leche", "rice pudding"],
  "Picarones (Friday Saturday & Sunday)": ["picarones"],
  "Churrasco a la Parrilla": ["churrasco"],
  "Seco de Carne": ["seco"],
  "Tallarín Saltado de Carne": ["tallarin saltado de carne", "tallarin saltado"],
  "Ceviche Mixto Especial": ["ceviche mixto", "pescados", "mariscos", "seafood"],
  "Ceviche de Pescado": ["ceviche", "sebiche"],
  "Lomo Saltado a la Criolla": ["lomo", "lomo saltado", "beef", "carnes", "carne"],
  "House Salad": ["house salad", "ensalada", "ensalada de casa", "vegetarian", "vegetariano"],
  "Chicha Morada / Purple Corn drink": ["chicha", "chicha morada", "purple corn"],
  "Jugo de Piña / Pineapple Juice": ["jugo de pina", "jugo de piña", "pineapple juice"],
};

export class MenuCatalog {
  private readonly items: MenuItem[];

  constructor(items = loadMenuItems()) {
    this.items = items;
  }

  all(): MenuItem[] {
    return [...this.items];
  }

  available(): MenuItem[] {
    return this.items.filter((item) => item.status === "available");
  }

  findByName(name: string): MenuItem | undefined {
    const normalized = normalizeText(name);
    return this.items.find((item) => normalizeText(item.name) === normalized);
  }

  findByAlias(query: string): MenuItem | undefined {
    const normalized = normalizeText(query);
    const sortedItems = [...this.items].sort((a, b) => longestAlias(b) - longestAlias(a));
    const exactMatch = sortedItems.find((item) =>
      item.aliases.some((alias) => normalized === normalizeText(alias))
    );
    if (exactMatch) return exactMatch;

    return sortedItems.find((item) =>
      item.aliases.some((alias) => normalized.includes(normalizeText(alias)))
    );
  }

  search(query: string, limit = 8): MenuItem[] {
    const normalized = normalizeText(query);
    return this.items
      .filter((item) =>
        normalizeText(`${item.name} ${item.description} ${item.aliases.join(" ")}`).includes(normalized)
      )
      .slice(0, limit);
  }

  parseCartItems(message: string): CartItem[] {
    const normalized = normalizeText(message);
    const priceHints = extractPriceHints(message);
    const matches: Array<{ item: MenuItem; index: number; quantity: number }> = [];
    const seenIds = new Set<string>();

    for (const item of [...this.items].sort((a, b) => longestAlias(b) - longestAlias(a))) {
      let bestMatch: { index: number; quantity: number } | null = null;
      for (const candidate of item.aliases) {
        const alias = normalizeText(candidate);
        const pattern = new RegExp(`(?:^|\\s|,)(\\d+)?\\s*x?\\s*${escapeRegex(alias)}(?:\\s|,|\\(|$)`, "u");
        const match = normalized.match(pattern);
        if (!match || match.index === undefined) continue;
        const quantity = match[1] ? Number(match[1]) : 1;
        if (!bestMatch || match.index < bestMatch.index) bestMatch = { index: match.index, quantity };
      }
      if (!bestMatch || seenIds.has(item.id)) continue;

      matches.push({
        item,
        index: bestMatch.index,
        quantity: Number.isFinite(bestMatch.quantity) && bestMatch.quantity > 0 ? bestMatch.quantity : 1,
      });
      seenIds.add(item.id);
    }

    return matches
      .sort((a, b) => a.index - b.index)
      .map((match, index) => ({
        menuItemId: match.item.id,
        name: match.item.name,
        quantity: match.quantity,
        unitPriceCents: priceHints[index] ?? match.item.priceCents,
      }));
  }
}

export function subtotalCents(items: readonly CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
}

export function loadMenuItems(): MenuItem[] {
  const sourcePath = findMenuPath();
  if (!sourcePath) return FALLBACK_ITEMS;

  const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as RawMenuFile;
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const normalizedItems = rawItems
    .map(normalizeRawItem)
    .filter((item): item is MenuItem => item !== null);

  return normalizedItems.length > 0 ? normalizedItems : FALLBACK_ITEMS;
}

function findMenuPath(): string | null {
  const candidates = [
    process.env.HUASCARAN_MENU_PATH,
    resolve(process.cwd(), "data/huascaran-menu.json"),
    resolve(process.cwd(), "../data/huascaran-menu.json"),
    resolve(process.cwd(), "../../../_docs/inbox/n8n/nocodb-huascaran-platos.sanitized.json"),
    resolve(process.cwd(), "_docs/inbox/n8n/nocodb-huascaran-platos.sanitized.json"),
    resolve(process.cwd(), "../_docs/inbox/n8n/nocodb-huascaran-platos.sanitized.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function normalizeRawItem(raw: RawMenuItem): MenuItem | null {
  if (typeof raw.idp !== "string" || typeof raw.name !== "string") return null;

  const description = typeof raw.description === "string" ? raw.description : "";
  const price = typeof raw.price === "string" ? Number(raw.price) : Number(raw.price ?? 0);
  const status = typeof raw.status === "string" && normalizeText(raw.status).includes("agotado") ? "sold_out" : "available";
  const spicy = typeof raw.spicy === "string" && normalizeText(raw.spicy).startsWith("si");
  const vegan = typeof raw.vegan === "string" && normalizeText(raw.vegan) === "si";
  const allergens = inferAllergens(raw.name, description);
  const aliases = buildAliases(raw.name);

  return {
    id: raw.idp,
    name: raw.name,
    description,
    priceCents: Math.round(price * 100),
    status,
    vegan,
    spicy,
    allergens,
    aliases,
  };
}

function buildAliases(name: string): string[] {
  const extras = EXTRA_ALIASES[name] ?? [];
  const compact = name.split("/").map((part) => part.trim()).filter(Boolean);
  return [...new Set([name, ...compact, ...extras].map(normalizeText).filter(Boolean))];
}

function inferAllergens(name: string, description: string): string[] {
  const text = normalizeText(`${name} ${description}`);
  const allergens: string[] = [];
  if (/(leche|milk|queso|cheese|crema|custard|flan|huancaina)/u.test(text)) allergens.push("dairy");
  if (/(huevo|egg|flan|jugo especial)/u.test(text)) allergens.push("egg");
  if (/(pan|bread|tallarin|tallarines|pasta|quesadilla|pancake|harina)/u.test(text)) allergens.push("gluten");
  if (/(ceviche|marisco|camar|vieira|pescado|calamar|choros|seafood|fish|shrimp)/u.test(text)) allergens.push("seafood");
  if (/(mani|peanut)/u.test(text)) allergens.push("peanut");
  return [...new Set(allergens)];
}

function extractPriceHints(message: string): number[] {
  const matches = [...message.matchAll(/\$(\d+(?:\.\d{1,2})?)/g)];
  return matches.map((match) => Math.round(Number(match[1]) * 100)).filter((value) => Number.isFinite(value) && value > 0);
}

function makeItem(id: string, name: string, description: string, priceCents: number, aliases: string[], allergens: string[]): MenuItem {
  return {
    id,
    name,
    description,
    priceCents,
    status: "available",
    vegan: false,
    spicy: false,
    allergens,
    aliases: [...new Set([name, ...aliases].map(normalizeText))],
  };
}

function longestAlias(item: MenuItem): number {
  return item.aliases.reduce((max, alias) => Math.max(max, alias.length), 0);
}
