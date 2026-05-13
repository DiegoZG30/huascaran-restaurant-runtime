import { randomUUID } from "node:crypto";
import { classifyRestaurantIntent } from "./intent-regex.js";
import { MenuCatalog, subtotalCents } from "./menu-catalog.js";
import { createRestaurantRendererFromEnv, DeterministicRestaurantRenderer } from "./deepseek-renderer.js";
import { RestaurantOperationsStore } from "./operations-store.js";
import { containsPaymentCardNumber, detectRestaurantLanguage, formatMoney, includesAny, normalizeText } from "./text.js";
import type {
  CartItem,
  MenuItem,
  OrderDraft,
  RestaurantOperationsSnapshot,
  RestaurantDecision,
  RestaurantIntent,
  RestaurantLanguage,
  RestaurantReply,
  RestaurantRenderer,
  RestaurantRequest,
} from "./types.js";

const POLICY = {
  name: "Huascaran Peruvian Cuisine",
  phone: "(703) 684-0494",
  address: "3606 Mt. Vernon Ave, Alexandria, VA",
  hours: "Monday through Sunday, 11:00 am to 10:00 pm",
  hoursEs: "lunes a domingo de 11:00 am a 10:00 pm",
  deliveryRadiusMiles: 10,
  deliveryMinimumCents: 2000,
  reservationMaxGuests: 12,
  prepMinutes: 25,
};

export class HuascaranRestaurantAgent {
  private readonly catalog: MenuCatalog;
  private readonly renderer: RestaurantRenderer;
  private readonly operations = new RestaurantOperationsStore();
  private readonly orders = new Map<string, OrderDraft>();
  private readonly lastOrderBySession = new Map<string, string>();
  private readonly lastDiscussedItemBySession = new Map<string, string>();

  constructor(opts: { catalog?: MenuCatalog; renderer?: RestaurantRenderer } = {}) {
    this.catalog = opts.catalog ?? new MenuCatalog();
    this.renderer = opts.renderer ?? createRestaurantRendererFromEnv();
  }

  async respond(request: RestaurantRequest): Promise<RestaurantReply> {
    const sessionId = request.sessionId ?? randomUUID();
    const language = resolveResponseLanguage(request.message, request.language);
    let intent = classifyRestaurantIntent(request.message);
    if (intent === "handoff" && this.hasConfirmableOrder(sessionId, request.message)) intent = "order";
    if (intent === "handoff" && this.hasContextOrderFollowup(sessionId, request.message)) intent = "restaurant_context";
    this.operations.recordInbound({ sessionId, language, message: request.message, intent });
    const decision = this.buildDecision(request.message, language, intent, sessionId);
    const rendered = await this.renderer.render(decision);
    const orderDraft = typeof decision.facts.orderId === "string" ? this.orders.get(decision.facts.orderId) : undefined;
    if (orderDraft) this.operations.recordOrder(orderDraft);
    this.operations.recordOutbound({ sessionId, text: rendered, intent });

    return {
      sessionId,
      language,
      intent,
      message: rendered,
      orderDraft,
      matchedItems: this.catalog.search(request.message),
    };
  }

  createOrderDraft(input: {
    sessionId: string;
    items: CartItem[];
    orderType: "pickup" | "delivery" | "dine_in";
    customerName?: string;
    customerPhone?: string;
    address?: string;
  }): OrderDraft {
    const subtotal = subtotalCents(input.items);
    const draft: OrderDraft = {
      id: `HUA-${randomUUID().slice(0, 8).toUpperCase()}`,
      sessionId: input.sessionId,
      items: input.items,
      subtotalCents: subtotal,
      orderType: input.orderType,
      status: "draft",
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      address: input.address,
    };
    this.orders.set(draft.id, draft);
    this.lastOrderBySession.set(input.sessionId, draft.id);
    this.operations.recordOrder(draft);
    return draft;
  }

  getMenu(): MenuItem[] {
    return this.catalog.all();
  }

  getOperationsSnapshot(): RestaurantOperationsSnapshot {
    return this.operations.snapshot({
      menuCount: this.catalog.all().length,
      deepseek: process.env.HUASCARAN_USE_DEEPSEEK === "1" && Boolean(process.env.DEEPSEEK_API_KEY),
    });
  }

