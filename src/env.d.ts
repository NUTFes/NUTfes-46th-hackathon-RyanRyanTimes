declare global {
  interface CloudflareEnv {
    SLACK_CLIENT_ID?: string;
    SLACK_CLIENT_SECRET?: string;
    SLACK_TEAM_ID?: string;
    APP_BASE_URL?: string;
    DB: D1Database;
    RAW: R2Bucket;
    DEMO_PASSCODE?: string; DEV_LOGIN?: string;
    APP_ENV?: string;
    SESSION_SECRET?: string;
  }
}
export {};
