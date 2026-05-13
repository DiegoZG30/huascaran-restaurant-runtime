import type { RestaurantLanguage } from "./types.js";

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}#$@.\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsPaymentCardNumber(input: string): boolean {
  return /(^|[^\d])(?:\d[ -]?){13,19}(?!\d)/u.test(input);
}

export function maskPaymentCardNumbers(input: string): string {
  return input.replace(/(^|[^\d])(?:\d[ -]?){13,19}(?!\d)/gu, "$1[card-redacted]");
}

export function includesAny(normalizedInput: string, needles: readonly string[]): boolean {
  return needles.some((needle) => normalizedInput.includes(normalizeText(needle)));
}

export function detectRestaurantLanguage(message: string): RestaurantLanguage {
  const normalized = normalizeText(message);
  const spanishSignals = [
    "hola",
    "buenos dias",
    "buenas tardes",
    "buenas noches",
    "gracias",
    "quiero",
    "recomendacion",
    "recomiend",
    "para llevar",
    "reservar",
    "mesa",
    "personas",
    "pedido",
    "horario",
    "domicilio",
    "envios",
    "pago",
    "tarjeta",
    "recoger",
    "no lacteos",
    "mani",
  ];
  const englishSignals = [
    "recommend",
    "order",
    "pickup",
    "delivery",
    "book",
    "table",
    "guests",
    "opening hours",
    "status",
    "payment",
    "allergy",
  ];

  const spanishHits = spanishSignals.filter((signal) => normalized.includes(signal)).length;
  const englishHits = englishSignals.filter((signal) => normalized.includes(signal)).length;
  return spanishHits >= englishHits && spanishHits > 0 ? "es" : "en";
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}
