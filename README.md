# Lumber Yard Mini CRM

A deliberately small customer-interaction tracker built around a card-based workflow.

## What it tracks

- Customer / company
- Contact, phone, email
- Quote / order number
- Status
- Next follow-up date
- Next action
- Notes
- Interaction history: calls, emails, counter visits, quotes, orders, vendor contacts, notes
- Live search across customer records and interaction text
- Dashboard filters for follow-ups due, waiting on customer, and waiting on vendor
- Latest 10 interactions shown in the UI; full history stays in `data/crm.json`
- One-click JSON backup

## Run with Docker Compose

```bash
docker compose up -d --build
```

Open:

```text
http://SERVER-IP:3080
```

The compose file binds to `127.0.0.1` by default so it is suitable for putting behind an existing reverse proxy / Cloudflare Tunnel.

If you want direct LAN access instead, change:

```yaml
ports:
  - "127.0.0.1:3080:3080"
```

to:

```yaml
ports:
  - "3080:3080"
```

## Data

All persistent records live in:

```text
./data/crm.json
```

Back up that folder or use the **Backup JSON** button in the app.

## Update / restart

```bash
docker compose down
docker compose up -d --build
```
