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
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
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
    template.resourceCountIs("AWS::Cognito::UserPool", 0);
    template.resourceCountIs("AWS::Cognito::UserPoolClient", 0);
  });

  it("protects every data route with Cognito JWTs and the openid scope", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Route", 2);
    for (const route of Object.values(
      template.findResources("AWS::ApiGatewayV2::Route"),
    )) {
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
        AllowMethods: ["GET", "PUT"],
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
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
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

  it("grants only Query and UpdateItem on this table", () => {
    const statements = Object.values(
      template.findResources("AWS::IAM::Policy"),
    ).flatMap((policy) => policy.Properties.PolicyDocument.Statement);
    const database = statements.filter((statement) =>
      JSON.stringify(statement.Action).includes("dynamodb:"),
    );
    expect(database).toHaveLength(1);
    expect(database[0].Action).toEqual([
      "dynamodb:Query",
      "dynamodb:UpdateItem",
    ]);
    expect(database[0].Resource).not.toBe("*");
    expect(database[0].Resource).toEqual({
      "Fn::GetAtt": [expect.stringMatching(/^CheckIns/), "Arn"],
    });
  });

  it("bundles one bounded Lambda without a VPC or secrets", () => {
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Architectures: ["arm64"],
      Timeout: 10,
      MemorySize: 256,
      ReservedConcurrentExecutions: 10,
      VpcConfig: Match.absent(),
      Environment: {
        Variables: {
          TABLE_NAME: {
            Ref: Object.keys(template.findResources("AWS::DynamoDB::Table"))[0],
          },
          APP_STAGE: "prod",
        },
      },
    });
    const [functionResource] = Object.values(
      template.findResources("AWS::Lambda::Function"),
    );
    expect(
      Object.keys(functionResource.Properties.Environment.Variables).sort(),
    ).toEqual(["APP_STAGE", "TABLE_NAME"]);
  });

  it("defaults to development and rejects unsupported stages", () => {
    expect(parseStage(undefined)).toBe("dev");
    expect(parseStage("dev")).toBe("dev");
    expect(parseStage("prod")).toBe("prod");
    expect(() => parseStage("production")).toThrow("stage must be");
  });
});