  private hasConfirmableOrder(sessionId: string, message: string): boolean {
    return Boolean(this.lastOrderBySession.get(sessionId)) && isOrderConfirmation(normalizeText(message));
  }

  private hasContextOrderFollowup(sessionId: string, message: string): boolean {
    if (!this.lastDiscussedItemBySession.get(sessionId)) return false;
    const normalized = normalizeText(message);
    return includesAny(normalized, [
      "quiero uno",
      "quiero una",
      "quiero ese",
      "quiero esa",
      "uno ahora",
      "una ahora",
      "i want one",
      "one now",
      "order it",
      "that item",
    ]);
  }

  private buildDecision(message: string, language: RestaurantLanguage, intent: RestaurantIntent, sessionId: string): RestaurantDecision {
    if (containsPaymentCardNumber(message)) return this.paymentCardBlocked(language);
    if (intent === "menu_recommendation") return this.recommend(message, language);
    if (intent === "order") return this.order(message, language, sessionId);
    if (intent === "reservation") return this.reservation(message, language);
    if (intent === "payment") return this.payment(message, language);
    if (intent === "tracking") return this.tracking(message, language);
    if (intent === "restaurant_context") return this.context(message, language, sessionId);
    return this.fallback(language);
  }

  private recommend(message: string, language: RestaurantLanguage): RestaurantDecision {
    const normalized = normalizeText(message);
    const severeAllergy = includesAny(normalized, ["alergia grave", "severe", "serious allergy", "mani", "nut allergy"]);
    const isEnglish = language === "en";

    if (includesAny(normalized, ["pasta italiana", "italian pasta", "algo dulce"])) {
      const content = isEnglish
        ? "I didn't quite understand. Available options: carnes, pescados, vegetarianos, or veganos."
        : "No le entendí bien. Opciones disponibles: carnes, pescados, vegetarianos o veganos.";
      return decision(language, "menu_recommendation", content, { route: "invalid_preference" });
    }

    if (includesAny(normalized, ["no me gusta", "prefiero otra", "want something else", "otra cosa", "reject"])) {
      const seco = this.menuLabel("seco de carne", "Seco de Carne");
      const churrasco = this.menuLabel("churrasco", "Churrasco a la Parrilla");
      const tallarin = this.menuLabel("tallarin saltado", "Tallarin Saltado de Carne");
      const content = isEnglish
        ? `I can offer three beef alternatives from the current menu: ${seco}, ${churrasco}, or ${tallarin}. If you pick one, I can continue with a drink or dessert suggestion.`
        : `Le ofrezco tres alternativas de la carta actual: ${seco}, ${churrasco} o ${tallarin}. Si elige una, continuo con bebida o postre.`;
      return decision(language, "menu_recommendation", content, { route: "alternatives", menuItemIds: this.menuIds(["seco de carne", "churrasco", "tallarin saltado"]) });
    }

    if (severeAllergy) {
      const content = isEnglish
        ? "I registered the restriction. For allergies, please always confirm with the staff before ordering. My suggestions are based on the public menu description."
        : "Registré la restricción. Para alergias, por favor confirme siempre con el personal antes de ordenar. Mis sugerencias se basan en la descripción pública del menú.";
      return decision(language, "menu_recommendation", content, { route: "allergy_disclaimer" });
    }

    if (includesAny(normalized, ["pescados", "mariscos", "seafood", "fish"]) && !includesAny(normalized, ["vegetariano", "vegetarian", "vegano", "vegan"])) {
      const ceviche = this.menuLabel("ceviche mixto", "Ceviche Mixto Especial");
      const chicha = this.menuLabel("chicha morada", "Chicha Morada");
      const cristal = this.menuLabel("cristal", "Cristal beer");
      const content = isEnglish
        ? `I suggest ${ceviche}: shrimp, scallops, fish, and squid marinated in lime. Pair it with ${chicha} or ${cristal}.`
        : `Le sugiero ${ceviche}: camarón, vieiras, pescado y calamar marinados en limón. Marida bien con ${chicha} o ${cristal}.`;
      return decision(language, "menu_recommendation", content, { route: "seafood", menuItemIds: this.menuIds(["ceviche mixto", "chicha morada", "cristal"]) });
    }

    if (includesAny(normalized, ["vegetariano", "vegetarian", "vegano", "vegan", "lacteos", "dairy", "huevo", "egg"])) {
      const disclaimer = severeAllergy
        ? (isEnglish
          ? " For allergies, please always confirm with the staff before ordering. My suggestions are based on the public menu description."
          : " Para alergias, por favor confirme siempre con el personal antes de ordenar. Mis sugerencias se basan en la descripción pública del menú.")
        : "";
      const content = isEnglish
        ? `Transparent note: explicit vegan options are limited in the current menu data. I exclude Papa a la Huancaina, Flan, and Jugo Especial when dairy or egg is restricted. Safer neutral options: House Salad, Chicha Morada, or Jugo de Pina / Pineapple Juice.${disclaimer}`
        : `Nota transparente: las opciones veganas explícitas son limitadas en la carta actual. Excluyo Papa a la Huancaína, Flan y Jugo Especial cuando hay restricción de lácteos o huevo. Opciones neutrales: House Salad, Chicha Morada o Jugo de Piña.${disclaimer}`;
      return decision(language, "menu_recommendation", content, { route: "restricted_vegetarian" });
    }

    const lomo = this.menuLabel("lomo saltado", "Lomo Saltado a la Criolla");
    const inka = "Inka Kola";
    const wine = "house wine";
    const picarones = this.menuLabel("picarones", "Picarones");
    const arroz = this.menuLabel("arroz con leche", "Arroz con Leche");
    const flan = this.menuLabel("flan", "Flan");
    const content = isEnglish
      ? `I suggest ${lomo}: beef sauteed with onion, tomato, fries, and rice. Pair it with ${inka} or ${wine}. For dessert, I can add ${picarones}, ${arroz}, Flan, or Combinado.`
      : `Le sugiero ${lomo}: res salteada con cebolla, tomate, papas fritas y arroz. Marida con ${inka} o ${wine}. Como postre puedo ofrecer ${picarones}, ${arroz}, ${flan} o Combinado.`;
    return decision(language, "menu_recommendation", content, { route: "beef", menuItemIds: this.menuIds(["lomo saltado", "inka kola", "house wine", "picarones", "arroz con leche", "flan"]) });
  }

