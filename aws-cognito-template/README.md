# AWS Cognito template

Reusable **Expo / React Native authentication** with Google and Sign in with
Apple through Cognito's authorization-code flow with PKCE. This directory is
the complete `@aws-cognito-template/auth` source package: copy it into another
repository without the parent project's apps, infrastructure, or dependencies.
It targets Expo SDK 54, React 19.1, and React Native 0.81.

The template is an authentication library, not a runnable app or a backend.
It includes discovery, code exchange, token refresh, native SecureStore
persistence, ID-token display claims, and optional `LoginButton` / `UserProfile`
components. Login screen orchestration, API authorization, navigation, data
sync, and application-specific storage belong to the consuming project.

## Start here

1. [Create the AWS resources and identity providers](docs/aws-setup.md).
2. [Connect a new Expo project](docs/integration.md).

```text
aws-cognito-template/
├── src/                 # Authentication only; no application-specific imports
├── docs/
│   ├── aws-setup.md     # Cognito, Google, Apple, production checklist
│   └── integration.md   # Install, configure, sign in, refresh, sign out
├── .env.example         # Public config to copy into the consuming app
├── package.json         # Independent npm package (TypeScript source entry)
└── tsconfig.json
```

Inside this repository, install from the repository root; the template is an
npm workspace and VS Helper imports it like any other consumer:

```bash
npm install
npm run type-check --workspace @aws-cognito-template/auth
```

After copying this directory outside the repository, `npm install` and
`npm run type-check` work from its own directory. It does not extend a parent
TypeScript config or import any parent files. The package ships TypeScript
source for Expo/Metro rather than compiled JavaScript for Node.js.

## Public API

- Configuration: `issuer`, `cognitoConfig`, `cognitoIdentityProviders`,
  `getDiscovery()`, `getRedirectUri()`.
- Session: `exchangeCodeForTokens(code, codeVerifier)`,
  `refreshAccessToken(refreshToken)`, `getStoredTokens()`, `clearTokens()`.
- Display: `parseIdToken(idToken)`, `LoginButton`, `UserProfile`.
- Types: `AuthTokens`, `AuthUser`, `CognitoIdentityProvider`.

`parseIdToken` decodes display claims; it does **not** verify JWT signatures.
Never use it to authorize server requests. Refresh returns `null` on failure;
the consumer must surface the failure and request sign-in again. Clearing
local tokens does not revoke them or end the Cognito/browser session.
