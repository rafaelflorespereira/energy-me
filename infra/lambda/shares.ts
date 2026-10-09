import { createHash, randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

// Link de leitura: cada conta tem no máximo um link ativo. Gerar outro
// desativa o anterior. O link carrega um código aleatório de 256 bits; a
// tabela guarda só o SHA-256 dele, então ler a tabela não reconstrói o link.
//
// Dois itens por link, gravados juntos numa transação:
//   pk = "token#<hash>"  -> dono e validade (leitura pública, consistente)
//   pk = "owner#<sub>"   -> hash do link ativo (para revogar ou trocar)

export const EXPIRY_DAYS = [7, 30] as const;
/** Quantos dias para trás o visitante vê: cobre o mês atual e o anterior. */
export const WINDOW_DAYS = 60;
export const MAX_BODY_BYTES = 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

type Command = GetCommand | QueryCommand | TransactWriteCommand;

/** O mínimo do DynamoDBDocumentClient que o handler usa; trocado nos testes. */
export interface Deps {
  send(command: Command): Promise<unknown>;
  sharesTable: string;
  checkInsTable: string;
  now(): Date;
  randomToken(): string;
}

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
type Result = APIGatewayProxyStructuredResultV2;

class BadRequest extends Error {}

function json(statusCode: number, body: unknown): Result {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function error(statusCode: number, code: string, event: Event): Result {
  return json(statusCode, {
    error: code,
    requestId: event.requestContext.requestId,
  });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const tokenKey = (hash: string) => ({ pk: `token#${hash}` });
const ownerKey = (userId: string) => ({ pk: `owner#${userId}` });

interface ShareItem {
  tokenHash: string;
  createdAt: string;
  expiresAt?: string;
}

function isActive(item: { expiresAt?: unknown } | undefined, now: Date) {
  if (!item) return false;
  return (
    typeof item.expiresAt !== "string" ||
    Date.parse(item.expiresAt) > now.getTime()
  );
}

function publicShare(item: ShareItem) {
  return { createdAt: item.createdAt, expiresAt: item.expiresAt ?? null };
}

function parseExpiry(event: Event): number | null {
  if (!event.body) throw new BadRequest("missing body");
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new BadRequest("body too large");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BadRequest("body must be JSON");
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("expiresInDays" in body)
  ) {
    throw new BadRequest("body must be { expiresInDays }");
  }
  const days = (body as { expiresInDays: unknown }).expiresInDays;
  if (days === null) return null;
  if (!(EXPIRY_DAYS as readonly unknown[]).includes(days)) {
    throw new BadRequest("expiresInDays must be 7, 30 or null");
  }
  return days as number;
}

async function currentShare(
  deps: Deps,
  userId: string,
): Promise<ShareItem | undefined> {
  const result = (await deps.send(
    new GetCommand({
      TableName: deps.sharesTable,
      Key: ownerKey(userId),
      ConsistentRead: true,
    }),
  )) as { Item?: Record<string, unknown> };
  const item = result.Item;
  if (!item || typeof item.tokenHash !== "string") return undefined;
  return item as unknown as ShareItem;
}

async function getShare(deps: Deps, userId: string): Promise<Result> {
  const item = await currentShare(deps, userId);
  return json(200, {
    share: item && isActive(item, deps.now()) ? publicShare(item) : null,
  });
}

async function createShare(
  deps: Deps,
  userId: string,
  event: Event,
): Promise<Result> {
  const days = parseExpiry(event);
  const now = deps.now();
  const previous = await currentShare(deps, userId);
  const token = deps.randomToken();
  const item: ShareItem = {
    tokenHash: hashToken(token),
    createdAt: now.toISOString(),
    ...(days ? { expiresAt: new Date(now.getTime() + days * DAY_MS).toISOString() } : {}),
  };
  // TTL do DynamoDB apaga links vencidos sozinho (com atraso; a leitura confere).
  const ttl = item.expiresAt
    ? { ttl: Math.floor(Date.parse(item.expiresAt) / 1000) }
    : {};

  await deps.send(
    new TransactWriteCommand({
      TransactItems: [
        ...(previous
          ? [
              {
                Delete: {
                  TableName: deps.sharesTable,
                  Key: tokenKey(previous.tokenHash),
                },
              },
            ]
          : []),
        {
          Put: {
            TableName: deps.sharesTable,
            Item: {
              ...tokenKey(item.tokenHash),
              ownerId: userId,
              createdAt: item.createdAt,
              ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
              ...ttl,
            },
          },
        },
        {
          // A condição evita que dois pedidos simultâneos deixem um link órfão.
          Put: {
            TableName: deps.sharesTable,
            Item: { ...ownerKey(userId), ...item, ...ttl },
            ...(previous
              ? {
                  ConditionExpression: "tokenHash = :previous",
                  ExpressionAttributeValues: { ":previous": previous.tokenHash },
                }
              : { ConditionExpression: "attribute_not_exists(pk)" }),
          },
        },
      ],
    }),
  );
  return json(201, { token, share: publicShare(item) });
}

async function revokeShare(deps: Deps, userId: string): Promise<Result> {
  const previous = await currentShare(deps, userId);
  if (previous) {
    await deps.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: deps.sharesTable,
              Key: tokenKey(previous.tokenHash),
            },
          },
          {
            Delete: {
              TableName: deps.sharesTable,
              Key: ownerKey(userId),
              ConditionExpression: "tokenHash = :previous",
              ExpressionAttributeValues: { ":previous": previous.tokenHash },
            },
          },
        ],
      }),
    );
  }
  return json(200, { share: null });
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

