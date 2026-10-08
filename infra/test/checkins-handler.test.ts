import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { handler } from "../lambda/checkins";

function event(
  claims: Record<string, string>,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    requestContext: {
      requestId: "request-1",
      authorizer: { jwt: { claims, scopes: ["openid"] } },
    },
  } as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe("infrastructure handler placeholder", () => {
  it("rejects ID tokens and missing user identity", async () => {
    expect(
      (await handler(event({ sub: "alice", token_use: "id" }))).statusCode,
    ).toBe(403);
    expect((await handler(event({ token_use: "access" }))).statusCode).toBe(
      403,
    );
  });

  it("never claims that unimplemented persistence succeeded", async () => {
    const response = await handler(
      event({ sub: "alice", token_use: "access" }),
    );
    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body!)).toEqual({
      error: "PERSISTENCE_NOT_IMPLEMENTED",
      requestId: "request-1",
    });
    expect(response.headers?.["Cache-Control"]).toBe("no-store");
  });
});
