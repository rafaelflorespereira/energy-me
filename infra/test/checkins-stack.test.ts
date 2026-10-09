import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { CheckInsStack, parseStage } from "../lib/checkins-stack";

const template = Template.fromStack(
  new CheckInsStack(new App(), "TestStack", {
    stage: "prod",
    env: { account: "111111111111", region: "eu-central-1" },
    terminationProtection: true,
  }),
);

describe("check-in infrastructure", () => {
  it("retains and protects an on-demand table with the user/date key", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 2);
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: {
        TableName: "energy-me-checkins-prod",
        BillingMode: "PAY_PER_REQUEST",
        DeletionProtectionEnabled: true,
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        SSESpecification: { SSEEnabled: true },
        KeySchema: [
          { AttributeName: "userId", KeyType: "HASH" },
          { AttributeName: "date", KeyType: "RANGE" },
        ],
      },
    });
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      Properties: {
        TableName: "energy-me-shares-prod",
        BillingMode: "PAY_PER_REQUEST",
        DeletionProtectionEnabled: true,
        SSESpecification: { SSEEnabled: true },
        KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
        TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      },
    });
    template.resourceCountIs("AWS::Cognito::UserPool", 0);
    template.resourceCountIs("AWS::Cognito::UserPoolClient", 0);
  });

  it("protects every data route with Cognito JWTs and the openid scope", () => {
    const routes = Object.values(
      template.findResources("AWS::ApiGatewayV2::Route"),
    );
    expect(routes.map((r) => r.Properties.RouteKey).sort()).toEqual([
      "DELETE /share",
      "GET /checkins",
      "GET /public/share/{token}",
      "GET /share",
      "PUT /checkins/{date}",
      "PUT /share",
    ]);
    // Só o link público fica sem login, e só para leitura.
    const [open] = routes.filter((r) => r.Properties.AuthorizationType !== "JWT");
    expect(open.Properties.RouteKey).toBe("GET /public/share/{token}");
    expect(open.Properties.AuthorizationType).toBe("NONE");
    expect(open.Properties.AuthorizationScopes).toBeUndefined();
    for (const route of routes.filter((r) => r !== open)) {
      expect(route.Properties.AuthorizationType).toBe("JWT");
      expect(route.Properties.AuthorizationScopes).toEqual(["openid"]);
      expect(route.Properties.AuthorizerId).toBeDefined();
    }
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT",
      IdentitySource: ["$request.header.Authorization"],
      JwtConfiguration: {
        Audience: [{ Ref: "CognitoClientId" }],
        Issuer: {
          "Fn::Join": [
            "",
            [
              "https://cognito-idp.",
              {
                "Fn::Select": [
                  0,
                  { "Fn::Split": ["_", { Ref: "CognitoUserPoolId" }] },
                ],
              },
              ".amazonaws.com/",
              { Ref: "CognitoUserPoolId" },
            ],
          ],
        },
      },
    });
  });

  it("uses exact-origin CORS, bounded logs and API throttling", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: {
        AllowOrigins: [{ Ref: "WebOrigin" }],
        AllowHeaders: ["Authorization", "Content-Type"],
        AllowMethods: ["GET", "PUT", "DELETE"],
        MaxAge: 3600,
      },
    });
    template.resourceCountIs("AWS::Logs::LogGroup", 2);
    for (const log of Object.values(
      template.findResources("AWS::Logs::LogGroup"),
    )) {
      expect(log.Properties.RetentionInDays).toBe(30);
      expect(log.DeletionPolicy).toBe("Retain");
    }
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: {
        ThrottlingRateLimit: 20,
        ThrottlingBurstLimit: 40,
      },
      AccessLogSettings: {
        DestinationArn: Match.anyValue(),
        Format: Match.anyValue(),
      },
    });
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  });

  it("emails alarms and an account budget to the configured address", () => {
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: { Ref: "AlarmEmail" },
    });
    const [topic] = Object.keys(template.findResources("AWS::SNS::Topic"));
    for (const alarm of Object.values(
      template.findResources("AWS::CloudWatch::Alarm"),
    )) {
      expect(alarm.Properties.AlarmActions).toEqual([{ Ref: topic }]);
    }
    template.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: {
        BudgetType: "COST",
        TimeUnit: "MONTHLY",
        BudgetLimit: { Amount: { Ref: "MonthlyBudgetUsd" }, Unit: "USD" },
      },
      NotificationsWithSubscribers: [
        Match.objectLike({
          Notification: Match.objectLike({
            NotificationType: "ACTUAL",
            Threshold: 80,
          }),
          Subscribers: [
            { SubscriptionType: "EMAIL", Address: { Ref: "AlarmEmail" } },
          ],
        }),
        Match.objectLike({
          Notification: Match.objectLike({
            NotificationType: "FORECASTED",
            Threshold: 100,
          }),
        }),
      ],
    });
  });

  it("grants each Lambda only the table actions it needs", () => {
    const tableRef = (prefix: RegExp) => ({
      "Fn::GetAtt": [expect.stringMatching(prefix), "Arn"],
    });
    const byPolicy = Object.entries(
      template.findResources("AWS::IAM::Policy"),
    ).map(([id, policy]) => ({
      id,
      database: (
        policy.Properties.PolicyDocument.Statement as {
          Action: unknown;
          Resource: unknown;
        }[]
      ).filter((s) => JSON.stringify(s.Action).includes("dynamodb:")),
    }));
    const checkIns = byPolicy.find((p) => p.id.startsWith("CheckInsHandler"));
    const shares = byPolicy.find((p) => p.id.startsWith("SharesHandler"));
    expect(checkIns?.database).toEqual([
      {
        Effect: "Allow",
        Action: ["dynamodb:Query", "dynamodb:UpdateItem"],
        Resource: tableRef(/^CheckIns/),
      },
    ]);
    // O link só lê check-ins; escrita apenas na tabela de links.
    expect(shares?.database).toEqual([
      {
        Effect: "Allow",
        Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"],
        Resource: tableRef(/^Shares/),
      },
      {
        Effect: "Allow",
        Action: "dynamodb:Query",
        Resource: tableRef(/^CheckIns/),
      },
    ]);
  });

  it("bundles bounded Lambdas without a VPC or secrets", () => {
    template.resourceCountIs("AWS::Lambda::Function", 2);
    const tables = template.findResources("AWS::DynamoDB::Table");
    const tableId = (name: string) =>
      Object.keys(tables).find(
        (id) => tables[id].Properties.TableName === name,
      );
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Architectures: ["arm64"],
      Timeout: 10,
      MemorySize: 256,
      ReservedConcurrentExecutions: 10,
      VpcConfig: Match.absent(),
      Environment: {
        Variables: {
          TABLE_NAME: { Ref: tableId("energy-me-checkins-prod") },
          APP_STAGE: "prod",
        },
      },
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      ReservedConcurrentExecutions: 5,
      VpcConfig: Match.absent(),
      Environment: {
        Variables: {
          SHARES_TABLE_NAME: { Ref: tableId("energy-me-shares-prod") },
          CHECKINS_TABLE_NAME: { Ref: tableId("energy-me-checkins-prod") },
          APP_STAGE: "prod",
        },
      },
    });
    for (const fn of Object.values(
      template.findResources("AWS::Lambda::Function"),
    )) {
      for (const key of Object.keys(fn.Properties.Environment.Variables)) {
        expect(key).toMatch(/^(APP_STAGE|[A-Z_]*TABLE_NAME)$/);
      }
    }
  });

  it("defaults to development and rejects unsupported stages", () => {
    expect(parseStage(undefined)).toBe("dev");
    expect(parseStage("dev")).toBe("dev");
    expect(parseStage("prod")).toBe("prod");
    expect(() => parseStage("production")).toThrow("stage must be");
  });
});
