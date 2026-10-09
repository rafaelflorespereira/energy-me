# Check-in infrastructure

TypeScript AWS CDK v2 stack for the architecture in [the persistence proposal](../docs/checkin-persistence.md). Region: `eu-central-1` (Frankfurt). The Cognito user pool can stay in another region; the JWT issuer uses the region in the pool ID.

## Current scope

- One on-demand DynamoDB table, keyed by `userId` and `date`, with encryption, point-in-time recovery, deletion protection, and retention on stack removal or replacement.
- One Node.js 22 ARM64 Lambda with bounded timeout, memory, concurrency, and explicit log retention. Its role grants only `Query` and `UpdateItem` on this table.
- API Gateway HTTP API with `GET /checkins` and `PUT /checkins/{date}`, an existing Cognito JWT issuer/client audience, required `openid` scope, exact-origin CORS, and stage throttling.
- Access logs contain request ID, route key, status, and latency, not user identities, query strings, authorization headers, request bodies, or feeling values.
- CloudWatch alarms for Lambda invocation errors and API 5xx responses, sent by email through an SNS topic, plus a monthly account-wide cost budget that emails the same address.
- Separate `dev` and `prod` stack/table names. Production stack termination protection is enabled by the CDK entry point. Both environments retain and protect their tables.

**The API implements `GET /checkins` and `PUT /checkins/{date}`** per [the persistence contract](../docs/checkin-persistence.md): access token required, owner taken from the verified `sub`, seven English feeling keys with integer intensities 0 to 4, real calendar dates, and a date-only pagination cursor. Handler tests run against a stubbed DynamoDB client. DELETE (clear-all) is not exposed, and the role has no delete permission. The web app uses this API when `VITE_CHECKINS_API_URL` is set and falls back to local storage otherwise.

English feeling keys (`anger`, `frustration`, `worry`, `joy`, `sadness`, `guilt`, `fear`) and the integer 0-4 validation live in the handler, not in the DynamoDB table key schema.

## Local verification

Use Node.js 22 and the committed npm lockfile:

```bash
cd infra
npm ci
npm run build
npm test
npm run synth -- --no-lookups -c stage=dev
npm run synth -- --no-lookups -c stage=prod
```

Synthesis generates CloudFormation and bundles the Lambda locally. It does not bootstrap or deploy AWS resources. No AWS resource lookups are used; tests use a synthetic AWS account. Omitting `stage` selects development; other stage values are rejected.

The [infrastructure CI workflow](../.github/workflows/infra-checks.yml) runs these gates without AWS credentials. It does not deploy, and PR builds do not receive a cloud role.

## Deployment parameters

Supply these explicitly for each target environment; they are public configuration, not secrets:

| CloudFormation parameter | Value                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `CognitoUserPoolId`      | Existing pool ID in any region, such as `eu-central-1_EXAMPLE` or `us-east-1_EXAMPLE`                                       |
| `CognitoClientId`        | Existing public app client ID; never its client secret                                                                      |
| `WebOrigin`              | Exact origin without a trailing slash; for example `http://localhost:5173` in dev or `https://energy-me.vercel.app` in prod |
| `AlarmEmail`             | Email for alarm and budget notifications; confirm the subscription link AWS sends after deploy                              |
| `MonthlyBudgetUsd`       | Optional, default `5`; monthly account-wide cost budget, emailing at 80% actual and 100% forecast                           |

The stack does not create, import into management, or modify Cognito resources. It configures the JWT authorizer to trust the supplied pool issuer and client. Use different clients/pools where appropriate so development cannot authorize production data access. Prefer separate AWS accounts; stage-specific names alone are not an account-level isolation boundary.

Only one web origin is allowed per stack initially. Production requires HTTPS. Add additional exact origins deliberately in infrastructure code if needed; do not use wildcard preview-domain CORS.

## First development deployment

These commands are a runbook, not actions already performed. Creating infrastructure and bootstrapping incur AWS costs and change the target account.

### 1. Authenticate

Authenticate through an approved AWS SSO/Identity Center profile, not static access keys. Verify the account before any bootstrap or deployment:

```bash
aws sso login --profile energy-me-dev
aws sts get-caller-identity --profile energy-me-dev
```

### 2. Bootstrap through an administrator

Have an account administrator bootstrap CDK once in the intended account/region. Review bootstrap trust and CloudFormation execution policies. Do not accept unrestricted cross-account trust or an AdministratorAccess execution role merely because it is the default; scope bootstrap/deployment roles to this project's resources and approved capabilities. Bootstrap-role setup is intentionally not automated here.

### 3. Review the changes

Review generated infrastructure against the target environment:

```bash
npm run synth -- --no-lookups -c stage=dev
npm run diff -- --profile energy-me-dev -c stage=dev \
  --parameters CognitoUserPoolId=eu-central-1_EXAMPLE \
  --parameters CognitoClientId=PUBLIC_CLIENT_ID \
  --parameters WebOrigin=http://localhost:5173 \
  --parameters AlarmEmail=you@example.com
```

### 4. Deploy development

Deploy only after reviewing the diff and replacing the example values:

```bash
npm run deploy -- --profile energy-me-dev -c stage=dev \
  --parameters CognitoUserPoolId=eu-central-1_EXAMPLE \
  --parameters CognitoClientId=PUBLIC_CLIENT_ID \
  --parameters WebOrigin=http://localhost:5173 \
  --parameters AlarmEmail=you@example.com
```

The script requires approval for permission broadening, but that does not replace review of other changes such as resource replacements. Production uses the corresponding approved production profile and `-c stage=prod`, never a development role.

Set the output `CheckInsApiUrl` as the public `VITE_CHECKINS_API_URL` in Vercel and redeploy the web app. Vercel has no need for AWS credentials in this architecture.

## Safety before production

- Keep clear-all disabled until its remote behavior is implemented.
- Confirm the SNS email subscription after deploy, or alarms reach no one. Review concurrency/rate limits per environment. Lambda reserved concurrency requires enough account quota: AWS reserves an unallocated pool, so new accounts with low quotas may need a quota increase or a reviewed configuration change before deployment.
- Run cross-account/user authorization tests and save/read acceptance tests against development before production. Synthesis does not verify Cognito settings, account quotas, IAM deployment permissions, or live API behavior.
- Recheck `npm audit` before release. At initial scaffold creation, `aws-cdk-lib@2.272.0` bundles `brace-expansion@5.0.9`, which npm reports with high-severity denial-of-service advisories. `npm audit fix` cannot replace that bundled copy. Upgrade CDK when a patched release is available or obtain a documented tooling-risk decision before production deployment. This dependency is not in the bundled Lambda, but tooling risk must not be silently waived. Do not process untrusted asset glob patterns during synthesis.
- Add GitHub Actions deployment only after configuring an OIDC trust policy restricted to the repository and protected deployment environment, with least-privilege deployment roles and required production reviewers. Do not place AWS keys in GitHub secrets or grant deployment credentials to PR jobs. No deployment workflow or OIDC roles have been provisioned in this first slice.

## Data retention and cleanup

Destroying the stack does not delete the table. Table retention, replacement retention, and deletion protection are intentional; retaining a resource can require an explicit CloudFormation import before recreating a stack with the same table name. Do not disable protection to work around a naming conflict without a reviewed recovery plan.

Production termination protection blocks stack deletion, not stack updates. Always review replacements and key-schema changes. To remove data intentionally, use an approved data-deletion process and verify backups/retention requirements separately. Never treat `cdk destroy` as a user-data deletion feature.
