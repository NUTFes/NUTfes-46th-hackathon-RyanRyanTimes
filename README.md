# 良良タイムズ

読者向け紙面、局員・編集部の画面、Slack OIDC、月次集計・下書きスクリプト。Next.js App Router / strict TypeScript / Tailwind / Drizzle / Cloudflare D1・R2 を使用します。サンプルの人物・記事・リンクはすべて架空です。既存の `app-web/` とは独立しています。

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
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack OIDC のクライアントID・秘密（開発ログインだけなら不要） |
| `GITHUB_TOKEN` | GitHub 読み取り用。`--fixture` 使用時は不要 |
| `GITHUB_ORG` | 取得対象の組織。既定値 `NUTFes` |
| `GEMINI_API_KEY` | 下書き生成用。未設定なら通信せず決定的なテンプレートで生成 |
| `GEMINI_MODEL` | Gemini のモデル名。既定値 `gemini-2.5-flash` |

Slack ログインは `/api/auth/slack/login` から開始し、署名付き state・nonce・Slack JWKS による id_token の検証後、許可されたワークスペースの局員だけをログインさせます。

## D1 と R2

`wrangler.jsonc` の D1 `DB` は `database_name=times-local`、`database_id=00000000-0000-0000-0000-000000000000` というプレースホルダーです。R2 `RAW` の `bucket_name=times-raw-placeholder` も仮名です。ローカル操作では実際のアカウントやリソース作成は不要です。

D1/R2 のローカル状態は `times/.wrangler/state/v3/` に保存されます。`next dev` の OpenNext 開発初期化、Wrangler のマイグレーション、`getPlatformProxy` によるシード・月次スクリプトはこの状態を共有します。R2 の生データは `raw/slack/<YYYY-MM>/<channel_id>.json`、`raw/slack/<YYYY-MM>/_channels.json`、`raw/github/<YYYY-MM>.json` に保存します。

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

Server Component は D1 を直接読み、React のリクエスト内キャッシュを共有します。根拠の数字の要約は `unstable_cache` で60秒キャッシュします。本文・状態・根拠投稿の作者のオプトアウトは都度確認します。公開状態の変更を即座に反映するため、紙面全体を固定HTMLとして配信するキャッシュは使用していません。発行・訂正・取り下げ・非公開・復元・オプトアウト処理は `invalidatePublicCache()` で持続キャッシュも即時破棄します。

記事画像は `html-to-image` でブラウザ内で生成します。画像には題字・見出し・本文冒頭・記者コメントを含み、1080×1350ピクセルのPNGになります。BIZ UDPMincho Bold と BIZ UDPGothic は `next/font` でビルド時に取得されるため、初回ビルドにはフォント配信元へのネットワーク接続が必要です。`public/ryanryan.svg` は承認済みデザインのパンダの顔です。

## 検証

```powershell
pnpm build
pnpm test
pnpm typecheck
```

Vitest で公開状態の判定、署名の改ざん・期限切れ、Cookie属性、リダイレクトの制限、開発ログインの本番拒否、権限による401/403を確認します。

## 月次パイプライン

`times/` で実行します。D1 のマイグレーションが前提です。各スクリプトは `tsx` と Wrangler `getPlatformProxy` を使い、既定でローカル D1/R2 に書き込みます。`--remote` は予約済みとして明示的に拒否します。

```powershell
pnpm db:migrate:local
# 全14種を確認するための架空名簿・GitHub紐付け・前月集計・匿名採用タレコミ（任意）
pnpm pipeline:fixtures
pnpm import:slack 2026-11 tests/fixtures/slack-2026-11
pnpm import:github 2026-11 --fixture tests/fixtures/github-2026-11.json
pnpm members:sync
pnpm aggregate 2026-11
pnpm seeds 2026-11
pnpm drafts 2026-11
# pipeline:fixtures を使った場合の保存内容の検証
pnpm pipeline:verify
```

API キーは不要です。`pipeline:fixtures` を省略しても Slack から名簿・種・下書きを作れますが、GitHub の集計には本人または編集部による `github_login` の紐付けが必要です。Slack の名前から GitHub アカウントを推測して紐付けることはありません。サンプルのボット・オプトアウトを含む全条件の確認には `pipeline:fixtures` を先に実行します。

```powershell
# Slack取り込み後、GitHub取り込みから下書きまでを順に実行（オフライン）
pnpm monthly 2026-11 --fixture tests/fixtures/github-2026-11.json
# 編集画面などが登録した pending の再生成依頼を処理
pnpm drafts:regenerate
# 取り込みから1年を過ぎた生データと取り込み記録を削除
pnpm cleanup
```

