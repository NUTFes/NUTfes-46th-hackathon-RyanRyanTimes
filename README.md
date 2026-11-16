# 良良タイムズ

作業票02の土台と読者向け画面。Next.js App Router / strict TypeScript / Tailwind / Drizzle / Cloudflare D1・R2 を使用します。人物・記事・リンクはすべて架空です。既存の `app-web/` とは独立しています。

## ローカルで始める

Node.js 22.14以降と pnpm 10 を用意し、`times/` で実行してください。

```powershell
pnpm install
Copy-Item .env.example .env.local
Copy-Item .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm db:seed
pnpm dev
```

`http://localhost:3000` を開きます。PowerShell で開始場所が不定の場合は、最初に `Set-Location 'C:\Users\kamij\Documents\NUT\NUTFES\nutmeg-hackathon-2026\times'` を実行してください。

このワークスペースにある pnpm を使う場合は `pnpm` の代わりに `node ..\.tools\node_modules\pnpm\bin\pnpm.cjs` を使用できます。

`.env.local` の `DEV_LOGIN=1` と `APP_ENV=local` により `/login` に架空の局員を選ぶ欄が出ます。`.dev.vars` は Wrangler のローカルプレビュー用です。`SESSION_SECRET` は32文字以上のランダム値に置き換えてください。両ファイルをコミットしないでください。

| 変数 | 用途 |
| --- | --- |
| `DEV_LOGIN` | `1` のときのみ開発ログインを許可。Next.js開発サーバーかつ `APP_ENV=local` が必要。本番ビルドでは強制無効 |
| `APP_ENV` | ローカルは `local`、Workerは `production` |
| `SESSION_SECRET` | セッション Cookie の HMAC-SHA256 署名用。32文字以上 |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | 将来の Slack OIDC 用。現段階では不要 |
| `GEMINI_API_KEY` | 将来の下書き生成スクリプト用。現段階では不要 |

Slack OIDC の login / callback API は501を返します。開発用以外の「Slack でログイン」ボタンは無効です。`/tips/new` はログインが必要なプレースホルダーです。

## D1 と R2

`wrangler.jsonc` の D1 `DB` は `database_name=times-local`、`database_id=00000000-0000-0000-0000-000000000000` というプレースホルダーです。R2 `RAW` の `bucket_name=times-raw-placeholder` も仮名です。ローカル操作では実際のアカウントやリソース作成は不要です。

D1/R2 のローカル状態は `times/.wrangler/state/v3/` に保存されます。`next dev` の OpenNext 開発初期化、Wrangler のマイグレーション、`getPlatformProxy` によるシードはこの状態を共有します。R2 は現段階ではバインディングだけ用意し、生データの取り込みは行いません。

```powershell
pnpm db:generate
pnpm db:migrate:local
pnpm db:seed
```

`src/db/schema.ts` がスキーマの正本、`drizzle/` が生成済みマイグレーションです。12テーブルすべてを用意しています。シードはサンプルIDの行だけを追加・更新するため再実行できます。編集部1名、新入生2名を含む8名、2026-10・2026-11の公開号、各号6本の公開記事と取り下げ・非公開各1本を登録します。11月号の発行日はサンプルとして12月1日に設定しています。

## 画面とAPI

| 画面 | パス |
| --- | --- |
| トップ・バックナンバー | `/` |
| 10月号 / 11月号 | `/issues/monthly/2026-10` / `/issues/monthly/2026-11` |
| 公開記事の例 | `/articles/novsample001` |
| 取り下げ / 非公開（404） | `/articles/novsample007` / `/articles/novsample008` |
| 開発ログイン | `/login?return_to=/tips/new` |

`GET /api/issues`、`GET /api/issues/{kind}/{target}`、`GET /api/articles/{slug}` はログイン不要です。エラーは `{ "error": { "code": "not_found", "message": "…" } }` の形式です。記事は公開状態・発行済みの号・本人のオプトアウトを D1 で検証します。匿名タレコミの送り主や本文、内部の種IDなどは公開APIに含めません。

Server Component は D1 を直接読み、React のリクエスト内キャッシュを共有します。根拠の数字の要約は `unstable_cache` で60秒キャッシュします。本文・状態・根拠投稿の作者のオプトアウトは都度確認します。公開状態の変更を即座に反映するため、紙面全体を固定HTMLとして配信するキャッシュは使用していません。後続の発行・訂正・取り下げ・非公開・オプトアウト処理では `invalidatePublicCache()` を呼んで持続キャッシュも即時破棄してください。

記事画像は `html-to-image` でブラウザ内で生成します。画像には題字・見出し・本文冒頭・記者コメントを含み、1080×1350ピクセルのPNGになります。Noto Serif JP は `next/font` でビルド時に取得されるため、初回ビルドにはフォント配信元へのネットワーク接続が必要です。`public/ryanryan.svg` は差し替え可能な仮の良良記者です。

## 検証

```powershell
pnpm build
pnpm test
pnpm typecheck
```

Vitest で公開状態の判定、署名の改ざん・期限切れ、Cookie属性、リダイレクトの制限、開発ログインの本番拒否、権限による401/403を確認します。

## Workers へのデプロイ（実行は別途）

この作業ではローカル資源だけを使用します。以下は将来、リソース作成・公開の承認を得た担当者が実行する手順です。

1. Cloudflare の本番 D1/R2 を用意し、`wrangler.jsonc` の仮ID・名前を置き換える。
2. Worker の `DEV_LOGIN=0` と `APP_ENV=production` を維持する。`.env.local` / `.dev.vars` はデプロイに含めない。
3. `pnpm exec wrangler secret put SESSION_SECRET` で本番用の秘密を設定する。Slack/Geminiの秘密は各機能実装時に設定する。
4. 本番への適用が承認されたマイグレーションだけを別途適用する。サンプルシードは本番に投入しない。
5. `pnpm build:worker` で `.open-next/worker.js` と静的資産を作成する。
6. `pnpm preview` でローカル Worker を確認してから、公開の承認を得て `pnpm deploy` を実行する。

`pnpm build` は Next.js ビルド、`pnpm build:worker` は OpenNext のデプロイ成果物の作成です。OpenNext のビルドがWindowsに対応しない場合は WSL/Linux で同じロックファイルを使用してください。
