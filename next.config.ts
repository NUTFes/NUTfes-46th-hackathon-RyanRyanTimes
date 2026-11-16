import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

const config: NextConfig = {
  // 公開状態は毎回 D1 で確認し、キャッシュ済み本文が残ることを防ぐ。
  serverExternalPackages: ["@opennextjs/cloudflare"],
};
export default config;
