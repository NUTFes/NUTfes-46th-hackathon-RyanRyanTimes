declare global {
  interface CloudflareEnv {
    DB: D1Database;
    RAW: R2Bucket;
    DEV_LOGIN?: string;
    APP_ENV?: string;
    SESSION_SECRET?: string;
  }
}
export {};
