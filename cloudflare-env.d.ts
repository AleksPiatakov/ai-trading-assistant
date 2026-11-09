declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    BYBIT_ENCRYPTION_KEY: string;
  }
}
