export const config = {
  authOrigin: "https://auth.cqu.moe",
  clientId: "cqu-quicklogin-chrome",
  protocolVersion: 2 as const,
};

export const AUTH_ISSUER = "https://auth.cqu.moe/api/auth";

export const API_PATHS = {
  oauthAuthorize: "/api/v1/auth/oauth2/authorize",
  oauthToken: "/api/v1/auth/oauth2/token",
  quickloginDevices: "/api/v1/cqu/quicklogin/devices",
} as const;

export const DEVICE_SCOPE = "cqu:quicklogin:device";
export const SYNC_ALARM = "quicklogin-sync";
export const SYNC_PERIOD_MINUTES = 5;
export const PREPARING_SYNC_DELAY_MS = 30_000;
