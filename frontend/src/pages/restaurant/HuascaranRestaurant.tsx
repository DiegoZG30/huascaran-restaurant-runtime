import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChefHat,
  ClipboardList,
  Languages,
  Loader2,
  ReceiptText,
  RefreshCw,
  Send,
  Server,
  Utensils,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  formatCurrency,
  getRestaurantHealth,
  getRestaurantMenu,
  getRestaurantOperations,
  sendRestaurantMessage,
  type MenuItem,
  type OrderDraft,
  type RestaurantHealth,
  type RestaurantIntent,
  type RestaurantLanguage,
  type RestaurantOperationsSnapshot,
} from '@/lib/restaurant-api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  intent?: RestaurantIntent;
  orderDraft?: OrderDraft;
}

const STARTERS: Record<RestaurantLanguage, string[]> = {
  es: [
    'Quiero una recomendación de carnes sin restricciones.',
    'Quiero ordenar 2x Lomo Saltado ($20), 1x Ceviche ($18), 1x Chicha Morada ($5).',
    'Hacen envíos a domicilio?',
    'Aceptan tarjetas de crédito?',
  ],
  en: [
    'Recommend a beef dish and drink.',
    'I want to order 2x Lomo Saltado ($20), 1x Ceviche ($18), 1x Chicha Morada ($5).',
    'What is the minimum order for delivery?',
    'What are your opening hours? When do you close?',
  ],
};

const INTENT_LABELS: Record<RestaurantIntent, string> = {
  menu_recommendation: 'Recommendation',
  order: 'Order',
  reservation: 'Reservation',
  payment: 'Payment',
  tracking: 'Tracking',
  restaurant_context: 'Info',
  handoff: 'Support',
};

const COMPACT_MENU_MATCHERS = [
  /lomo saltado/,
  /ceviche mixto/,
  /chicha morada/,
  /inka/,
  /picarones/,
  /house salad/,
];

function statusTone(health: RestaurantHealth | null): string {
  if (!health) return 'bg-slate-100 text-slate-700 border-slate-200';
  return health.deepseek
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';
}

function compactMenu(items: MenuItem[]): MenuItem[] {
  const picked: Array<{ item: MenuItem; rank: number }> = [];

  for (const item of items) {
    const itemName = item.name.toLowerCase();
    for (const [rank, matcher] of COMPACT_MENU_MATCHERS.entries()) {
      if (matcher.test(itemName)) {
        picked.push({ item, rank });
        break;
      }
    }
  }

  return picked.length > 0
    ? picked.sort((left, right) => left.rank - right.rank).map(({ item }) => item).slice(0, 6)
    : items.slice(0, 6);
}

