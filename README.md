# H2obot — Local Dev

## Run

In one terminal:

```bash
npm run backend:dev
```

In another terminal:

```bash
npm run frontend:dev
```

Frontend runs at http://localhost:5173 and calls http://localhost:8787 by default.

## Switch transport modes

Open the browser devtools console and set:

```js
window.H2OBOT_MODE = 'MOCK'  // or 'JSON' | 'SSE'
window.location.reload()
```

To target a different API base:

```js
window.H2OBOT_API_BASE = 'http://localhost:8787'
window.location.reload()
```

## API contract

See `backend/openapi.yaml` and `backend/types.ts`. The mock server implements:
- `POST /api/h2obot/query` returning JSON
- `GET /api/h2obot/stream` sending SSE events (start/delta/sources/safety/suggestions/done)

