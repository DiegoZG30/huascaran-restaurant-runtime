export type RestaurantLanguage = 'es' | 'en';

export type RestaurantIntent =
  | 'menu_recommendation'
  | 'order'
  | 'reservation'
  | 'payment'
  | 'tracking'
  | 'restaurant_context'
  | 'handoff';

export interface RestaurantHealth {
  status: 'healthy';
  service: string;
  deepseek: boolean;
}

export type HealthResponse = RestaurantHealth;

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  status: 'available' | 'sold_out';
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
  orderType: 'pickup' | 'delivery' | 'dine_in';
  status: 'draft' | 'payment_pending' | 'confirmed';
  customerName?: string;
  customerPhone?: string;
  address?: string;
}

export interface RestaurantMenuResponse {
  restaurant: 'huascaran';
  count: number;
  items: MenuItem[];
}

export interface RestaurantChatResponse {
  sessionId: string;
  language: RestaurantLanguage;
  intent: RestaurantIntent;
  message: string;
  orderDraft?: OrderDraft;
  matchedItems?: MenuItem[];
}

export interface RestaurantChatRequest {
  sessionId?: string;
  language: RestaurantLanguage;
  message: string;
}

export interface RestaurantWidgetLead {
  id: string;
  sessionId: string;
  language: RestaurantLanguage;
  status: 'active' | 'ordering' | 'confirmed_order';
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
  status: OrderDraft['status'];
  orderType: OrderDraft['orderType'];
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
  role: 'guest' | 'carmen';
  text: string;
  intent: RestaurantIntent;
  createdAt: string;
}

export interface RestaurantOperationsSnapshot {
  restaurant: 'huascaran';
  source: {
    workflowId: 'ni7gOmc3W1JIujFf';
    childWorkflowId: 'nVRQtD0nVAmEed9s';
    persona: 'Carmen';
    menuSource: 'NocoDB Huascarán / Platos';
    speechSource: 'Extracted Qdrant carmen_speech bilingual templates';
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

export interface CreateOrderDraftRequest {
  sessionId: string;
  items: CartItem[];
  orderType: 'pickup' | 'delivery' | 'dine_in';
  customerName?: string;
  customerPhone?: string;
  address?: string;
}

const RESTAURANT_API_URL = import.meta.env.VITE_RESTAURANT_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:18181' : '');
const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

async function requestJson<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${RESTAURANT_API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = `Restaurant API ${response.status}`;
    try {
      const data = await response.json() as { error?: string; message?: string };
      message = data.message || data.error || message;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }

  return await response.json() as T;
}

export function getRestaurantHealth(): Promise<RestaurantHealth> {
  return requestJson<RestaurantHealth>('/health');
}

export function getRestaurantMenu(): Promise<RestaurantMenuResponse> {
  return requestJson<RestaurantMenuResponse>('/api/restaurant/menu');
}

export function sendRestaurantMessage(payload: RestaurantChatRequest): Promise<RestaurantChatResponse> {
  return requestJson<RestaurantChatResponse>('/api/restaurant/chat/demo', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getRestaurantOperations(): Promise<RestaurantOperationsSnapshot> {
  return requestJson<RestaurantOperationsSnapshot>('/api/restaurant/operations');
}

export function createOrderDraft(payload: CreateOrderDraftRequest): Promise<OrderDraft> {
  return requestJson<OrderDraft>('/api/restaurant/orders/draft', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function formatCurrency(cents: number): string {
  return USD_FORMATTER.format(cents / 100);
}

export function formatPrice(cents: number): string {
  return formatCurrency(cents);
}
