# Pictoriya Server

API for the Pictoriya illustrated library (Node + Express + MongoDB + optional Cloudflare R2).

Pair with the website: [pictoria-client](https://github.com/sjAnupa/pictoria-client).

## Local development

1. Copy env and set real values (MongoDB Atlas URI, JWT secret, OAuth, optional R2):

```bash
cp .env.example .env
```

2. Install and run:

```bash
npm install
npm run dev
```

API listens on `http://localhost:5000` (default). Health check: `GET /api/health`.

`CLIENT_URL` must match the website origin (`http://localhost:5173` in local dev).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | API with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled `dist/` |
| `npm run seed:books` | Dev sample catalog (do not use on production data you do not own) |
| `npm run migrate:r2` | Upload local chapter pages to R2 |

## Storage

- **Covers** stay on disk under `uploads/covers/`.
- **Chapter pages** use Cloudflare R2 when credentials are real; otherwise local `uploads/pages/`.

## Deploy

Run as a long-lived Node process behind HTTPS. Put secrets in the host environment, never in git. Set `CLIENT_URL` to the public website origin and configure Google OAuth for that origin.