実 API を使う場合の `GITHUB_TOKEN`・`GITHUB_ORG`・`GEMINI_API_KEY`・`GEMINI_MODEL` は、スクリプトのプロセス環境変数として設定します（Next.js の `.env.local` は自動読込しません）。`import:github` と `monthly` は `--fixture` を省略すると GitHub API を呼ぶため、オフライン検証では必ず指定してください。Octokit のページ取得とレート制限・一時障害の再試行を使用します。コミットの変更ファイル、当月に開いたPR・マージされたPR、以前に開いたPRへの当月レビュー・レビューコメント、当月に開いたIssueを保存します。

Gemini には主役・添える種、根拠最大5件、採用タレコミ、表示名、新入生判定、味付けを渡します。匿名タレコミの送り主と深夜の時刻は渡しません。JSON と字数を検証し、初回失敗後に最大3回再試行します。すべて失敗したら候補を残し、記事を新規作成しません。再生成は下書き状態だけを対象にし、依頼を completed / failed に更新します。テンプレート生成も見出し25字・本文200〜400字・記者コメント80字の制約と表現チェックを通します。下書きは自動公開しません。

取り込みは同じ R2 キーの記録を更新し、集計は局員と月の組で upsert します。種と根拠には安定したIDを使い、既存記事を通常の `drafts` で上書きしません。記事に添えた根拠は再実行や raw の期限切れ後にも残します。オプトアウト行を名簿同期で復元せず、手動で設定した参加日も維持します。

### Slack JSON の形式

`_channels.json` は次の形です。公開チャンネルだけを指定し、チャンネルごとの `<id>.json` をすべて用意します。`users` と `workspace_url` は任意です。表示名がない人は Slack ID で追加します。

```json
{
  "channels": [{ "id": "EXAMPLE_C1", "name": "架空の公開チャンネル" }],
  "channel_joins": [{ "channel_id": "EXAMPLE_C1", "user": "EXAMPLE_U1", "ts": "1775000000.000000" }],
  "users": [{ "id": "EXAMPLE_U1", "display_name": "架空の局員", "is_bot": false }],
  "workspace_url": "https://example.slack.com"
}
```

各チャンネルJSONは `conversations.history` 型の `messages` 配列です。全ページをまとめてから取り込みます。返信は `thread_ts` を持つ完全な投稿として配列に並べるか、親の `replies` に本文付きで入れます。Slack標準の `replies` の ID・時刻だけの要約は受け付けません。リアクションは `name` と `users` を使い、`count` ではなく除外後の実ユーザー数を数えます。`workspace_url` がある場合はパーマリンクを生成します。

JST で月を区切り、月曜始まりの端数週も全週に含めます。リアクション日時がない標準 history は、投稿月のスナップショットとして数えます。そのリアクションは活動週と最初の歓迎の時系列判定には使いません。日時が分かる場合は任意の `timestamps: { "ユーザーID": "Slack時刻" }` をリアクションに付けられます。「初挑戦」は保持されたrawと過去集計で観測できる範囲の初回で、取り込み以前の全履歴を保証しません。過去データは先に取り込み・集計してください。

しきい値・基本点と加点は `src/lib/pipeline/seeds.ts`、質問・感謝の語は `aggregate.ts`、表現チェックとプロンプトは `drafts.ts` で調整できます。順位判定の同数は同じ扱いにし、ゼロ件は候補にしません。スコアは基本点（通常10、推薦1000）＋しきい値の超過割合（最大100）＋直近3号未掲載5点＋未掲載5点です。

### 制限された Windows 実行環境

OS のユーザー情報取得で `tsx` が `uv_os_get_passwd ENOMEM` になる環境だけ、次の任意プリロードを使えます。環境変数から一時ディレクトリ名用のユーザー情報を補います。Wrangler のログとレジストリも作業フォルダ内へ保存できます。アプリやユーザーの設定ファイルは変更しません。

```powershell
$env:NODE_OPTIONS='--require=./scripts/windows-userinfo.cjs'
$env:XDG_CONFIG_HOME=(Join-Path (Get-Location).Path '.wrangler/xdg')
$env:WRANGLER_LOG_PATH='.wrangler/logs'
$env:WRANGLER_SEND_METRICS='false'
```

結合検証用に `pnpm pipeline:verify --prepare-maintenance` → `pnpm drafts:regenerate` → `pnpm cleanup` → `pnpm pipeline:verify --after-maintenance` と実行すると、架空の再生成依頼と期限切れrawの処理も確認できます。`scripts/create-pipeline-fixtures.mjs` はコミット済みJSONの再生成用です。

## Workers へのデプロイ（実行は別途）

この作業ではローカル資源だけを使用します。以下は将来、リソース作成・公開の承認を得た担当者が実行する手順です。

