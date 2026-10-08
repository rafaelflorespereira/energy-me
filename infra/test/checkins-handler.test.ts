import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  createHandler,
  encodeCursor,
  isCalendarDate,
  type Deps,
} from "../lambda/checkins";

const NOW = new Date("2026-10-07T15:00:00.000Z");
const VALUES = {
  anger: 0,
  frustration: 1,
  worry: 2,
  joy: 3,
  sadness: 0,
  guilt: 1,
  fear: 0,
};

function event(
  routeKey: string,
  opts: {
    claims?: Record<string, string>;
    date?: string;
    body?: unknown;
    query?: Record<string, string>;
  } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    routeKey,
    pathParameters: opts.date === undefined ? undefined : { date: opts.date },
    queryStringParameters: opts.query,
    body:
      opts.body === undefined
        ? undefined
        : typeof opts.body === "string"
          ? opts.body
          : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      requestId: "request-1",
      authorizer: {
        jwt: {
          claims: opts.claims ?? { sub: "alice", token_use: "access" },
          scopes: ["openid"],
        },
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function setup(response: unknown = {}) {
  const send = vi.fn<Deps["send"]>().mockResolvedValue(response);
  const handler = createHandler({ send, tableName: "table", now: () => NOW });
  return { send, handler };
}

const body = (r: { body?: string }) => JSON.parse(r.body!);

describe("authentication", () => {
  it("rejects ID tokens and missing user identity without touching the table", async () => {
    const { send, handler } = setup();
    const cases: Record<string, string>[] = [
      { sub: "alice", token_use: "id" },
      { token_use: "access" },
    ];
    for (const claims of cases) {
      const r = await handler(event("GET /checkins", { claims }));
      expect(r.statusCode).toBe(403);
      expect(body(r).error).toBe("ACCESS_TOKEN_REQUIRED");
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown routes", async () => {
    const { handler } = setup();
    expect((await handler(event("DELETE /checkins"))).statusCode).toBe(404);
  });
});

describe("PUT /checkins/{date}", () => {
  it("upserts with the owner from the token and server timestamps", async () => {
    const saved = {
      userId: "alice",
      date: "2026-10-07",
      values: VALUES,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      schemaVersion: 1,
    };
    const { send, handler } = setup({ Attributes: saved });
    const r = await handler(
      event("PUT /checkins/{date}", {
        date: "2026-10-07",
        body: { values: VALUES },
      }),
    );
    expect(r.statusCode).toBe(200);
    expect(r.headers?.["Cache-Control"]).toBe("no-store");
    expect(body(r)).toEqual({
      date: "2026-10-07",
      values: VALUES,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input).toMatchObject({
      TableName: "table",
      Key: { userId: "alice", date: "2026-10-07" },
      ReturnValues: "ALL_NEW",
      ExpressionAttributeValues: {
        ":values": VALUES,
        ":now": NOW.toISOString(),
        ":version": 1,
      },
    });
    // createdAt só é gravado na primeira vez.
    expect(
      (command.input as { UpdateExpression: string }).UpdateExpression,
    ).toContain("createdAt = if_not_exists(createdAt, :now)");
  });

  it("ignores ownership supplied by the client", async () => {
    const { send, handler } = setup({ Attributes: {} });
    const r = await handler(
      event("PUT /checkins/{date}", {
        claims: { sub: "bob", token_use: "access" },
        date: "2026-10-07",
        body: { values: VALUES },
      }),
    );
    expect(r.statusCode).toBe(200);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Key: { userId: "bob", date: "2026-10-07" },
    });

    const forged = await handler(
      event("PUT /checkins/{date}", {
        date: "2026-10-07",
        body: { values: VALUES, userId: "alice" },
      }),
    );
    expect(forged.statusCode).toBe(400);
  });

  it.each([
    ["not a date", "hoje"],
    ["impossible day", "2026-02-30"],
    ["impossible month", "2026-13-01"],
  ])("rejects %s", async (_, date) => {
    const { send, handler } = setup();
    const r = await handler(
      event("PUT /checkins/{date}", { date, body: { values: VALUES } }),
    );
    expect(r.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["missing key", { ...VALUES, fear: undefined }],
    ["portuguese key", { ...VALUES, fear: undefined, medo: 0 }],
    ["extra key", { ...VALUES, calm: 0 }],
    ["value above 4", { ...VALUES, joy: 5 }],
    ["negative value", { ...VALUES, joy: -1 }],
    ["fraction", { ...VALUES, joy: 1.5 }],
    ["string", { ...VALUES, joy: "3" }],
    ["null", { ...VALUES, joy: null }],
    ["all zero", Object.fromEntries(Object.keys(VALUES).map((k) => [k, 0]))],
    ["array", [0, 1, 2, 3, 0, 1, 0]],
  ])("rejects values with %s", async (_, values) => {
    const { send, handler } = setup();
    const r = await handler(
      event("PUT /checkins/{date}", {
        date: "2026-10-07",
        body: { values: JSON.parse(JSON.stringify(values)) },
      }),
    );
    expect(r.statusCode).toBe(400);
    expect(body(r).error).toBe("INVALID_REQUEST");
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts the 0 and 4 boundaries", async () => {
    const { handler } = setup({ Attributes: {} });
    const r = await handler(
      event("PUT /checkins/{date}", {
        date: "2026-10-07",
        body: { values: { ...VALUES, joy: 4, worry: 0 } },
      }),
    );
    expect(r.statusCode).toBe(200);
  });

  it("rejects missing, invalid and oversized bodies", async () => {
    const { send, handler } = setup();
    for (const b of [
      undefined,
      "{",
      JSON.stringify({ values: VALUES, pad: "x".repeat(5000) }),
    ]) {
      const r = await handler(
        event("PUT /checkins/{date}", { date: "2026-10-07", body: b }),
      );
      expect(r.statusCode).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("decodes base64 bodies", async () => {
    const { handler } = setup({ Attributes: {} });
    const e = event("PUT /checkins/{date}", { date: "2026-10-07" });
    e.body = Buffer.from(JSON.stringify({ values: VALUES })).toString("base64");
    e.isBase64Encoded = true;
    expect((await handler(e)).statusCode).toBe(200);
  });
});

describe("GET /checkins", () => {
  it("queries only the caller's partition, in date order, consistently", async () => {
    const items = [
      {
        userId: "alice",
        date: "2026-10-06",
        values: VALUES,
        createdAt: "a",
        updatedAt: "b",
        schemaVersion: 1,
      },
    ];
    const { send, handler } = setup({ Items: items });
    const r = await handler(event("GET /checkins"));
    expect(r.statusCode).toBe(200);
    expect(body(r)).toEqual({
      items: [
        { date: "2026-10-06", values: VALUES, createdAt: "a", updatedAt: "b" },
      ],
      nextCursor: null,
    });
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toEqual({
      TableName: "table",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": "alice" },
      ScanIndexForward: true,
      ConsistentRead: true,
      Limit: 100,
    });
  });

  it.each([
    [
      { from: "2026-08-01", to: "2026-10-07" },
      "userId = :userId AND #date BETWEEN :from AND :to",
    ],
    [{ from: "2026-08-01" }, "userId = :userId AND #date >= :from"],
    [{ to: "2026-10-07" }, "userId = :userId AND #date <= :to"],
  ])("applies date bounds %o", async (query, condition) => {
    const { send, handler } = setup({ Items: [] });
    expect((await handler(event("GET /checkins", { query }))).statusCode).toBe(
      200,
    );
    expect(send.mock.calls[0][0].input).toMatchObject({
      KeyConditionExpression: condition,
      ExpressionAttributeNames: { "#date": "date" },
    });
  });

  it.each<Record<string, string>>([
    { from: "2026-02-30" },
    { to: "ontem" },
    { from: "2026-10-07", to: "2026-10-01" },
    { limit: "0" },
    { limit: "101" },
    { limit: "10.5" },
    { cursor: "not-base64-json" },
    {
      cursor: Buffer.from(
        JSON.stringify({ date: "2026-10-01", userId: "bob" }),
      ).toString("base64url"),
    },
    { cursor: encodeCursor("2026-07-01"), from: "2026-08-01" },
  ])("rejects invalid query %o", async (query) => {
    const { send, handler } = setup();
    const r = await handler(event("GET /checkins", { query }));
    expect(r.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("paginates with a cursor that never carries ownership", async () => {
    const { send, handler } = setup({
      Items: [],
      LastEvaluatedKey: { userId: "alice", date: "2026-09-01" },
    });
    const first = body(
      await handler(event("GET /checkins", { query: { limit: "10" } })),
    );
    expect(first.nextCursor).toBe(encodeCursor("2026-09-01"));
    expect(Buffer.from(first.nextCursor, "base64url").toString()).not.toContain(
      "alice",
    );

    // Bob reusing Alice's cursor still reads only his own partition.
    await handler(
      event("GET /checkins", {
        claims: { sub: "bob", token_use: "access" },
        query: { cursor: first.nextCursor },
      }),
    );
    expect(send.mock.calls[1][0].input).toMatchObject({
      ExpressionAttributeValues: { ":userId": "bob" },
      ExclusiveStartKey: { userId: "bob", date: "2026-09-01" },
    });
  });
});

describe("failures", () => {
  it("maps throttling to 429 and other errors to 503 without leaking details", async () => {
    const send = vi.fn<Deps["send"]>();
    const handler = createHandler({ send, tableName: "t", now: () => NOW });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    send.mockRejectedValueOnce(
      Object.assign(new Error("slow"), { name: "ThrottlingException" }),
    );
    expect((await handler(event("GET /checkins"))).statusCode).toBe(429);

    send.mockRejectedValueOnce(new Error("secret table detail"));
    const r = await handler(event("GET /checkins"));
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain("secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    log.mockRestore();
  });
});

describe("isCalendarDate", () => {
  it("accepts leap days only in leap years", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
  });
});