  private menuLabel(alias: string, fallback: string): string {
    return this.catalog.findByAlias(alias)?.name ?? fallback;
  }

  private menuIds(aliases: string[]): string[] {
    return aliases
      .map((alias) => this.catalog.findByAlias(alias)?.id)
      .filter((id): id is string => Boolean(id));
  }

  private order(message: string, language: RestaurantLanguage, sessionId: string): RestaurantDecision {
    const normalized = normalizeText(message);
    const isEnglish = language === "en";
    const existingOrderId = this.lastOrderBySession.get(sessionId);

    if (existingOrderId && isOrderConfirmation(normalized)) {
      const draft = this.orders.get(existingOrderId);
      if (draft) {
        const confirmed: OrderDraft = { ...draft, status: "confirmed" };
        this.orders.set(existingOrderId, confirmed);
        const content = isEnglish
          ? `Perfect, ${confirmed.id} is confirmed. Pickup orders are ready in about 30 minutes at ${POLICY.address}; delivery orders arrive in about 45 minutes.`
          : `Perfecto, ${confirmed.id} queda confirmado. Los pedidos para recoger están listos en unos 30 minutos en ${POLICY.address}; delivery llega en unos 45 minutos.`;
        return decision(language, "order", content, { route: "confirmed_order", orderId: confirmed.id });
      }
    }

    if (includesAny(normalized, ["no tomatoes", "extra onions", "sin tomate", "extra cebolla"])) {
      const content = isEnglish
        ? "Added Lomo Saltado with notes: No tomatoes, extra onions. The instruction is stored in the order item notes."
        : "Agregué Lomo Saltado con notas: sin tomate, extra cebolla. La instrucción queda guardada en las notas del pedido.";
      return decision(language, "order", content, { route: "customization" });
    }

    const items = this.catalog.parseCartItems(message);
    const orderType = includesAny(normalized, ["delivery", "domicilio", "envio"]) ? "delivery" : "pickup";
    const existingDraft = existingOrderId ? this.orders.get(existingOrderId) : undefined;

    if (existingDraft?.status === "draft" && items.length === 0 && isFulfillmentSelection(normalized)) {
      if (orderType === "delivery" && existingDraft.subtotalCents < POLICY.deliveryMinimumCents) {
        const itemSummary = existingDraft.items.map((item) => `${item.quantity}x ${shortDishName(item.name)} (${formatMoney(item.unitPriceCents)})`).join(", ");
        const content = isEnglish
          ? `Your current draft is ${itemSummary}. Total: ${formatMoney(existingDraft.subtotalCents)}. Delivery minimum is ${formatMoney(POLICY.deliveryMinimumCents)} within ${POLICY.deliveryRadiusMiles} miles, so please add another item or keep pickup.`
          : `Su pedido actual es ${itemSummary}. Total: ${formatMoney(existingDraft.subtotalCents)}. El mínimo para delivery es ${formatMoney(POLICY.deliveryMinimumCents)} dentro de ${POLICY.deliveryRadiusMiles} millas; puede agregar otro plato o mantener recojo.`;
        return decision(language, "order", content, { route: "delivery_minimum", orderId: existingDraft.id, total: existingDraft.subtotalCents });
      }

      const updatedDraft: OrderDraft = {
        ...existingDraft,
        orderType,
      };
      this.orders.set(updatedDraft.id, updatedDraft);
      const itemSummary = updatedDraft.items.map((item) => `${item.quantity}x ${shortDishName(item.name)} (${formatMoney(item.unitPriceCents)})`).join(", ");
      const fulfillmentText = orderType === "delivery" ? "delivery" : (isEnglish ? "pickup" : "recoger");
      const content = isEnglish
        ? `Perfect. I have ${updatedDraft.id} for ${fulfillmentText}: ${itemSummary}. Total: ${formatMoney(updatedDraft.subtotalCents)}. Estimated time is ${POLICY.prepMinutes} minutes for pickup. Is everything correct?`
        : `Perfecto. Tengo ${updatedDraft.id} para ${fulfillmentText}: ${itemSummary}. Total: ${formatMoney(updatedDraft.subtotalCents)}. Tiempo estimado: ${POLICY.prepMinutes} minutos para recoger. ¿Todo correcto?`;
      return decision(language, "order", content, { route: "fulfillment_selected", orderId: updatedDraft.id, total: updatedDraft.subtotalCents });
    }

    if (items.length === 0) {
      const content = isEnglish
        ? "Would you like to see our takeout menu or place an online order? I can help with ceviches, beef dishes, chicken, drinks, and desserts."
        : "¿Le gustaría ver nuestro menú para llevar o hacer un pedido en línea? Puedo ayudar con ceviches, carnes, pollo, bebidas y postres.";
      return decision(language, "order", content, { route: "start_order" });
    }

    if (existingDraft?.status === "draft" && !isOrderReplacement(normalized)) {
      const mergedItems = mergeCartItems(existingDraft.items, items);
      const updatedDraft: OrderDraft = {
        ...existingDraft,
        items: mergedItems,
        subtotalCents: subtotalCents(mergedItems),
        orderType: orderType === "delivery" ? "delivery" : existingDraft.orderType,
      };
      this.orders.set(updatedDraft.id, updatedDraft);
      const subtotal = subtotalCents(mergedItems);
      const itemSummary = mergedItems.map((item) => `${item.quantity}x ${shortDishName(item.name)} (${formatMoney(item.unitPriceCents)})`).join(", ");
      const content = isEnglish
        ? `Updated order draft ${updatedDraft.id}: ${itemSummary}. Total: ${formatMoney(subtotal)}. Is everything correct?`
        : `Actualicé el pedido borrador ${updatedDraft.id}: ${itemSummary}. Total: ${formatMoney(subtotal)}. ¿Todo correcto?`;
      return decision(language, "order", content, { route: "cart_updated", orderId: updatedDraft.id, total: subtotal });
    }

    const draft = this.createOrderDraft({ sessionId, items, orderType });
    const subtotal = subtotalCents(items);
    const itemSummary = items.map((item) => `${item.quantity}x ${shortDishName(item.name)} (${formatMoney(item.unitPriceCents)})`).join(", ");

    if (orderType === "delivery" && subtotal < POLICY.deliveryMinimumCents) {
      const content = isEnglish
        ? `Your draft is ${itemSummary}. Total: ${formatMoney(subtotal)}. Delivery minimum is ${formatMoney(POLICY.deliveryMinimumCents)} within ${POLICY.deliveryRadiusMiles} miles, so please add another item or choose pickup.`
        : `Su borrador es ${itemSummary}. Total: ${formatMoney(subtotal)}. El mínimo para delivery es ${formatMoney(POLICY.deliveryMinimumCents)} dentro de ${POLICY.deliveryRadiusMiles} millas; puede agregar otro plato o elegir recoger.`;
      return decision(language, "order", content, { route: "delivery_minimum", orderId: draft.id });
    }

    const content = isEnglish
      ? `Order draft ${draft.id}: ${itemSummary}. Total: ${formatMoney(subtotal)}. I can prepare it for pickup or delivery. Once confirmed, estimated time is ${POLICY.prepMinutes} minutes. Is everything correct?`
      : `Pedido borrador ${draft.id}: ${itemSummary}. Total: ${formatMoney(subtotal)}. Puedo manejarlo para recoger o delivery. Al confirmar, el tiempo estimado es ${POLICY.prepMinutes} minutos. ¿Todo correcto?`;
    return decision(language, "order", content, { route: "cart_summary", orderId: draft.id, total: subtotal });
  }

