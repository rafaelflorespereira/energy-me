import path from "node:path";
import { AccessLogFormat } from "aws-cdk-lib/aws-apigateway";
import {
  CfnOutput,
  CfnParameter,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  Tags,
  type StackProps,
  aws_apigatewayv2 as apigateway,
  aws_apigatewayv2_authorizers as authorizers,
  aws_apigatewayv2_integrations as integrations,
  aws_cloudwatch as cloudwatch,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

export type Stage = "dev" | "prod";

export function parseStage(value: unknown): Stage {
  if (value === undefined || value === "dev") return "dev";
  if (value === "prod") return "prod";
  throw new Error("stage must be dev or prod");
}

interface CheckInsStackProps extends StackProps {
  stage: Stage;
}

export class CheckInsStack extends Stack {
  constructor(scope: Construct, id: string, props: CheckInsStackProps) {
    super(scope, id, props);
    const { stage } = props;
    Tags.of(this).add("Project", "energy-me");
    Tags.of(this).add("Environment", stage);

    const poolId = new CfnParameter(this, "CognitoUserPoolId", {
      type: "String",
      allowedPattern: "^[a-z]{2}(-[a-z]+)+-[0-9]_[A-Za-z0-9]+$",
      description:
        "Existing Cognito user pool ID, such as eu-central-1_EXAMPLE. The pool may be in another region. This stack does not modify the pool.",
    });
    const clientId = new CfnParameter(this, "CognitoClientId", {
      type: "String",
      allowedPattern: "^[a-z0-9]+$",
      minLength: 1,
      description:
        "Existing public Cognito app client ID for this environment; not a client secret.",
    });
    const webOrigin = new CfnParameter(this, "WebOrigin", {
      type: "String",
      allowedPattern:
        stage === "prod"
          ? "^https://[A-Za-z0-9.-]+(:[0-9]+)?$"
          : "^(https://[A-Za-z0-9.-]+(:[0-9]+)?|http://(localhost|127\\.0\\.0\\.1):[0-9]+)$",
      description:
        "Exact allowed web origin without a trailing slash; HTTPS required in production.",
    });

    const table = new dynamodb.Table(this, "CheckIns", {
      tableName: `energy-me-checkins-${stage}`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "date", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const functionLogs = new logs.LogGroup(this, "FunctionLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy:
        stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const handler = new nodejs.NodejsFunction(this, "CheckInsHandler", {
      entry: path.join(__dirname, "../lambda/checkins.ts"),
      depsLockFilePath: path.join(__dirname, "../package-lock.json"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      reservedConcurrentExecutions: stage === "prod" ? 10 : 2,
      logGroup: functionLogs,
      environment: {
        TABLE_NAME: table.tableName,
        APP_STAGE: stage,
      },
      bundling: { minify: true, sourceMap: true },
    });
    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:UpdateItem"],
        resources: [table.tableArn],
      }),
    );

    // The pool ID starts with its own region, which can differ from the stack's.
    const poolRegion = Fn.select(0, Fn.split("_", poolId.valueAsString));
    const authorizer = new authorizers.HttpJwtAuthorizer(
      "CognitoAuthorizer",
      `https://cognito-idp.${poolRegion}.amazonaws.com/${poolId.valueAsString}`,
      { jwtAudience: [clientId.valueAsString] },
    );
    const api = new apigateway.HttpApi(this, "CheckInsApi", {
      apiName: `energy-me-checkins-${stage}`,
      createDefaultStage: false,
      defaultAuthorizer: authorizer,
      defaultAuthorizationScopes: ["openid"],
      corsPreflight: {
        allowOrigins: [webOrigin.valueAsString],
        allowHeaders: ["Authorization", "Content-Type"],
        allowMethods: [
          apigateway.CorsHttpMethod.GET,
          apigateway.CorsHttpMethod.PUT,
        ],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new integrations.HttpLambdaIntegration(
      "CheckInsIntegration",
      handler,
    );
    api.addRoutes({
      path: "/checkins",
      methods: [apigateway.HttpMethod.GET],
      integration,
    });
    api.addRoutes({
      path: "/checkins/{date}",
      methods: [apigateway.HttpMethod.PUT],
      integration,
    });

    const apiLogs = new logs.LogGroup(this, "ApiLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy:
        stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    new apigateway.HttpStage(this, "ApiStage", {
      httpApi: api,
      stageName: "$default",
      autoDeploy: true,
      throttle: {
        rateLimit: stage === "prod" ? 20 : 5,
        burstLimit: stage === "prod" ? 40 : 10,
      },
      accessLogSettings: {
        destination: new apigateway.LogGroupLogDestination(apiLogs),
        format: AccessLogFormat.custom(
          JSON.stringify({
            requestId: "$context.requestId",
            routeKey: "$context.routeKey",
            status: "$context.status",
            responseLatency: "$context.responseLatency",
          }),
        ),
      },
    });

    new cloudwatch.Alarm(this, "FunctionErrors", {
      metric: handler.metricErrors({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Check-in Lambda invocation failures. Configure a notification action before production use.",
    });
    new cloudwatch.Alarm(this, "ApiServerErrors", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName: "5xx",
        dimensionsMap: { ApiId: api.apiId },
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Check-in HTTP API server failures.",
    });

    new CfnOutput(this, "CheckInsApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "CheckInsTableName", { value: table.tableName });
    new CfnOutput(this, "PersistenceStatus", {
      value:
        "GET /checkins and PUT /checkins/{date} implemented; clear-all not yet.",
    });
  }
}
