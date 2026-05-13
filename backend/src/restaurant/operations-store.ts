import { randomUUID } from "node:crypto";
import type {
  OrderDraft,
  RestaurantIntent,
  RestaurantLanguage,
  RestaurantMessageEvent,
  RestaurantOperationsOrder,
  RestaurantOperationsSnapshot,
  RestaurantWidgetLead,
} from "./types.js";
import { maskPaymentCardNumbers } from "./text.js";

const MAX_MESSAGES = 80;

export class RestaurantOperationsStore {
  private readonly leads = new Map<string, RestaurantWidgetLead>();
  private readonly orders = new Map<string, RestaurantOperationsOrder>();
  private readonly messages: RestaurantMessageEvent[] = [];

  recordInbound(input: { sessionId: string; language: RestaurantLanguage; message: string; intent: RestaurantIntent }): void {
    const safeMessage = maskSensitiveText(input.message);
    const lead = this.ensureLead(input.sessionId, input.language, safeMessage);
    lead.lastMessage = safeMessage;
    lead.updatedAt = new Date().toISOString();
    lead.messageCount += 1;
    this.pushMessage({
      id: randomUUID(),
      sessionId: input.sessionId,
      role: "guest",
      text: safeMessage,
      intent: input.intent,
      createdAt: lead.updatedAt,
    });
  }

  recordOutbound(input: { sessionId: string; text: string; intent: RestaurantIntent }): void {
    const lead = this.leads.get(input.sessionId);
    const createdAt = new Date().toISOString();
    if (lead) {
      lead.updatedAt = createdAt;
      lead.lastMessage = input.text;
    }
    this.pushMessage({
      id: randomUUID(),
      sessionId: input.sessionId,
      role: "carmen",
      text: input.text,
      intent: input.intent,
      createdAt,
    });
  }

  recordOrder(draft: OrderDraft): void {
    const existing = this.orders.get(draft.id);
    const now = new Date().toISOString();
    this.orders.set(draft.id, {
      id: draft.id,
      sessionId: draft.sessionId,
      status: draft.status,
      orderType: draft.orderType,
      subtotalCents: draft.subtotalCents,
      itemCount: draft.items.reduce((total, item) => total + item.quantity, 0),
      customerName: draft.customerName,
      customerPhone: draft.customerPhone,
      address: draft.address,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    const lead = this.leads.get(draft.sessionId);
    if (lead) {
      lead.orderCount = Array.from(this.orders.values()).filter((order) => order.sessionId === draft.sessionId).length;
      lead.status = draft.status === "confirmed" ? "confirmed_order" : "ordering";
      lead.updatedAt = now;
    }
  }

  snapshot(input: { menuCount: number; deepseek: boolean }): RestaurantOperationsSnapshot {
    const leads = Array.from(this.leads.values()).sort(sortByUpdatedAt).slice(0, 12);
    const orders = Array.from(this.orders.values()).sort(sortByUpdatedAt).slice(0, 12);
    const messages = [...this.messages].reverse().slice(0, 12);
    return {
      restaurant: "huascaran",
      source: {
        workflowId: "ni7gOmc3W1JIujFf",
        childWorkflowId: "nVRQtD0nVAmEed9s",
        persona: "Carmen",
        menuSource: "NocoDB Huascarán / Platos",
        speechSource: "Extracted Qdrant carmen_speech bilingual templates",
        menuCount: input.menuCount,
        deepseek: input.deepseek,
      },
      summary: {
        totalLeads: this.leads.size,
        totalOrders: this.orders.size,
        confirmedOrders: Array.from(this.orders.values()).filter((order) => order.status === "confirmed").length,
        totalMessages: this.messages.length,
      },
      leads,
      orders,
      messages,
    };
  }

  private ensureLead(sessionId: string, language: RestaurantLanguage, firstMessage: string): RestaurantWidgetLead {
    const existing = this.leads.get(sessionId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const lead: RestaurantWidgetLead = {
      id: `lead-${randomUUID().slice(0, 8)}`,
      sessionId,
      language,
      status: "active",
      firstMessage,
      lastMessage: firstMessage,
      messageCount: 0,
      orderCount: 0,
      startedAt: now,
      updatedAt: now,
    };
    this.leads.set(sessionId, lead);
    return lead;
  }

  private pushMessage(message: RestaurantMessageEvent): void {
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
  }
}

function sortByUpdatedAt<T extends { updatedAt: string }>(left: T, right: T): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function maskSensitiveText(text: string): string {
  return maskPaymentCardNumbers(text);
}