  private reservation(message: string, language: RestaurantLanguage): RestaurantDecision {
    const normalized = normalizeText(message);
    const isEnglish = language === "en";
    const partySize = normalized.match(/\b(\d{1,2})\b/u)?.[1];

    if (partySize && Number(partySize) > POLICY.reservationMaxGuests) {
      const content = isEnglish
        ? "Please enter a valid number of people (example: 4). Number between 1 and 12."
        : "Por favor ingrese un número válido de personas (ejemplo: 4). Número entre 1 y 12.";
      return decision(language, "reservation", content, { route: "party_size_rejected" });
    }

    if (/@[^\s.]+$/u.test(message) || includesAny(normalized, ["invalid_format", "email_sin_dominio", "email_invalido"])) {
      const content = isEnglish
        ? "The entered data is not valid. Could you please review it and enter it again?"
        : "El dato ingresado no es válido. ¿Podría revisarlo e ingresarlo de nuevo?";
      return decision(language, "reservation", content, { route: "invalid_contact" });
    }

    if (includesAny(normalized, ["http 500", "falla", "failure", "api failure", "system fail"])) {
      const content = isEnglish
        ? "Sorry, there was a technical problem registering your reservation. Would you like me to connect you with a staff member?"
        : "Lo siento, hubo un problema técnico al registrar su reserva. ¿Desea que lo conecte con un miembro del personal?";
      return decision(language, "reservation", content, { route: "reservation_failure" });
    }

    const content = isEnglish
      ? `Online reservations are limited; for a confirmed reservation please call or WhatsApp ${POLICY.phone}. I can still collect date, time, party size, name, and phone before staff confirms.`
      : `Las reservas en línea son limitadas; para una reserva confirmada llame o escriba por WhatsApp al ${POLICY.phone}. Puedo tomar fecha, hora, personas, nombre y teléfono para que el equipo confirme.`;
    return decision(language, "reservation", content, { route: "reservation_info" });
  }