1. Cloudflare の本番 D1/R2 を用意し、`wrangler.jsonc` の仮ID・名前を置き換える。
2. Worker の `DEV_LOGIN=0` と `APP_ENV=production` を維持する。`.env.local` / `.dev.vars` はデプロイに含めない。
3. `pnpm exec wrangler secret put SESSION_SECRET` で本番用の秘密を設定する。Slack/Geminiの秘密は各機能実装時に設定する。
4. 本番への適用が承認されたマイグレーションだけを別途適用する。サンプルシードは本番に投入しない。
5. `pnpm build:worker` で `.open-next/worker.js` と静的資産を作成する。
6. `pnpm preview` でローカル Worker を確認してから、公開の承認を得て `pnpm deploy` を実行する。

`pnpm build` は Next.js ビルド、`pnpm build:worker` は OpenNext のデプロイ成果物の作成です。OpenNext のビルドがWindowsに対応しない場合は WSL/Linux で同じロックファイルを使用してください。


## 局員と編集部

`/me` で自分の記事の取り下げ、送ったタレコミの確認・受付中の取消、GitHub の紐付け、オプトアウト・解除ができます。`/tips/new` は在籍中・対象内の自分以外の局員を検索して選び、本文1000字・リンク3件までで送信します。匿名の送り主は編集部だけが確認でき、1日（JST）20件を超えると429になります。

編集部は `/editor` から `/editor/tips`、`/editor/articles`、`/editor/issues`、`/editor/members`、`/editor/imports` へ進みます。タレコミを採用すると K-12 の種と根拠が作られ、対象月の `pnpm drafts 2026-11` で下書きになります。編集保存時に表現チェックし、警告が残る記事を掲載決定する場合は確認が必要です。号を作成して記事を選び、号の編集で並び順・トップ・編集後記を保存してプレビュー・発行します。公開中の記事は訂正・非公開・復元ができ、本人が取り下げた記事は復元できません。設計にない状態遷移は409です。

発行すると `/editor/issues/{id}/notices` に本人宛ての DM 文面が作られます。コピーして Slack で手動送信し、「送信済」にしてください。アプリ自身は Slack へ送信しません。作り直し依頼は `regeneration_requests` に積み、`pnpm drafts:regenerate` で処理します。名簿の GitHub・参加日（手動）・在籍・編集部を編集できます。取り込み・集計画面は月別の状況と既存スクリプトの正確なコマンドを案内します。

オプトアウトは確認後、本人の記事・種・根拠・集計・宛先/送り主のタレコミ・通知・再生成依頼・セッション・記事画像と、R2 raw 内の本人の投稿・リアクション・GitHub 活動を削除し、他人の記事から本人作成の根拠も外します。再取り込み防止に必要な名簿の最小行を保持します。再ログインして解除できますが、削除したデータは戻りません。

## Slack アプリの設定

Slack アプリの **Sign in with Slack / OpenID Connect** を設定し、Redirect URL を **`https://<公開ホスト>/api/auth/slack/callback`** に登録します。ローカルで Slack 認証する場合も Slack が許可する HTTPS URL を使用し、`APP_BASE_URL` と登録先を一致させてください。要求スコープは **`openid profile email`** です。Bot のチャット権限はログインには不要です。

| 変数 | 用途 |
| --- | --- |
| `SLACK_CLIENT_ID` | Slack アプリの Client ID |
| `SLACK_CLIENT_SECRET` | Slack アプリの Client Secret（秘密） |
| `SLACK_TEAM_ID` | ログインを許可するワークスペースの ID |
| `APP_BASE_URL` | 末尾スラッシュなしの公開オリジン。callback と通知の記事URLに使用 |
| `SESSION_SECRET` | state/nonce とセッションの署名用、32文字以上 |

Next.js ローカル開発では `.env.local`、Worker では環境変数・secret bindings に設定します。開発ログインは従来どおり `DEV_LOGIN=1`・`APP_ENV=local`・開発ビルドだけで使えます。Slack 認証の単体テストは fetch・token 応答・JWKS をモックし、実 Slack に接続しません。

## Task 07 の通し検証

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:dev
```

`smoke:dev` はローカル D1/R2 に `smoke-` 専用の架空局員・素材を準備し、ポート3117、出力先 `.next-smoke/` の独立した開発サーバーを起動・終了します。既存サーバーを停止しません。既存の発行号は変更せず、未使用の2099年度以降に架空の検証号を1つ作ります。自分が作った `smoke-` データだけを次回に再初期化します。処理ログは `.wrangler/dev-smoke.log` に残ります。Gemini キーは子プロセスから外し、`pnpm drafts 2026-11` をオフラインで実行します。

局員ログイン → 記名/匿名投稿 → 取消 → 編集部ログイン → 見送り/受付復帰/採用 → 下書き生成 → 警告付き編集 → 確認付き掲載決定 → 号の作成/発行 → 非公開/復元 → 通知の送信済 → 本人取り下げ後404 → オプトアウトでDB/R2と他人の根拠も削除 → 解除 → 20件制限を検証します。`SMOKE_BASE_URL` を指定すると既存のローカル開発サーバーで同じ検証を行い、起動・終了は行いません。
