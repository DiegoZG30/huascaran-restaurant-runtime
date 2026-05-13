# Huascaran Restaurante

Aplicacion web y backend Fastify para el chat widget operativo de Huascaran Restaurante.

## Alcance

- Solo Huascaran: la app publica monta `/restaurant` y redirige cualquier otra ruta al widget.
- Agente IA Carmen ES/EN, alineado con el workflow n8n original `Huascaran-activo`.
- Menu real incluido en `data/huascaran-menu.json` desde NocoDB `Huascarán / Platos` con 103 registros.
- Panel operativo en vivo: leads, pedidos y mensajes creados por el widget.
- DeepSeek opcional en produccion con fallback deterministico.
- Qdrant interno en Coolify para indexar la carta real y resolver consultas de platos disponibles/no disponibles sin inventar items.

## Deploy

El deploy esta preparado para Coolify con Docker:

- Puerto interno: `3000`
- Health check: `/health`
- Frontend servido por el backend en el mismo origen
- Inicio: `node dist/restaurant/local-server.js`

Variables requeridas en produccion:

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
ADMIN_EMAIL=admin@huascaran.ai
ADMIN_PASSWORD=<password-admin>
HUASCARAN_USE_DEEPSEEK=1
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
QDRANT_URL=http://qdrant:6333
QDRANT_COLLECTION=huascaran_menu
```

Endpoints principales:

- `GET /health`
- `GET /api/restaurant/menu`
- `GET /api/restaurant/operations`
- `POST /api/restaurant/chat/demo`
- `POST /api/restaurant/orders/draft`

## Comandos locales

```bash
cd backend && npm run restaurant:typecheck
cd backend && npm run restaurant:build
cd backend && npm run restaurant:acceptance
cd frontend && npm run build
docker build --provenance=false --sbom=false -t huascaran-restaurant:local .
```