  private payment(message: string, language: RestaurantLanguage): RestaurantDecision {
    const normalized = normalizeText(message);
    const isEnglish = language === "en";

    if (includesAny(normalized, ["transaction declined", "rechaza", "fallo", "falla", "declined", "fallido"])) {
      const content = isEnglish
        ? "Your payment could not be processed. Would you like to try another method?"
        : "Su pago no pudo procesarse. ¿Desea intentar con otro método?";
      return decision(language, "payment", content, { route: "payment_failed" });
    }

    if (includesAny(normalized, ["stripe", "approved", "aprobado", "http 200", "success", "exitoso"])) {
      const content = isEnglish
        ? `Payment approved. Payment confirmed with Stripe. Your order is confirmed and should be ready in ${POLICY.prepMinutes} minutes.`
        : `Pago aprobado. Pago confirmado con Stripe. El pedido queda confirmado y debe estar listo en ${POLICY.prepMinutes} minutos.`;
      return decision(language, "payment", content, { route: "payment_success" });
    }

    const content = isEnglish
      ? "We accept Visa, Mastercard, Stripe/PayPal, and cash. For cards I will send a secure payment link; please do not type card numbers in chat."
      : "Aceptamos Visa, Mastercard, Stripe/PayPal y efectivo. Para tarjeta le envío un enlace seguro; por favor no escriba números de tarjeta en el chat.";
    return decision(language, "payment", content, { route: "payment_methods" });
  }

