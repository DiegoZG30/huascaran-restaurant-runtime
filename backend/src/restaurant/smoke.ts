import assert from "node:assert/strict";
import { buildRestaurantServer } from "./local-server.js";

const app = buildRestaurantServer();

const health = await app.inject({ method: "GET", url: "/health" });
assert.equal(health.statusCode, 200);

const menu = await app.inject({ method: "GET", url: "/api/restaurant/menu" });
assert.equal(menu.statusCode, 200);
const menuBody = menu.json() as { count: number };
assert.ok(menuBody.count >= 8);

const chat = await app.inject({
  method: "POST",
  url: "/api/restaurant/chat/demo",
  payload: {
    sessionId: "smoke",
    language: "es",
    message: "Quiero una recomendación de carnes sin restricciones",
  },
});
assert.equal(chat.statusCode, 200);
assert.match(chat.body, /Lomo Saltado/u);

const draft = await app.inject({
  method: "POST",
  url: "/api/restaurant/orders/draft",
  payload: {
    sessionId: "smoke",
    orderType: "pickup",
    items: [{ menuItemId: "p031", name: "Lomo Saltado", quantity: 1, unitPriceCents: 2000 }],
  },
});
assert.equal(draft.statusCode, 200);
assert.match(draft.body, /HUA-/u);

await app.close();
console.log("restaurant-local-smoke PASS");
