import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { createHandler, hashToken, type Deps } from "../lambda/shares";

const NOW = new Date("2026-10-09T12:00:00.000Z");
const TOKEN = "A".repeat(43);
const OLD_TOKEN = "B".repeat(43);

function event(
  routeKey: string,
  opts: {
    claims?: Record<string, string> | null;
    token?: string;
    body?: unknown;
  } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    routeKey,
    pathParameters: opts.token === undefined ? undefined : { token: opts.token },
    body:
      opts.body === undefined
        ? undefined
        : typeof opts.body === "string"
          ? opts.body
          : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      requestId: "request-1",
      authorizer:
        opts.claims === null
          ? undefined
          : {
              jwt: {
                claims: opts.claims ?? { sub: "alice", token_use: "access" },
                scopes: ["openid"],
              },
            },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

/** Responde cada comando pela ordem; o resto devolve {}. */
function setup(...responses: unknown[]) {
  const send = vi.fn<Deps["send"]>();
  for (const r of responses) send.mockResolvedValueOnce(r);
  send.mockResolvedValue({});
  const handler = createHandler({
    send,
    sharesTable: "shares",
    checkInsTable: "checkins",
    now: () => NOW,
    randomToken: () => TOKEN,
  });
  return { send, handler };
}

const body = (r: { body?: string }) => JSON.parse(r.body!);

describe("owner routes", () => {
  it("require an access token", async () => {
    const { send, handler } = setup();
    for (const claims of [{ sub: "alice", token_use: "id" }, null]) {
      for (const route of ["GET /share", "PUT /share", "DELETE /share"]) {
        const r = await handler(event(route, { claims, body: { expiresInDays: 7 } }));
        expect(r.statusCode).toBe(403);
      }
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("GET reports the active link without its token", async () => {
    const { send, handler } = setup({
      Item: {
        pk: "owner#alice",
        tokenHash: hashToken(TOKEN),
        createdAt: "2026-10-01T00:00:00.000Z",
        expiresAt: "2026-10-31T00:00:00.000Z",
      },
    });
    const r = await handler(event("GET /share"));
    expect(r.statusCode).toBe(200);
    expect(body(r)).toEqual({
      share: {
        createdAt: "2026-10-01T00:00:00.000Z",
        expiresAt: "2026-10-31T00:00:00.000Z",
      },
    });
    expect(send.mock.calls[0][0].input).toMatchObject({
      TableName: "shares",
      Key: { pk: "owner#alice" },
      ConsistentRead: true,
    });
  });

  it("GET treats an expired link as none", async () => {
    const { handler } = setup({
      Item: {
        tokenHash: "x",
        createdAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-09-08T00:00:00.000Z",
      },
    });
    expect(body(await handler(event("GET /share")))).toEqual({ share: null });
  });

  it("PUT creates a link, stores only its hash and returns the token once", async () => {
    const { send, handler } = setup({});
    const r = await handler(event("PUT /share", { body: { expiresInDays: 7 } }));
    expect(r.statusCode).toBe(201);
    expect(body(r)).toEqual({
      token: TOKEN,
      share: {
        createdAt: NOW.toISOString(),
        expiresAt: "2026-10-16T12:00:00.000Z",
      },
    });
    const command = send.mock.calls[1][0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    const items = (command as TransactWriteCommand).input.TransactItems!;
    expect(items).toHaveLength(2);
    expect(items[0].Put?.Item).toEqual({
      pk: `token#${hashToken(TOKEN)}`,
      ownerId: "alice",
      createdAt: NOW.toISOString(),
      expiresAt: "2026-10-16T12:00:00.000Z",
      ttl: Date.parse("2026-10-16T12:00:00.000Z") / 1000,
    });
    expect(items[1].Put?.Item).toMatchObject({
      pk: "owner#alice",
      tokenHash: hashToken(TOKEN),
    });
    expect(items[1].Put?.ConditionExpression).toBe("attribute_not_exists(pk)");
    expect(JSON.stringify(items)).not.toContain(TOKEN);
  });

  it("PUT replaces the previous link, which stops working", async () => {
    const { send, handler } = setup({
      Item: { tokenHash: hashToken(OLD_TOKEN), createdAt: "2026-10-01T00:00:00.000Z" },
    });
    const r = await handler(event("PUT /share", { body: { expiresInDays: null } }));
    expect(r.statusCode).toBe(201);
    expect(body(r).share.expiresAt).toBeNull();
    const items = (send.mock.calls[1][0] as TransactWriteCommand).input
      .TransactItems!;
    expect(items[0].Delete?.Key).toEqual({ pk: `token#${hashToken(OLD_TOKEN)}` });
    expect(items[1].Put?.Item).not.toHaveProperty("ttl");
    expect(items[2].Put?.ConditionExpression).toBe("tokenHash = :previous");
  });

  it("PUT rejects other validity periods and extra fields", async () => {
    const { send, handler } = setup();
    for (const b of [
      { expiresInDays: 1 },
      { expiresInDays: "7" },
      { expiresInDays: 7, ownerId: "bob" },
      {},
      "nope",
    ]) {
      const r = await handler(event("PUT /share", { body: b }));
      expect(r.statusCode).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("PUT reports a concurrent change as a conflict", async () => {
    const { send, handler } = setup({});
    send.mockRejectedValueOnce(
      Object.assign(new Error("x"), { name: "TransactionCanceledException" }),
    );
    const r = await handler(event("PUT /share", { body: { expiresInDays: 30 } }));
    expect(r.statusCode).toBe(409);
  });

  it("DELETE removes both items of the active link", async () => {
    const { send, handler } = setup({
      Item: { tokenHash: hashToken(OLD_TOKEN), createdAt: "2026-10-01T00:00:00.000Z" },
    });
    const r = await handler(event("DELETE /share"));
    expect(r.statusCode).toBe(200);
    const items = (send.mock.calls[1][0] as TransactWriteCommand).input
      .TransactItems!;
    expect(items.map((i) => i.Delete?.Key)).toEqual([
      { pk: `token#${hashToken(OLD_TOKEN)}` },
      { pk: "owner#alice" },
    ]);
  });

  it("DELETE without a link is a no-op", async () => {
    const { send, handler } = setup({});
    expect((await handler(event("DELETE /share"))).statusCode).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("public view", () => {
  const view = (token: string) =>
    event("GET /public/share/{token}", { token, claims: null });

  it("returns the owner's last 60 days of check-ins, nothing else", async () => {
    const { send, handler } = setup(
      { Item: { pk: "x", ownerId: "alice", createdAt: "2026-10-01T00:00:00.000Z" } },
      {
        Items: [
          { date: "2026-10-08", values: { joy: 2 }, userId: "alice" },
        ],
      },
    );
    const r = await handler(view(TOKEN));
    expect(r.statusCode).toBe(200);
    expect(body(r)).toEqual({
      items: [{ date: "2026-10-08", values: { joy: 2 } }],
      expiresAt: null,
    });
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Key: { pk: `token#${hashToken(TOKEN)}` },
      ConsistentRead: true,
    });
    const query = send.mock.calls[1][0];
    expect(query).toBeInstanceOf(QueryCommand);
    expect(query.input).toMatchObject({
      TableName: "checkins",
      ExpressionAttributeValues: {
        ":userId": "alice",
        ":from": "2026-08-10",
        ":to": "2026-10-10",
      },
    });
  });

  it("answers 404 the same way for malformed, unknown and expired links", async () => {
    const { send, handler } = setup(
      {},
      {
        Item: {
          ownerId: "alice",
          createdAt: "2026-09-01T00:00:00.000Z",
          expiresAt: "2026-09-08T00:00:00.000Z",
        },
      },
    );
    for (const token of ["short", TOKEN, TOKEN]) {
      const r = await handler(view(token));
      expect(r.statusCode).toBe(404);
      expect(body(r).error).toBe("NOT_FOUND");
    }
    // O formato errado nem chega à tabela; os check-ins nunca são lidos.
    expect(send).toHaveBeenCalledTimes(2);
  });
});