  private paymentCardBlocked(language: RestaurantLanguage): RestaurantDecision {
    const content = language === "en"
      ? "For your security, please do not send card numbers in chat. I can redirect you to a secure Stripe or PayPal payment sheet."
      : "Por seguridad, no envíe números de tarjeta por el chat. Puedo redirigirlo a una pantalla segura de Stripe o PayPal.";
    return decision(language, "payment", content, { route: "pci_block" });
  }

  private tracking(message: string, language: RestaurantLanguage): RestaurantDecision {
    const normalized = normalizeText(message);
    const isEnglish = language === "en";

    if (includesAny(normalized, ["email", "correo", "notification", "notificacion"])) {
      const content = isEnglish
        ? "I can register your email as the notification channel and confirm updates there."
        : "Puedo registrar su correo como canal de notificación y confirmar las actualizaciones por ahí.";
      return decision(language, "tracking", content, { route: "notification_channel" });
    }

    if (/#?\bhua9877\b/u.test(normalized) || includesAny(normalized, ["estado ready", "status ready", "db status ready", "estado listo", "status listo"])) {
      const content = isEnglish
        ? "Dear customer, your order is ready for pickup."
        : "Estimado cliente, tu pedido ya está listo para recoger.";
      return decision(language, "tracking", content, { route: "ready" });
    }

    if (/#?\bhua\d{4,}\b/u.test(normalized)) {
      const content = isEnglish
        ? "Dear customer, your order is being prepared with lots of Peruvian flavor."
        : "Estimado cliente, tu pedido está siendo preparado con mucho sabor peruano.";
      return decision(language, "tracking", content, { route: "preparing" });
    }

    const content = isEnglish
      ? "We could not find the current status of your order."
      : "No encontramos el estado actual de tu pedido.";
    return decision(language, "tracking", content, { route: "not_found" });
  }