async function viewShare(deps: Deps, event: Event): Promise<Result> {
  const token = event.pathParameters?.token;
  // Formato errado, inexistente, revogado ou vencido: sempre a mesma resposta.
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    return error(404, "NOT_FOUND", event);
  }
  const now = deps.now();
  const found = (await deps.send(
    new GetCommand({
      TableName: deps.sharesTable,
      Key: tokenKey(hashToken(token)),
      ConsistentRead: true,
    }),
  )) as { Item?: Record<string, unknown> };
  const share = found.Item;
  if (!share || typeof share.ownerId !== "string" || !isActive(share, now)) {
    return error(404, "NOT_FOUND", event);
  }

  // Um dia de folga em cada ponta por causa do fuso de quem vê.
  const from = dateKey(new Date(now.getTime() - WINDOW_DAYS * DAY_MS));
  const to = dateKey(new Date(now.getTime() + DAY_MS));
  const result = (await deps.send(
    new QueryCommand({
      TableName: deps.checkInsTable,
      KeyConditionExpression: "userId = :userId AND #date BETWEEN :from AND :to",
      ExpressionAttributeNames: { "#date": "date", "#values": "values" },
      ExpressionAttributeValues: { ":userId": share.ownerId, ":from": from, ":to": to },
      ProjectionExpression: "#date, #values",
      ScanIndexForward: true,
      Limit: WINDOW_DAYS + 2,
    }),
  )) as { Items?: Record<string, unknown>[] };
  // Nada que identifique o dono: só datas e intensidades da janela.
  return json(200, {
    items: (result.Items ?? []).map((raw) => ({
      date: raw.date,
      values: raw.values,
    })),
    expiresAt: typeof share.expiresAt === "string" ? share.expiresAt : null,
  });
}

const RETRYABLE = new Set([
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
]);

export function createHandler(deps: Deps) {
  return async function handler(event: Event): Promise<Result> {
    try {
      if (event.routeKey === "GET /public/share/{token}") {
        return await viewShare(deps, event);
      }
      const claims = event.requestContext.authorizer?.jwt?.claims;
      if (
        !claims ||
        typeof claims.sub !== "string" ||
        !claims.sub ||
        claims.token_use !== "access"
      ) {
        return error(403, "ACCESS_TOKEN_REQUIRED", event);
      }
      const userId = claims.sub;
      switch (event.routeKey) {
        case "GET /share":
          return await getShare(deps, userId);
        case "PUT /share":
          return await createShare(deps, userId, event);
        case "DELETE /share":
          return await revokeShare(deps, userId);
        default:
          return error(404, "NOT_FOUND", event);
      }
    } catch (err) {
      if (err instanceof BadRequest) {
        return json(400, {
          error: "INVALID_REQUEST",
          message: err.message,
          requestId: event.requestContext.requestId,
        });
      }
      const name = (err as { name?: string } | null)?.name ?? "Unknown";
      // Só o nome do erro e o requestId: nunca o link, e-mail ou intensidades.
      console.error(
        JSON.stringify({
          requestId: event.requestContext.requestId,
          error: name,
        }),
      );
      if (name === "TransactionCanceledException") {
        return error(409, "CONFLICT", event);
      }
      if (RETRYABLE.has(name)) return error(429, "RETRY_LATER", event);
      return error(503, "SERVICE_UNAVAILABLE", event);
    }
  };
}

let realHandler: ReturnType<typeof createHandler> | undefined;

export async function handler(event: Event): Promise<Result> {
  realHandler ??= createHandler({
    send: (() => {
      const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
      return (command: Command) => client.send(command as never);
    })(),
    sharesTable: process.env.SHARES_TABLE_NAME ?? "",
    checkInsTable: process.env.CHECKINS_TABLE_NAME ?? "",
    now: () => new Date(),
    randomToken: () => randomBytes(32).toString("base64url"),
  });
  return realHandler(event);
}
