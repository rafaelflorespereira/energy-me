# Create authentication on AWS

This template uses a **Cognito user pool**, not a Cognito identity pool.
No Lambda, DynamoDB, API Gateway, Amplify deployment, or AWS access keys in the
mobile app are required for sign-in. Resources are configured in the consoles;
this directory does not automatically deploy AWS resources.

Use a separate pool per unrelated project and environment by default. This
isolates users, provider credentials, and configuration. Sharing a pool is an
intentional shared-user-directory decision; create a separate public app
client per app/environment even when you share a pool. Nothing here changes
or deletes an existing pool.

Examples below use `cognitoapp://callback` and `cognitoapp://`. Replace
`cognitoapp` with your project's unique scheme everywhere. Console labels
can vary; the resource settings below are what matter.

## 1. Create a user pool

In your chosen AWS region, open Amazon Cognito and create a user pool for a
mobile application:

- Sign-in identifier: email. Require only `email`; keep `name` and `picture`
  optional because Apple may not supply them on later logins.
- Enable email verification if you also allow native Cognito accounts; do not
  enable SMS unless you need it and have configured delivery.
- For social-only login, disable native self-registration. Federated users are
  still created on their first provider sign-in.
- Record the region and pool ID. Sign-in identifiers and required attributes
  are creation-time choices; choose them before importing real users.

## 2. Add a Cognito domain

Under app integration / domain, choose an available domain prefix:

```text
https://<prefix>.auth.<region>.amazoncognito.com
```

Record the actual domain, not a value inferred from the pool ID.
For managed login, create a branding style and assign it to each app client
after creating the client. Alternatively select the classic hosted UI.
An unconfigured managed-login style can produce "Login pages unavailable".

## 3. Configure Google

In Google Cloud Console:

1. Create or select the project's Google Cloud project.
2. Configure Google Auth Platform / OAuth consent with app name, support
   contact, audience, and `openid`, `email`, `profile` scopes.
3. While the app is in testing, add test users. Publish the consent screen
   before production use and complete verification if Google requires it.
4. Create an OAuth client of type **Web application** (Cognito, not the mobile
   app, receives Google's redirect). Set this exact authorized redirect URI:

   ```text
   https://<prefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse
   ```

5. In the Cognito pool, add a **Google** identity provider with Google's client
   ID and client secret, scopes `openid email profile`, and mappings
   `email -> email`, `name -> name`, `picture -> picture`.

Keep the Google secret in the provider configuration, never in app code or
an `EXPO_PUBLIC_*` variable. No mobile Google SDK is needed for this flow.

## 4. Configure Sign in with Apple

This requires an Apple Developer membership.

1. Create/select your app's explicit App ID (its iOS bundle identifier) and
   enable **Sign in with Apple**. Use it as the primary App ID.
2. Create a **Services ID** for web authentication, such as
   `com.example.myapp.signin`. Associate it with the primary App ID.
3. Configure the Services ID's domain as
   `<prefix>.auth.<region>.amazoncognito.com` (no scheme or path), and return URL:

   ```text
   https://<prefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse
   ```

4. Create a Sign in with Apple key associated with the primary App ID. Record
   the Key ID, Developer Team ID, and download the `.p8` private key. Apple
   allows this download only once; store it securely.
5. Add **Sign in with Apple** as a Cognito identity provider. Supply the
   **Services ID** (not the iOS bundle ID), Team ID, Key ID, and private key.
   Set scopes `email name` and mappings `email -> email`, `name -> name`.

Apple may supply name only on first authorization; do not require it. Test
**Hide My Email**. If your backend sends email to Apple relay addresses,
configure the sending domains/addresses in Apple's private email relay
service. Plan for key replacement/revocation without committing private keys.

## 5. Create a public app client

Create an app client in the user pool:

- Application type: mobile / **public client**, **no client secret**.
- OAuth flow: **authorization code grant**, not implicit. The app uses PKCE S256.
- OAuth scopes: `openid`, `email`, `profile`.
- Identity providers: Google and Sign in with Apple. Enable Cognito user pool
  only if you also want native account login; the supplied integration opens
  each social provider directly.
- Allowed callback URL: `cognitoapp://callback`.
- Allowed sign-out URL: `cognitoapp://`.
- Assign a managed-login branding style if using managed login.
- Set token lifetimes (for example, ID/access: 1 hour, refresh: 30 days).
  Refresh-token rotation is supported by the OAuth token endpoint used here;
  the helper persists the replacement refresh token. Avoid concurrent refresh
  calls and choose a retry grace period appropriate for the app.

For multiple environments, register the matching URLs in the matching app
client. Do not add wildcards or redirects belonging to unrelated projects.
The two kinds of redirect are different: **Google/Apple -> Cognito** uses
`https://.../oauth2/idpresponse`; **Cognito -> app** uses
`<scheme>://callback`.

## 6. Collect the app configuration

Copy `.env.example` into the consuming app and set:

```dotenv
EXPO_PUBLIC_COGNITO_ISSUER=https://cognito-idp.<region>.amazonaws.com/<pool-id>
EXPO_PUBLIC_USER_POOL_CLIENT_ID=<public-app-client-id>
EXPO_PUBLIC_APP_SCHEME=cognitoapp
EXPO_PUBLIC_LOGOUT_URI=cognitoapp://
```

The issuer is **not** the hosted-login domain. Its OIDC discovery document at
`<issuer>/.well-known/openid-configuration` supplies the authorization, token,
and revocation endpoints. These four values are public build-time
configuration, not AWS or provider credentials.

Continue with [new-project integration](integration.md).

## Production and troubleshooting

Before release, verify both providers on a physical development/production
build, Apple private relay email, cold-start session restoration, token expiry
and refresh, refresh failure, cancellation, account switching, and sign-out.
Confirm the correct public app client and redirects for the environment,
published Google consent, enabled Apple capability, and no committed secrets.
Retain stable pool/client IDs for an existing app unless you intend a user
migration; do not delete pools to "reset" production authentication.

- Google `redirect_uri_mismatch`: its registered URI must exactly match the
  Cognito domain plus `/oauth2/idpresponse`, without a trailing slash.
- Apple `invalid_client`: check Services ID, Team ID, Key ID, key, primary App
  ID association, and return URL.
- Cognito redirect error: check client ID and exact `<scheme>://callback`.
- Missing login pages: assign branding or use the configured classic UI.
- No redirect back: install a native build with the configured scheme; Expo Go
  cannot test this OAuth flow. Rebuild after changing native configuration.

Useful read-only checks (AWS CLI with your own authenticated profile):

```bash
aws cognito-idp describe-user-pool --user-pool-id <pool-id> --region <region>
aws cognito-idp describe-user-pool-client \
  --user-pool-id <pool-id> --client-id <client-id> --region <region>
aws cognito-idp list-identity-providers --user-pool-id <pool-id> --region <region>
```

Provider secrets/private keys are sensitive: do not paste console/CLI output
containing them into issue reports or logs.
