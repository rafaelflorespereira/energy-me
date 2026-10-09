# Read-only share link

Status: implemented. Decided with Rafa on 2026-10-09.

## What it does

The owner opens **Compartilhar meus sentimentos** in the account menu and generates a link such as `https://energy-me.vercel.app/ver#<token>`. Whoever opens it sees the Summary screen (week/month analysis, charts) and today's scenery, without logging in and without any control that changes data. The owner's name and e-mail are never sent.

Decisions:

1. **One link per account.** Generating a new link deactivates the previous one at once. The owner can also deactivate it.
2. **Validity chosen at creation:** 7 days, 30 days, or until deactivated.
3. **Window:** the visitor receives the last 60 days (current and previous month of the analysis), plus one day of slack on each side for time zones.

## Privacy

- The token is 32 random bytes (base64url, 43 characters). The table stores only its SHA-256, so reading the table does not rebuild a link. The full link is shown to the owner once, right after creation.
- The token travels after `#`, which browsers never send to the page server, so it does not reach Vercel logs. The API receives it in the path; API access logs record only the route key, not the path.
- `/ver` is served with `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
- Malformed, unknown, deactivated and expired links all return the same `404 NOT_FOUND`.
- The charts are built from daily intensities, so the visitor can infer each day's values inside the window. The window limit is the real control, not "summary only".

## Storage

Table `energy-me-shares-<stage>`, partition key `pk`, two items per link written in one transaction:

| `pk` | Attributes | Used by |
|---|---|---|
| `token#<sha256>` | `ownerId`, `createdAt`, `expiresAt?`, `ttl?` | public view (consistent `GetItem`) |
| `owner#<sub>` | `tokenHash`, `createdAt`, `expiresAt?`, `ttl?` | owner reads, replaces or deactivates |

Replacing a link deletes the old `token#` item in the same transaction, conditioned on the owner item still pointing at it, so two concurrent requests cannot leave an orphan link (the loser gets `409 CONFLICT`). DynamoDB TTL removes expired items later; reads check `expiresAt` themselves.

## API

| Route | Auth | Result |
|---|---|---|
| `GET /share` | Cognito access token | `{ share: { createdAt, expiresAt } \| null }` |
| `PUT /share` body `{ expiresInDays: 7 \| 30 \| null }` | Cognito access token | `201 { token, share }`, previous link stops working |
| `DELETE /share` | Cognito access token | `{ share: null }` |
| `GET /public/share/{token}` | none | `{ items: [{ date, values }], expiresAt }` or `404` |

The share Lambda can `GetItem`/`PutItem`/`DeleteItem` on the shares table and only `Query` on the check-ins table.
