# 開発の進め方・CI/CD（良良タイムズ）

## ブランチ
| ブランチ | 役割 |
|---|---|
| `main` | リリース用。ここへの push で本番にデプロイする |
| `develop` | 開発用。既定ブランチ。機能や修正はここへ PR で入れる |
| `feat/...`・`fix/...`・`docs/...`・`chore/...` | 作業用。`develop` から切り、1つの機能・修正ごとに `develop` へ PR を出す |

- `develop` から `main` へは、リリースするときに PR を出す
- PR はマージ後に作業ブランチが自動で消える
- PR には CodeRabbit が日本語でレビューを付ける（`.coderabbit.yaml`）

## CI（`.github/workflows/ci.yml`）
`develop`・`main` への PR と push で、型チェック・テスト・Cloudflare Workers 向けビルド（`pnpm build:worker`）を行う。

## CD（`.github/workflows/deploy.yml`）
`main` への push（と手動実行）で本番にデプロイする。Cloudflare の準備ができるまでは動かない。

### 本番デプロイの準備
1. Cloudflare で D1 データベースと R2 バケットを作る
2. GitHub のリポジトリ設定で、次を登録する
   - Secrets：`CLOUDFLARE_API_TOKEN`（Workers・D1・R2 の編集権限）、`CLOUDFLARE_ACCOUNT_ID`
   - Variables：`D1_DATABASE_NAME`、`D1_DATABASE_ID`、`R2_BUCKET_NAME`、`CF_DEPLOY_ENABLED=true`
   - Environment：`production`（必要なら承認者を設定）
3. アプリの秘密の値は、一度だけ手で Worker に登録する（`pnpm exec wrangler secret put <名前>`）。対象は README の環境変数一覧を参照（`SESSION_SECRET`、`SLACK_CLIENT_SECRET`、`GEMINI_API_KEY` など）
4. Slack アプリのリダイレクト URL に、本番の `https://<ドメイン>/api/auth/slack/callback` を登録する

### デプロイで行うこと
1. `scripts/ci/render-wrangler.mjs` で、wrangler の設定の開発用 D1 / R2 を本番の値に置き換える（リポジトリには開発用の値のまま置く）
2. `pnpm build:worker`
3. 本番 D1 にマイグレーションを適用
4. Worker を配備
- 月次の取り込み・集計・下書き作成（`pnpm monthly`）は、今は手元で実行する。本番 D1 / R2 へ書き込む経路（`--remote`）はまだ無効のまま。
