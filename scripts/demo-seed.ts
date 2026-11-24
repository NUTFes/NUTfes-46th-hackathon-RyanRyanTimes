import { mkdir, writeFile } from "node:fs/promises";

function sqlValue(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return "'" + value.replaceAll("'", "''") + "'";
  throw new TypeError("Unsupported seed SQL parameter");
}

export function demoSeed() {
  const statements: string[] = [];
  return {
    add(sql: string, params: readonly unknown[]) {
      let index = 0;
      const statement = sql.replace(/\?/g, () => sqlValue(params[index++]));
      if (index !== params.length) throw new Error("Incorrect seed SQL parameter count");
      statements.push(statement + ";");
    },
    async write() {
      await mkdir("demo", { recursive: true });
      await writeFile("demo/seed.sql", statements.join("\n") + "\n");
    },
  };
}
