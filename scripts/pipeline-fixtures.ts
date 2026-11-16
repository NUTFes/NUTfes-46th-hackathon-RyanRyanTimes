import { readFile } from "node:fs/promises";
import { getPlatformProxy } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/db/schema";
import type { Member, Stats, Tip } from "../src/lib/pipeline/types";

// 既存のサンプルを消さず、明示的な架空IDだけ準備する。実データには使わない。
if (process.argv.includes("--remote")) throw new Error("ローカル専用です");
const read = async <T>(file: string) => JSON.parse(await readFile(`tests/fixtures/${file}.json`, "utf8")) as T[];
const { env, dispose } = await getPlatformProxy<CloudflareEnv>({ persist: { path: ".wrangler/state/v3" } });
const db = drizzle(env.DB);
try {
  for (const member of await read<Member>("members")) {
    await db.insert(schema.members).values(member).onConflictDoNothing();
  }
  for (const row of await read<Stats>("history")) await db.insert(schema.monthly_stats).values(row).onConflictDoNothing();
  for (const tip of await read<Tip>("tips")) await db.insert(schema.tips).values(tip).onConflictDoNothing();
  console.log("架空の名簿・履歴・採用タレコミを準備しました。");
} finally { await dispose(); }
