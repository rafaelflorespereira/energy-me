import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

// Chaves persistidas em inglês (ver docs/checkin-persistence.md). O web app
// traduz para os IDs em português na fronteira do repositório.
export const FEELING_KEYS = [
  "anger",
  "frustration",
  "worry",
  "joy",
  "sadness",
  "guilt",
  "fear",
] as const;
export type FeelingKey = (typeof FEELING_KEYS)[number];
export type Values = Record<FeelingKey, number>;

export const MAX_INTENSITY = 4;
export const SCHEMA_VERSION = 1;
export const MAX_BODY_BYTES = 4096;
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 100;

export interface CheckInItem {
  date: string;
  values: Values;
  createdAt: string;
  updatedAt: string;
}

/** O mínimo do DynamoDBDocumentClient que o handler usa; trocado nos testes. */
export interface Deps {
  send(command: QueryCommand | UpdateCommand): Promise<unknown>;
  tableName: string;
  now(): Date;
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

/** Data de calendário real no formato YYYY-MM-DD (rejeita 2026-02-30). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function parseValues(raw: unknown): Values {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequest("values must be an object");
  }
  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.length !== FEELING_KEYS.length ||
    !keys.every((k) => (FEELING_KEYS as readonly string[]).includes(k))
  ) {
    throw new BadRequest("values must have exactly the seven feeling keys");
  }
  const values = {} as Values;
  for (const key of FEELING_KEYS) {
    const n = input[key];
    if (
      typeof n !== "number" ||
      !Number.isInteger(n) ||
      n < 0 ||
      n > MAX_INTENSITY
    ) {
      throw new BadRequest("each intensity must be an integer from 0 to 4");
    }
    values[key] = n;
  }
  if (!FEELING_KEYS.some((k) => values[k] > 0)) {
    throw new BadRequest("at least one intensity must be positive");
  }
  return values;
}

function parseBody(event: Event): unknown {
  if (!event.body) throw new BadRequest("missing body");
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new BadRequest("body too large");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest("body must be JSON");
  }
}

function toItem(raw: Record<string, unknown>): CheckInItem {
  return {
    date: raw.date as string,
    values: raw.values as Values,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
  };
}

// O cursor só carrega a data: o dono vem sempre do token, nunca do cliente.
export function encodeCursor(date: string): string {
  return Buffer.from(JSON.stringify({ date }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      parsed &&
      typeof parsed === "object" &&
      Object.keys(parsed).length === 1 &&
      isCalendarDate(parsed.date)
    ) {
      return parsed.date;
    }
  } catch {
    // cai no erro abaixo
  }
  throw new BadRequest("invalid cursor");
}

async function putCheckIn(
  deps: Deps,
  userId: string,
  event: Event,
): Promise<Result> {
  const date = event.pathParameters?.date;
  if (!isCalendarDate(date)) throw new BadRequest("invalid date");
  const body = parseBody(event);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("values" in body)
  ) {
    throw new BadRequest("body must be { values }");
  }
  const values = parseValues((body as { values: unknown }).values);
  const now = deps.now().toISOString();
  const result = (await deps.send(
    new UpdateCommand({
      TableName: deps.tableName,
      Key: { userId, date },
      UpdateExpression:
        "SET #values = :values, updatedAt = :now, schemaVersion = :version, createdAt = if_not_exists(createdAt, :now)",
      ExpressionAttributeNames: { "#values": "values" },
      ExpressionAttributeValues: {
        ":values": values,
        ":now": now,
        ":version": SCHEMA_VERSION,
      },
      ReturnValues: "ALL_NEW",
    }),
  )) as { Attributes?: Record<string, unknown> };
  return json(200, toItem(result.Attributes ?? {}));
}

async function listCheckIns(
  deps: Deps,
  userId: string,
  event: Event,
): Promise<Result> {
  const q = event.queryStringParameters ?? {};
  const from = q.from;
  const to = q.to;
  if (from !== undefined && !isCalendarDate(from)) {
    throw new BadRequest("invalid from");
  }
  if (to !== undefined && !isCalendarDate(to)) {
    throw new BadRequest("invalid to");
  }
  if (from && to && from > to) throw new BadRequest("from is after to");

  let limit = DEFAULT_LIMIT;
  if (q.limit !== undefined) {
    if (!/^\d+$/.test(q.limit)) throw new BadRequest("invalid limit");
    limit = Number(q.limit);
    if (limit < 1 || limit > MAX_LIMIT) throw new BadRequest("invalid limit");
  }

  let startDate: string | undefined;
  if (q.cursor !== undefined) {
    startDate = decodeCursor(q.cursor);
    if ((from && startDate < from) || (to && startDate > to)) {
      throw new BadRequest("cursor outside bounds");
    }
  }

  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ":userId": userId };
  let condition = "userId = :userId";
  if (from || to) {
    names["#date"] = "date";
    if (from && to) {
      condition += " AND #date BETWEEN :from AND :to";
      values[":from"] = from;
      values[":to"] = to;
    } else if (from) {
      condition += " AND #date >= :from";
      values[":from"] = from;
    } else {
      condition += " AND #date <= :to";
      values[":to"] = to;
    }
  }

  const result = (await deps.send(
    new QueryCommand({
      TableName: deps.tableName,
      KeyConditionExpression: condition,
      ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
      ExpressionAttributeValues: values,
      ScanIndexForward: true,
      ConsistentRead: true,
      Limit: limit,
      ...(startDate ? { ExclusiveStartKey: { userId, date: startDate } } : {}),
    }),
  )) as {
    Items?: Record<string, unknown>[];
    LastEvaluatedKey?: Record<string, unknown>;
  };

  const last = result.LastEvaluatedKey?.date;
  return json(200, {
    items: (result.Items ?? []).map(toItem),
    nextCursor: typeof last === "string" ? encodeCursor(last) : null,
  });
}

const RETRYABLE = new Set([
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
]);

export function createHandler(deps: Deps) {
  return async function handler(event: Event): Promise<Result> {
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

    try {
      switch (event.routeKey) {
        case "GET /checkins":
          return await listCheckIns(deps, userId, event);
        case "PUT /checkins/{date}":
          return await putCheckIn(deps, userId, event);
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
      // Só o nome do erro e o requestId: nunca token, e-mail ou intensidades.
      console.error(
        JSON.stringify({
          requestId: event.requestContext.requestId,
          error: name,
        }),
      );
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
      return (command: QueryCommand | UpdateCommand) =>
        client.send(command as never);
    })(),
    tableName: process.env.TABLE_NAME ?? "",
    now: () => new Date(),
  });
  return realHandler(event);
}