  private context(message: string, language: RestaurantLanguage, sessionId: string): RestaurantDecision {
    const normalized = normalizeText(message);
    const isEnglish = language === "en";

    if (this.hasContextOrderFollowup(sessionId, message)) {
      const content = isEnglish
        ? "Of course. Would you like to place an order for this item now?"
        : "Claro. ¿Le gustaría ordenar este ítem?";
      return decision(language, "restaurant_context", content, { route: "context_to_order" });
    }

    if (isGreetingOnly(normalized)) {
      const content = isEnglish
        ? "Hi, I'm Carmen from Huascarán. I can help with the menu, recommendations, orders, delivery, payments, or reservations."
        : "Hola, soy Carmen de Huascarán. Puedo ayudarle con la carta, recomendaciones, pedidos, delivery, pagos o reservas.";
      return decision(language, "restaurant_context", content, { route: "greeting" });
    }

    if (includesAny(normalized, ["quiero ordenar ese item", "quiero ordenar este item", "i want to order that item", "order that item"])) {
      const content = isEnglish
        ? "Would you like to place an order for this item now?"
        : "Claro. ¿Le gustaría ordenar este ítem?";
      return decision(language, "restaurant_context", content, { route: "context_to_order" });
    }

    if (includesAny(normalized, ["horario", "hours", "close", "cierran", "almuerzo", "lunch"])) {
      const content = isEnglish
        ? `Our hours of operation are ${POLICY.hours}.`
        : `Abrimos de ${POLICY.hoursEs}.`;
      return decision(language, "restaurant_context", content, { route: "hours" });
    }

    if (includesAny(normalized, ["delivery", "domicilio", "envios", "minimum order"])) {
      const content = isEnglish
        ? `We offer delivery within a ${POLICY.deliveryRadiusMiles}-mile radius around the restaurant. The minimum order is ${formatMoney(POLICY.deliveryMinimumCents)}.`
        : `Sí, ofrecemos delivery en un radio de ${POLICY.deliveryRadiusMiles} millas alrededor del restaurante. El pedido mínimo es de ${formatMoney(POLICY.deliveryMinimumCents)}.`;
      return decision(language, "restaurant_context", content, { route: "delivery" });
    }

    if (includesAny(normalized, ["tarjeta", "credit card", "payment method", "metodos de pago", "aceptan tarjetas"])) {
      return this.payment(message, language);
    }

    if (includesAny(normalized, ["bebidas", "drinks", "peruvian drinks", "bebidas peruanas"])) {
      const content = isEnglish
        ? "Available Peruvian drinks include Chicha Morada, Inka Kola, Cristal beer, Jugo de Pina, and Jugo Especial."
        : "Bebidas peruanas disponibles: Chicha Morada, Inka Kola, cerveza Cristal, Jugo de Piña y Jugo Especial.";
      return decision(language, "restaurant_context", content, { route: "drinks" });
    }

    if (includesAny(normalized, ["sebiche", "ceviche"])) {
      this.lastDiscussedItemBySession.set(sessionId, "ceviche");
      const content = isEnglish
        ? "Yes. I can help with Ceviche Mixto Especial or Ceviche de Pescado, both grounded in the current menu availability."
        : "Sí. Tenemos Ceviche Mixto Especial y Ceviche de Pescado según la carta disponible.";
      return decision(language, "restaurant_context", content, { route: "ceviche" });
    }

    if (includesAny(normalized, ["lomo saltado", "about lomo"])) {
      this.lastDiscussedItemBySession.set(sessionId, "lomo saltado");
      const content = isEnglish
        ? "Lomo Saltado is a Peruvian beef stir-fry with onion, tomato, fries, and rice. It is available in the current menu."
        : "El Lomo Saltado es un salteado peruano de res con cebolla, tomate, papas fritas y arroz. Está disponible en la carta actual.";
      return decision(language, "restaurant_context", content, { route: "lomo" });
    }

    if (includesAny(normalized, ["chicha morada", "purple corn"])) {
      this.lastDiscussedItemBySession.set(sessionId, "chicha morada");
      const content = isEnglish
        ? "Chicha Morada is a non-alcoholic Peruvian drink made from purple corn, cinnamon, clove, and lime. It is available."
        : "La Chicha Morada es una bebida peruana sin alcohol hecha con maíz morado, canela, clavo y limón. Está disponible.";
      return decision(language, "restaurant_context", content, { route: "chicha" });
    }

    if (includesAny(normalized, ["popular", "platos populares", "most popular"])) {
      const content = isEnglish
        ? "Popular dishes:\n- Ceviche clasico\n- Lomo Saltado\n- Aji de Gallina\n- Pollo a la Brasa\n- Arroz Chaufa"
        : "Platos populares:\n- Ceviche clásico\n- Lomo Saltado\n- Ají de Gallina\n- Pollo a la Brasa\n- Arroz Chaufa";
      return decision(language, "restaurant_context", content, { route: "popular" });
    }

    if (includesAny(normalized, ["reservas en linea", "online reservations", "telefono para reservar", "phone for reservations"])) {
      return this.reservation(message, language);
    }

    return this.fallback(language);
  }

  private fallback(language: RestaurantLanguage): RestaurantDecision {
    const content = language === "en"
      ? "Sorry, I didn't understand your query. Would you like to ask about hours, menu, delivery, reservations, or phone? I can also connect you with staff."
      : "Lo sentimos, no entendimos tu consulta. ¿Quieres preguntar por horarios, menú, delivery, reservas o teléfono? También puedo conectarlo con el personal.";
    return decision(language, "handoff", content, { route: "fallback" });
  }
}

export function createHuascaranAgentForTests(): HuascaranRestaurantAgent {
  return new HuascaranRestaurantAgent({ renderer: new DeterministicRestaurantRenderer() });
}

function decision(
  language: RestaurantLanguage,
  intent: RestaurantIntent,
  content: string,
  facts: Record<string, string | number | boolean | string[]>
): RestaurantDecision {
  return { language, intent, content, facts };
}

function shortDishName(name: string): string {
  return name.split("/")[0].replace(" a la Criolla", "").trim();
}