export default function HuascaranRestaurant() {
  const [language, setLanguage] = useState<RestaurantLanguage>('es');
  const [health, setHealth] = useState<RestaurantHealth | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Listo. Soy el agente IA de Huascarán: puedo razonar sobre la carta, recomendar platos, armar pedidos, revisar pagos y guiar reservas.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDraft, setActiveDraft] = useState<OrderDraft | null>(null);
  const [operations, setOperations] = useState<RestaurantOperationsSnapshot | null>(null);
  const [sessionId] = useState(() => `huascaran-ui-${crypto.randomUUID()}`);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const visibleMenu = useMemo(() => compactMenu(menu), [menu]);
  const starters = STARTERS[language];

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function refreshStatus() {
    setIsBooting(true);
    setError(null);
    try {
      const [healthResponse, menuResponse] = await Promise.all([
        getRestaurantHealth(),
        getRestaurantMenu(),
      ]);
      setHealth(healthResponse);
      setMenu(menuResponse.items);
      await refreshOperations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo conectar con el backend.');
    } finally {
      setIsBooting(false);
    }
  }

  async function refreshOperations() {
    const snapshot = await getRestaurantOperations();
    setOperations(snapshot);
  }

  async function submitMessage(messageText: string) {
    const trimmed = messageText.trim();
    if (!trimmed || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmed,
    };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendRestaurantMessage({
        sessionId,
        language,
        message: trimmed,
      });
      if (response.orderDraft) setActiveDraft(response.orderDraft);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: response.message,
          intent: response.intent,
          orderDraft: response.orderDraft,
        },
      ]);
      await refreshOperations();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Error enviando mensaje.';
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: `Backend error: ${message}`,
          intent: 'handoff',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(input);
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md border border-red-200 bg-red-50">
              <ChefHat className="size-5 text-red-700" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">Huascarán AI Restaurant Agent</h1>
              <p className="text-sm text-zinc-600">Carmen, agente IA ES/EN para el chat widget del restaurante.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('gap-1.5 shadow-none', statusTone(health))}>
              {health ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
              {health ? `IA ${health.deepseek ? 'DeepSeek activa' : 'modo local'}` : 'IA pending'}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => void refreshStatus()} disabled={isBooting}>
              {isBooting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 md:px-6 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
        <section className="space-y-4">
          <div className="rounded-md border bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Server className="size-4 text-zinc-500" />
                Runtime
              </div>
              <span className="text-xs text-zinc-500">Same-origin API</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md border bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">Menu items</div>
                <div className="text-2xl font-semibold">{menu.length || '-'}</div>
              </div>
              <div className="rounded-md border bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">Language</div>
                <div className="text-2xl font-semibold uppercase">{language}</div>
              </div>
            </div>
          </div>

          <div className="rounded-md border bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Languages className="size-4 text-zinc-500" />
              Mode
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['es', 'en'] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={language === option ? 'default' : 'outline'}
                  onClick={() => setLanguage(option)}
                >
                  {option === 'es' ? 'Español' : 'English'}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-md border bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Utensils className="size-4 text-zinc-500" />
              Menu signal
            </div>
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Fuente real: NocoDB Huascarán / Platos. Esperado: 103 registros.
            </div>
            <div className="space-y-2">
              {visibleMenu.map((item) => (
                <div key={item.id} className="rounded-md border bg-zinc-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-zinc-500">{item.description}</div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold">{formatCurrency(item.priceCents)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-h-[680px] flex-col rounded-md border bg-white">
          <div className="border-b p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Bot className="size-5 text-red-700" />
                <div>
                  <h2 className="text-base font-semibold">Live conversation</h2>
                  <p className="text-xs text-zinc-500">Widget web de Carmen: recomendaciones, pedidos, reservas, pagos y contexto operativo.</p>
                </div>
              </div>
              {isLoading && (
                <Badge variant="outline" className="gap-1.5 border-blue-200 bg-blue-50 text-blue-700 shadow-none">
                  <Loader2 className="size-3.5 animate-spin" />
                  Thinking
                </Badge>
              )}
            </div>
          </div>

          <div ref={transcriptRef} className="flex-1 space-y-3 overflow-y-auto bg-zinc-50 p-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'max-w-[86%] rounded-md border p-3 text-sm leading-6',
                  message.role === 'user'
                    ? 'ml-auto border-zinc-900 bg-zinc-900 text-white'
                    : 'mr-auto border-zinc-200 bg-white text-zinc-900'
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-normal">
                    {message.role === 'user' ? 'Guest' : 'Agent'}
                  </span>
                  {message.intent && (
                    <span className="rounded border px-1.5 py-0.5 text-[11px] leading-none text-zinc-500">
                      {INTENT_LABELS[message.intent]}
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap">{message.text}</p>
                {message.orderDraft && (
                  <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                    Draft {message.orderDraft.id} · {formatCurrency(message.orderDraft.subtotalCents)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {error && (
            <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="border-t p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="rounded-md border bg-white px-2.5 py-1.5 text-xs text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
                  onClick={() => void submitMessage(starter)}
                  disabled={isLoading}
                >
                  {starter}
                </button>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={handleSubmit}>
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                className="min-h-10 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-zinc-900"
                placeholder={language === 'es' ? 'Escribe un pedido o pregunta...' : 'Type an order or question...'}
                disabled={isLoading}
              />
              <Button type="submit" disabled={isLoading || !input.trim()}>
                {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Send
              </Button>
            </form>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-md border bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ReceiptText className="size-4 text-zinc-500" />
              Active order
            </div>
            {activeDraft ? (
              <div className="space-y-3">
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-xs text-emerald-700">Draft ID</div>
                  <div className="font-mono text-sm font-semibold">{activeDraft.id}</div>
                </div>
                <div className="space-y-2">
                  {activeDraft.items.map((item) => (
                    <div key={`${item.menuItemId}-${item.name}`} className="flex items-start justify-between gap-3 border-b pb-2 text-sm last:border-b-0">
                      <div>
                        <div className="font-medium">{item.quantity}x {item.name}</div>
                        {item.notes && <div className="text-xs text-zinc-500">{item.notes}</div>}
                      </div>
                      <span className="shrink-0 font-semibold">{formatCurrency(item.unitPriceCents * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-md bg-zinc-900 px-3 py-2 text-white">
                  <span className="text-sm">Subtotal</span>
                  <span className="font-semibold">{formatCurrency(activeDraft.subtotalCents)}</span>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-zinc-500">
                Todavía no hay pedido. Escribe en el widget para crear un lead y un borrador real.
              </div>
            )}
          </div>

          <div className="rounded-md border bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="size-4 text-zinc-500" />
              Widget live data
            </div>
            {operations ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md border bg-zinc-50 p-2">
                    <div className="text-[11px] text-zinc-500">Leads</div>
                    <div className="text-xl font-semibold">{operations.summary.totalLeads}</div>
                  </div>
                  <div className="rounded-md border bg-zinc-50 p-2">
                    <div className="text-[11px] text-zinc-500">Orders</div>
                    <div className="text-xl font-semibold">{operations.summary.totalOrders}</div>
                  </div>
                  <div className="rounded-md border bg-zinc-50 p-2">
                    <div className="text-[11px] text-zinc-500">Msgs</div>
                    <div className="text-xl font-semibold">{operations.summary.totalMessages}</div>
                  </div>
                </div>

                <div className="rounded-md border bg-zinc-50 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-700">
                    <Users className="size-3.5" />
                    Recent leads
                  </div>
                  <div className="space-y-2">
                    {operations.leads.length > 0 ? operations.leads.slice(0, 3).map((lead) => (
                      <div key={lead.id} className="rounded border bg-white p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-zinc-500">{lead.sessionId.slice(0, 20)}...</span>
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5">{lead.status}</span>
                        </div>
                        <div className="mt-1 line-clamp-2 text-zinc-700">{lead.firstMessage}</div>
                      </div>
                    )) : (
                      <div className="text-xs text-zinc-500">Sin leads todavía.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-md border bg-zinc-50 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-700">
                    <ReceiptText className="size-3.5" />
                    Recent orders
                  </div>
                  <div className="space-y-2">
                    {operations.orders.length > 0 ? operations.orders.slice(0, 3).map((order) => (
                      <div key={order.id} className="rounded border bg-white p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{order.id}</span>
                          <span>{formatCurrency(order.subtotalCents)}</span>
                        </div>
                        <div className="mt-1 text-zinc-500">{order.itemCount} items · {order.orderType} · {order.status}</div>
                      </div>
                    )) : (
                      <div className="text-xs text-zinc-500">Sin pedidos todavía.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-md border bg-zinc-50 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-700">
                    <ClipboardList className="size-3.5" />
                    Recent messages
                  </div>
                  <div className="space-y-2">
                    {operations.messages.length > 0 ? operations.messages.slice(0, 4).map((message) => (
                      <div key={message.id} className="rounded border bg-white p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{message.role === 'carmen' ? 'Carmen' : 'Guest'}</span>
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5">{INTENT_LABELS[message.intent]}</span>
                        </div>
                        <div className="mt-1 line-clamp-2 text-zinc-700">{message.text}</div>
                      </div>
                    )) : (
                      <div className="text-xs text-zinc-500">Sin mensajes todavía.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-md border bg-zinc-50 p-3 text-xs text-zinc-600">
                  <div className="font-semibold text-zinc-800">n8n source parity</div>
                  <div className="mt-1">Workflow: {operations.source.workflowId}</div>
                  <div>Child order workflow: {operations.source.childWorkflowId}</div>
                  <div>Persona: {operations.source.persona}</div>
                  <div>Speech: {operations.source.speechSource}</div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-zinc-500">
                Live operations pending.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
