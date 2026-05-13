import Fastify, { type FastifyReply } from "fastify";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HuascaranRestaurantAgent } from "./restaurant-agent.js";
import { subtotalCents } from "./menu-catalog.js";
import type { CartItem } from "./types.js";

const chatSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1),
  language: z.enum(["es", "en"]).optional(),
});

const draftSchema = z.object({
  sessionId: z.string().min(1),
  items: z.array(z.object({
    menuItemId: z.string().min(1),
    name: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPriceCents: z.number().int().nonnegative(),
    notes: z.string().optional(),
  })).min(1),
  orderType: z.enum(["pickup", "delivery", "dine_in"]),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  address: z.string().optional(),
});

const STATIC_MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

async function sendStaticFile(reply: FastifyReply, filePath: string): Promise<void> {
  const extension = path.extname(filePath).toLowerCase();
  const payload = await readFile(filePath);
  reply.header("Content-Type", STATIC_MIME[extension] ?? "application/octet-stream");
  reply.send(payload);
}

function resolveStaticPath(frontendDistDir: string, requestPath: string): string | null {
  const decodedPath = decodeURIComponent(requestPath.split("?")[0] ?? "/");
  const relativePath = decodedPath === "/" || !path.extname(decodedPath)
    ? "index.html"
    : decodedPath.replace(/^\/+/, "");
  const resolvedPath = path.resolve(frontendDistDir, relativePath);
  return resolvedPath.startsWith(frontendDistDir) ? resolvedPath : null;
}

export function buildRestaurantServer(): ReturnType<typeof Fastify> {
  const app = Fastify({ logger: false });
  const agent = new HuascaranRestaurantAgent();
  const frontendDistDir = resolveFrontendDistDir();

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (request.method === "OPTIONS") return reply.status(204).send();
  });

  app.get("/health", async () => ({
    status: "healthy",
    service: "huascaran-restaurant-agent",
    deepseek: process.env.HUASCARAN_USE_DEEPSEEK === "1" && Boolean(process.env.DEEPSEEK_API_KEY),
    qdrant: await agent.getKnowledgeStatus(),
  }));

  app.get("/api/restaurant/menu", async () => ({
    restaurant: "huascaran",
    count: agent.getMenu().length,
    items: agent.getMenu(),
  }));

  app.get("/api/restaurant/operations", async () => agent.getOperationsSnapshot());

  app.post("/api/restaurant/chat/demo", async (request, reply) => {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: "VALIDATION_ERROR", issues: parsed.error.flatten().fieldErrors });
      return;
    }
    return agent.respond(parsed.data);
  });

  app.post("/api/restaurant/orders/draft", async (request, reply) => {
    const parsed = draftSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: "VALIDATION_ERROR", issues: parsed.error.flatten().fieldErrors });
      return;
    }
    const items: CartItem[] = parsed.data.items;
    const draft = agent.createOrderDraft({ ...parsed.data, items });
    return { ...draft, subtotalCents: subtotalCents(draft.items) };
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (!["GET", "HEAD"].includes(request.method) || request.url.startsWith("/api/")) {
      reply.status(404).send({ error: "NOT_FOUND" });
      return;
    }

    const staticPath = resolveStaticPath(frontendDistDir, request.url);
    if (!staticPath) {
      reply.status(404).send({ error: "NOT_FOUND" });
      return;
    }

    try {
      await sendStaticFile(reply, staticPath);
    } catch {
      if (path.basename(staticPath) !== "index.html") {
        try {
          await sendStaticFile(reply, path.join(frontendDistDir, "index.html"));
          return;
        } catch {
          // Fall through to the explicit static 404 response.
        }
      }
      reply.status(404).send({ error: "STATIC_ASSET_NOT_FOUND" });
    }
  });

  return app;
}

function resolveFrontendDistDir(): string {
  const candidates = [
    process.env.FRONTEND_DIST_DIR,
    path.join(process.cwd(), "frontend", "dist"),
    path.join(process.cwd(), "..", "frontend", "dist"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return path.resolve(candidates.find((candidate) => existsSync(path.resolve(candidate))) ?? candidates[0]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? process.env.HUASCARAN_PORT ?? 18181);
  const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  const app = buildRestaurantServer();
  await app.listen({ port, host });
  console.log(`Huascaran restaurant agent listening on http://${host}:${port}`);
}