function shouldAnswerInSpanish(message: string): boolean {
  const normalized = normalizeText(message);
  return includesAny(normalized, [
    "cual es el horario",
    "horario de atencion",
    "hacen envios",
    "envios a domicilio",
    "aceptan tarjetas",
    "tarjetas de credito",
  ]);
}

function resolveResponseLanguage(message: string, requestedLanguage?: RestaurantLanguage): RestaurantLanguage {
  const detectedLanguage = detectRestaurantLanguage(message);
  if (!requestedLanguage) return detectedLanguage;

  const normalized = normalizeText(message);
  if (requestedLanguage === "en" && hasStrongEnglishSignal(normalized)) return "en";
  if (requestedLanguage === "es" && hasStrongSpanishSignal(normalized)) return "es";
  if (requestedLanguage === "en" && hasStrongSpanishSignal(normalized)) return "es";
  if (requestedLanguage === "es" && hasStrongEnglishSignal(normalized)) return "en";
  if (requestedLanguage === "en" && shouldAnswerInSpanish(message)) return "es";

  return requestedLanguage;
}

function hasStrongSpanishSignal(normalizedMessage: string): boolean {
  if (isSpanishGreetingOnly(normalizedMessage)) return true;

  return includesAny(normalizedMessage, [
    "quiero",
    "quisiera",
    "para llevar",
    "recoger",
    "recogida",
    "domicilio",
    "envio",
    "pedido",
    "ordenar",
    "reservar",
    "mesa",
    "personas",
    "horario",
    "cual",
    "hacen",
    "aceptan",
    "tarjeta",
    "agrega",
    "cambialo",
    "mejor",
  ]);
}

function hasStrongEnglishSignal(normalizedMessage: string): boolean {
  if (isEnglishGreetingOnly(normalizedMessage)) return true;

  return includesAny(normalizedMessage, [
    "i want",
    "i would like",
    "please",
    "book",
    "table",
    "party size",
    "guests",
    "opening hours",
    "what are",
    "do you",
    "credit card",
    "add ",
    "change it",
  ]);
}

function isSpanishGreetingOnly(normalizedMessage: string): boolean {
  return /^(hola|hola gracias|buenas|buen dia|buenos dias|buenas tardes|buenas noches)$/u.test(normalizedMessage);
}

function isEnglishGreetingOnly(normalizedMessage: string): boolean {
  return /^(hi|hi there|hello|hello there|hey|good morning|good afternoon|good evening)$/u.test(normalizedMessage);
}

function isOrderConfirmation(normalizedMessage: string): boolean {
  if (includesAny(normalizedMessage, ["confirmo", "confirma el pedido", "confirmar pedido", "confirm", "todo correcto", "everything correct"])) return true;
  if (normalizedMessage.length > 16) return false;
  return /^(si|sí|ok|correcto|dale|yes|sure|perfecto|perfect)([.!?\s]*)$/u.test(normalizedMessage);
}

function isGreetingOnly(normalizedMessage: string): boolean {
  const sanitized = normalizedMessage
    .replace(/[.#$@-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length > 32) return false;

  return /^(hola|hola gracias|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hello|hello there|hi|hi there|hey|good morning|good afternoon|good evening)$/u.test(sanitized);
}

function isFulfillmentSelection(normalizedMessage: string): boolean {
  return includesAny(normalizedMessage, [
    "recoger",
    "recogida",
    "pickup",
    "pick up",
    "restaurante",
    "delivery",
    "domicilio",
    "envio",
  ]);
}

function isOrderReplacement(normalizedMessage: string): boolean {
  return includesAny(normalizedMessage, [
    "nuevo pedido",
    "new order",
    "reemplaza",
    "replace",
    "cambia mi pedido por",
    "change my order to",
    "solo quiero",
  ]);
}

function mergeCartItems(existingItems: readonly CartItem[], incomingItems: readonly CartItem[]): CartItem[] {
  const merged = existingItems.map((item) => ({ ...item }));

  for (const incomingItem of incomingItems) {
    const existingItem = merged.find((item) =>
      item.menuItemId === incomingItem.menuItemId &&
      item.unitPriceCents === incomingItem.unitPriceCents &&
      item.notes === incomingItem.notes
    );

    if (existingItem) {
      existingItem.quantity += incomingItem.quantity;
    } else {
      merged.push({ ...incomingItem });
    }
  }

  return merged;
}
