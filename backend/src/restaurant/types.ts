export type RestaurantLanguage = "es" | "en";

export type RestaurantIntent =
  | "menu_recommendation"
  | "order"
  | "reservation"
  | "payment"
  | "tracking"
  | "restaurant_context"
  | "handoff";

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  status: "available" | "sold_out";
  vegan: boolean;
  spicy: boolean;
  allergens: string[];
  aliases: string[];
}

export interface CartItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  notes?: string;
}

export interface OrderDraft {
  id: string;
  sessionId: string;
  items: CartItem[];
  subtotalCents: number;
  orderType: "pickup" | "delivery" | "dine_in";
  status: "draft" | "payment_pending" | "confirmed";
  customerName?: string;
  customerPhone?: string;
  address?: string;
}

export interface RestaurantRequest {
  sessionId?: string;
  message: string;
  language?: RestaurantLanguage;
}

export interface RestaurantReply {
  sessionId: string;
  language: RestaurantLanguage;
  intent: RestaurantIntent;
  message: string;
  orderDraft?: OrderDraft;
  matchedItems?: MenuItem[];
}

export interface RestaurantDecision {
  language: RestaurantLanguage;
  intent: RestaurantIntent;
  content: string;
  facts: Record<string, string | number | boolean | string[]>;
}

export interface RestaurantRenderer {
  render(decision: RestaurantDecision): Promise<string>;
}

export interface RestaurantWidgetLead {
  id: string;
  sessionId: string;
  language: RestaurantLanguage;
  status: "active" | "ordering" | "confirmed_order";
  firstMessage: string;
  lastMessage: string;
  messageCount: number;
  orderCount: number;
  startedAt: string;
  updatedAt: string;
}

export interface RestaurantOperationsOrder {
  id: string;
  sessionId: string;
  status: OrderDraft["status"];
  orderType: OrderDraft["orderType"];
  subtotalCents: number;
  itemCount: number;
  customerName?: string;
  customerPhone?: string;
  address?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RestaurantMessageEvent {
  id: string;
  sessionId: string;
  role: "guest" | "carmen";
  text: string;
  intent: RestaurantIntent;
  createdAt: string;
}

export interface RestaurantOperationsSnapshot {
  restaurant: "huascaran";
  source: {
    workflowId: "ni7gOmc3W1JIujFf";
    childWorkflowId: "nVRQtD0nVAmEed9s";
    persona: "Carmen";
    menuSource: "NocoDB Huascarán / Platos";
    speechSource: "Extracted Qdrant carmen_speech bilingual templates";
    menuCount: number;
    deepseek: boolean;
  };
  summary: {
    totalLeads: number;
    totalOrders: number;
    confirmedOrders: number;
    totalMessages: number;
  };
  leads: RestaurantWidgetLead[];
  orders: RestaurantOperationsOrder[];
  messages: RestaurantMessageEvent[];
}
