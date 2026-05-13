import type { RestaurantIntent } from "./types.js";
import { containsPaymentCardNumber, includesAny, normalizeText } from "./text.js";

export function classifyRestaurantIntent(message: string): RestaurantIntent {
  const normalized = normalizeText(message);

  if (containsPaymentCardNumber(message)) return "payment";
  if (/#?\bhua\d{4,}\b/u.test(normalized) || /\border id\s*\d{4,}\b/u.test(normalized) || includesAny(normalized, ["estado de mi pedido", "status of my order", "tracking"])) {
    return "tracking";
  }
  if (/\bid\d{4,}\b/u.test(normalized)) return "tracking";
  if (isGreetingOnly(normalized)) return "restaurant_context";
  if (includesAny(normalized, ["stripe", "paypal", "pago", "payment", "tarjeta", "credit card", "transaction declined"])) {
    return "payment";
  }
  if (/\b\d+\s*x\s+/u.test(normalized) || /\$\d+/u.test(normalized)) return "order";
  if (includesAny(normalized, ["minimum order", "pedido minimo", "minimo de delivery", "hacen envios", "envios a domicilio"])) {
    return "restaurant_context";
  }
  if (includesAny(normalized, ["tienen delivery", "hay delivery", "tienen domicilio", "hacen delivery", "do you do delivery", "do you deliver", "delivery available"])) {
    return "restaurant_context";
  }
  if (includesAny(normalized, ["tell me about", "about lomo", "que es el lomo", "que es lomo saltado", "what is lomo", "ordenar ese item", "order that item"])) {
    return "restaurant_context";
  }
  if (isMenuAvailabilityQuestion(normalized)) return "restaurant_context";
  if (includesAny(normalized, ["reservar", "reserva", "book a table", "table", "mesa", "guests", "personas"])) {
    return "reservation";
  }
  if (includesAny(normalized, ["ordenar", "pedido", "order", "pickup", "pick up", "para llevar", "delivery", "domicilio", "recoger", "recogida", "cambialo", "cámbialo", "change it", "agregar", "agrega", "add ", "quiero comida", "no tomatoes", "extra onions", "notes:"])) {
    return "order";
  }
  if (includesAny(normalized, ["recomiend", "recommend", "preferencia", "preference", "restriccion", "restriction", "confirmacion", "confirm suggestion", "carnes", "beef", "pescados", "mariscos", "vegetarian", "vegetariano", "vegano", "vegan", "lacteos", "dairy", "huevo", "egg", "pasta italiana", "italian pasta", "algo dulce", "prefiero otra", "want something else", "no me gusta", "alergia", "allergy", "mani"])) {
    return "menu_recommendation";
  }
  if (includesAny(normalized, ["horario", "hours", "close", "cierran", "almuerzo", "lunch", "delivery", "envios", "chicha", "sebiche", "ceviche", "popular", "tarjetas", "phone", "telefono", "reservas en linea", "online reservations", "lost my jacket", "parking", "bebidas", "drinks"])) {
    return "restaurant_context";
  }
  return "handoff";
}

function isMenuAvailabilityQuestion(normalized: string): boolean {
  if (includesAny(normalized, ["pasta", "carbonara", "carbonada", "spaghetti", "fettuccine"])) return true;
  return /(?:^|\s)(tienes|tienen|hay|venden|sirven|do you have|do you serve)\s+/u.test(normalized);
}

function isGreetingOnly(normalizedMessage: string): boolean {
  const sanitized = normalizedMessage
    .replace(/[.#$@-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length > 32) return false;

  return /^(hola|hola gracias|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hello|hello there|hi|hi there|hey|good morning|good afternoon|good evening)$/u.test(sanitized);
}
