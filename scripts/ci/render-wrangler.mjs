// CI 用：wrangler の設定ファイルにある開発用の D1 / R2 の値を、本番の値に置き換える。
// 使い方：node scripts/ci/render-wrangler.mjs wrangler.jsonc [他の設定ファイル...]
// 必要な環境変数：D1_DATABASE_NAME, D1_DATABASE_ID, R2_BUCKET_NAME
import { readFileSync, writeFileSync } from "node:fs";

const PLACEHOLDER_DB_ID = "00000000-0000-0000-0000-000000000000";
const LOCAL_DB_NAME = "times-local";
const LOCAL_BUCKET = "times-raw-placeholder";

const required = ["D1_DATABASE_NAME", "D1_DATABASE_ID", "R2_BUCKET_NAME"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`環境変数が足りません: ${missing.join(", ")}`);
  process.exit(1);
}
if (!/^[0-9a-f-]{36}$/i.test(process.env.D1_DATABASE_ID) || process.env.D1_DATABASE_ID === PLACEHOLDER_DB_ID) {
  console.error("D1_DATABASE_ID が本番の UUID ではありません");
  process.exit(1);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("設定ファイルを1つ以上指定してください");
  process.exit(1);
}

for (const file of files) {
  const before = readFileSync(file, "utf8");
  const after = before
    .replaceAll(PLACEHOLDER_DB_ID, process.env.D1_DATABASE_ID)
    .replaceAll(`"${LOCAL_DB_NAME}"`, JSON.stringify(process.env.D1_DATABASE_NAME))
    .replaceAll(`"${LOCAL_BUCKET}"`, JSON.stringify(process.env.R2_BUCKET_NAME));
  if (after.includes(PLACEHOLDER_DB_ID) || after.includes(`"${LOCAL_DB_NAME}"`) || after.includes(`"${LOCAL_BUCKET}"`)) {
    console.error(`${file}: 開発用の値が残っています`);
    process.exit(1);
  }
  writeFileSync(file, after);
  console.log(`${file}: 本番の D1 / R2 を設定しました`);
}
