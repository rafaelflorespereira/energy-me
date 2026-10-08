import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (
    !claims ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    claims.token_use !== "access"
  ) {
    return {
      statusCode: 403,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        error: "ACCESS_TOKEN_REQUIRED",
        requestId: event.requestContext.requestId,
      }),
    };
  }
  return {
    statusCode: 501,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({
      error: "PERSISTENCE_NOT_IMPLEMENTED",
      requestId: event.requestContext.requestId,
    }),
  };
}
