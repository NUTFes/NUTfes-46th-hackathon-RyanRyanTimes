# 良良タイムズ 詳細設計（作成中）

基本設計（`ryanryan-times-basic-design.md`）の機能ID（F-xx）・画面ID（S-xx）・種ID（K-xx）をそのまま使う。「暫定」と書いた値は設定値として実装し、運用中に調整してよい。

## 0. 技術スタック（11/16 決定）

| 層 | 選定 | 備考 |
|---|---|---|
| フレームワーク | Next.js（App Router）+ TypeScript | Cloudflare Workers 上で動かす（@opennextjs/cloudflare） |
| ホスティング | Cloudflare Workers（無料プラン） | CPU 10ms/リクエストの制限があるため、重い処理は Worker の外で行う |
| DB | Cloudflare D1（SQLite）+ Drizzle ORM | 記事・号・タレコミ・名簿・集計値 |
| ファイル | Cloudflare R2 | Slack / GitHub の生データ JSON、記事の画像 |
| 認証 | Sign in with Slack（OpenID Connect）を自前実装 | Slack アプリは管理者に作成を依頼中。用意できるまで開発用ユーザー切替で代用 |
| LLM | Gemini API | 下書き生成（F-09）、必要になれば本文判定 |
| 集計・下書き生成 | Node.js スクリプト（`scripts/`）をローカルまたは GitHub Actions で実行し、D1 / R2 に書き込む | Worker の CPU 制限を避ける |
| UI | Tailwind CSS、紙面用に Noto Serif JP | |
| 画像保存 | html-to-image（ブラウザ側で生成） | Worker に負荷をかけない |

### 処理の置き場所
| 処理 | 実行場所 | 理由 |
|---|---|---|
| 紙面・記事の表示（S-01〜S-03） | Worker。発行時に生成した HTML をキャッシュ | 読者のリクエストを軽くする |
| ログイン・タレコミ・マイページ・編集画面 | Worker | 軽い読み書きのみ |
| Slack 取り込み（PoC） | Claude Code の Slack コネクターで JSON を作り、スクリプトで R2 に上げる | Bot トークンが用意できるまで |
| GitHub 取得・集計・種の検出・下書き生成 | スクリプト（ローカル / GitHub Actions） | CPU 時間と外部 API の待ち時間が長い |
| 1年経過した生データの削除 | スクリプト（GitHub Actions の月次実行） | 同上 |

- S-27（取り込み・集計）は、PoC ではスクリプトの実行状況を表示し、実行手順を案内する画面にする。ボタンから GitHub Actions を起動する形は余力があれば対応する

## 1. 命名規則

| 日本語 | 識別子 |
|---|---|
| 局員 | member |
| 編集部員 | editor |
| タレコミ | tip |
| 頑張りの種 | seed |
| 根拠 | evidence |
| 記事 | article |
| 号 | issue |
| 月刊 / 年間特大号 | monthly / annual |
| 掲載通知 | notice |
| オプトアウト | opt_out |

状態値
| 対象 | 日本語 → 識別子 |
|---|---|
| タレコミ | 受付 received / 採用 adopted / 見送り declined / 取り消し withdrawn |
| 記事 | 下書き draft / 掲載決定 selected / 不掲載 unselected / 公開 published / 取り下げ retracted / 非公開 hidden |
| 号 | 編集中 editing / 発行 published |

規則
- DB のテーブル名・カラム名・JSON のキー：snake_case。テーブル名は複数形
- API パス：kebab-case、名詞は複数形。局員向けは `/api/...`、編集部向けは `/api/editor/...`
- 状態を変える操作は `POST /api/editor/<resource>/{id}/<動詞>`（adopt, decline, select, unselect, publish, hide, restore など）
- 画面パス：読者向けは `/...`、局員向けは `/me`・`/tips/...`、編集部向けは `/editor/...`
- 日時は ISO 8601（タイムゾーン付き）。月は `YYYY-MM`、集計は JST 基準

## 2. 認証と権限

| 種類 | 認証 | できること |
|---|---|---|
| 読者 | なし | S-01〜S-03 |
| 局員 | Sign in with Slack | 読者の機能＋S-11〜S-13 |
| 編集部 | Sign in with Slack＋`members.is_editor = true` | 局員の機能＋S-20〜S-27 |

- Slack の OpenID Connect で認証し、`team_id` が NUTMEG のワークスペースでなければ拒否する
- ログインに成功したら、`members` に `slack_user_id` があれば紐付け、なければ作る
- セッションは署名付き Cookie（HttpOnly、Secure、SameSite=Lax）。有効期限は30日（暫定）。セッション本体は D1 の `sessions` に置く
- `/api/editor/...` は編集部でなければ 403、未ログインなら 401
- 開発用ユーザー切替：環境変数 `DEV_LOGIN=1` のときだけ、S-10 に名簿から人を選んでログインできる欄を出す。本番では無効（ビルド時に除外し、Worker でも `DEV_LOGIN` を拒否する）

## 3. データ設計（D1）

### members（局員）
| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT (UUID) | |
| slack_user_id | TEXT | 一意 |
| display_name | TEXT | Slack の表示名 |
| real_name | TEXT / null | |
| avatar_url | TEXT / null | |
| github_login | TEXT / null | 一意。本人か編集部が紐付ける |
| joined_at | TEXT (日付) / null | Slack 参加日の推定値（チャンネル参加記録の最古の日付） |
| joined_at_source | TEXT | estimated / manual |
| is_editor | INTEGER (0/1) | 編集部 |
| is_active | INTEGER (0/1) | 退局者は 0 |
| opted_out_at | TEXT / null | オプトアウトした日時。入っていれば対象外 |
| created_at, updated_at | TEXT | |

- オプトアウトでは members の行だけ残し（`opted_out_at` と slack_user_id のみ。再取り込みで復活させないため）、他のテーブルの本人のデータを削除する
- 新入生判定：`joined_at` が対象月の末日から1年以内（暫定）

### sessions（ログインセッション）
id, member_id, expires_at, created_at

### activity_imports（取り込み記録）
| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | |
| source | TEXT | slack / github |
| month | TEXT | YYYY-MM |
| r2_key | TEXT | 生データ JSON の場所（例 `raw/slack/2026-11/C0123.json`） |
| channel_id | TEXT / null | Slack のみ |
| item_count | INTEGER | |
| imported_at | TEXT | |
| expires_at | TEXT | imported_at + 1年。過ぎたら R2 と行を消す |

### monthly_stats（月ごとの集計値、1年を過ぎても残す）
| カラム | 型 | 備考 |
|---|---|---|
| member_id | TEXT | |
| month | TEXT | (member_id, month) で一意 |
| commits, prs_opened, prs_merged, reviews, review_comments, issues_opened, doc_changes | INTEGER | GitHub |
| posts, thread_replies, question_replies, reactions_given, reactions_given_people, reactions_received, thanks_received, first_greetings | INTEGER | Slack |
| active_weeks | INTEGER | 活動した週の数 |
| weeks_in_month | INTEGER | |
| peak_hour | INTEGER / null | 味付け用 |
| top_emoji | TEXT / null | 味付け用 |
| firsts | TEXT (JSON) | 初コミット・初 PR などの一覧 |

### seeds（頑張りの種）
| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | |
| member_id | TEXT | |
| month | TEXT | 年間号の場合は `YYYY` 年度 |
| kind | TEXT | K-01〜K-14 |
| score | REAL | 並べ替え用（光り方＋最近載っていない人の加点） |
| summary | TEXT | 例「他人の PR を 12 件レビュー」 |
| metrics | TEXT (JSON) | 根拠の数字 |
| created_at | TEXT | |

### evidences（根拠）
| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | |
| seed_id | TEXT / null | |
| tip_id | TEXT / null | |
| source | TEXT | slack / github / tip |
| author_member_id | TEXT / null | 元の投稿の作者（オプトアウト時に外すため） |
| url | TEXT / null | Slack のパーマリンク、PR の URL |
| excerpt | TEXT / null | 本文の抜粋（200字まで） |
| occurred_at | TEXT | |

- 記事の根拠に使った投稿は、生データが消えたあとも記事が公開されている間はここに残る

### tips（タレコミ）
| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | |
| target_member_id | TEXT | 対象者 |
| sender_member_id | TEXT | 匿名でも保存（編集部だけが見られる） |
| is_anonymous | INTEGER (0/1) | |
| body | TEXT | 何が良かったか（1000字まで） |
| links | TEXT (JSON) | 関連リンク |
| status | TEXT | received / adopted / declined / withdrawn |
| decided_by | TEXT / null | 編集部員 |
| created_at, decided_at | TEXT | |

### articles（記事）
| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | |
| slug | TEXT | 公開 URL 用のランダム 12 文字。一意 |
| member_id | TEXT | 主役 |
| issue_id | TEXT / null | 掲載決定以降に入る |
| status | TEXT | draft / selected / unselected / published / retracted / hidden |
| headline | TEXT | 見出し |
| body | TEXT | 本文（新聞調） |
| reporter_comment | TEXT | 良良の記者コメント |
| main_seed_id | TEXT | 主役の種 |
| seed_ids | TEXT (JSON) | 添える種 |
| tip_ids | TEXT (JSON) | 使ったタレコミ |
| sort_order | INTEGER | 号の中の並び |
| is_top | INTEGER (0/1) | トップ記事 |
| lint_warnings | TEXT (JSON) | 表現チェックの結果 |
| generated_at | TEXT | 良良が書いた日時 |
| edited_by | TEXT / null | |
| published_at, retracted_at, hidden_at, updated_at | TEXT / null | |

### issues（号）
| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | |
| kind | TEXT | monthly / annual |
| target | TEXT | monthly は YYYY-MM、annual は年度 YYYY。(kind, target) で一意 |
| number | INTEGER | 通し号数（第◯号） |
| title | TEXT | 例「良良タイムズ 2026年11月号」 |
| editor_note | TEXT / null | 良良の編集後記 |
| status | TEXT | editing / published |
| published_at | TEXT / null | |

### notices（掲載通知）
id, issue_id, article_id, member_id, message（DM の文面）, sent_at（編集部が「送信済」にした日時、null なら未送信）

### 削除と保持のまとめ
| データ | 保持 |
|---|---|
| R2 の生データ、activity_imports | 取り込みから1年 |
| monthly_stats, seeds | 期限なし（年間号・「伸びた」判定に使う） |
| evidences | 参照する記事がある間 |
| オプトアウトした人 | members の最小限の行以外すべて削除。他人の記事の evidences からも本人の投稿を外す |

## 4. R2 のキー
- `raw/slack/<YYYY-MM>/<channel_id>.json`：Slack API の `conversations.history`＋スレッド返信をまとめた形
- `raw/slack/<YYYY-MM>/_channels.json`：対象チャンネルの一覧とチャンネル参加記録
- `raw/github/<YYYY-MM>.json`：コミット・PR・レビュー・Issue・変更ファイルの正規化イベント
- `images/articles/<slug>.png`：記事画像（任意。基本はブラウザで生成）

## 5. API 一覧

### 5.1 読者向け（ログイン不要）
| メソッド | パス | 用途 | 備考 |
|---|---|---|---|
| GET | /api/issues | 発行済みの号の一覧 | 新しい順 |
| GET | /api/issues/{kind}/{target} | 号の紙面 | 公開中の記事だけ。取り下げ・非公開・オプトアウトの記事は含めない |
| GET | /api/articles/{slug} | 記事 | 公開中でなければ 404 |

- 紙面・記事のページは Server Component で D1 から直接読み、キャッシュする。発行・訂正・取り下げ・非公開・オプトアウトのときにキャッシュを消す

### 5.2 局員向け（Slack ログイン）
| メソッド | パス | 用途 |
|---|---|---|
| GET | /api/auth/slack/login | Slack へリダイレクト（return_to を保持） |
| GET | /api/auth/slack/callback | OpenID Connect のコールバック |
| POST | /api/auth/logout | ログアウト |
| POST | /api/auth/dev-login | 開発用ユーザー切替（DEV_LOGIN=1 のときだけ） |
| GET | /api/me | 自分の情報、自分の記事、送ったタレコミ |
| PATCH | /api/me | GitHub アカウントの紐付け（github_login） |
| POST | /api/me/opt-out | オプトアウト（本人データの削除を実行） |
| POST | /api/me/opt-in | オプトアウトの解除（以後の集計から対象に戻る。消したデータは戻らない） |
| POST | /api/me/articles/{slug}/retract | 自分の記事の取り下げ |
| GET | /api/members/tip-targets | タレコミの宛先候補（オプトアウト中・退局者・自分を除く） |
| POST | /api/tips | タレコミを送る（target_member_id, body, links, is_anonymous） |
| POST | /api/tips/{id}/withdraw | 受付中のタレコミの取り消し（送り主のみ） |

### 5.3 編集部向け
| メソッド | パス | 用途 |
|---|---|---|
| GET | /api/editor/summary | S-20 の数字（未処理タレコミ、下書き、号の状態、取り込み漏れの警告） |
| GET | /api/editor/tips | タレコミ一覧（status で絞り込み、送り主を含む） |
| POST | /api/editor/tips/{id}/adopt | 採用（下書き生成の対象に入る） |
| POST | /api/editor/tips/{id}/decline | 見送り |
| POST | /api/editor/tips/{id}/reopen | 見送りを受付に戻す |
| GET | /api/editor/seeds?month= | 候補（種）の一覧。score 順 |
| GET | /api/editor/articles?month=&status= | 下書き・記事の一覧 |
| GET | /api/editor/articles/{id} | 記事と根拠（種・evidences・タレコミ） |
| PATCH | /api/editor/articles/{id} | 見出し・本文・記者コメントの編集（保存時に表現チェック） |
| POST | /api/editor/articles/{id}/regenerate | 作り直しの依頼（regeneration_requests に積み、スクリプトが処理） |
| POST | /api/editor/articles/{id}/select | 掲載決定（issue_id） |
| POST | /api/editor/articles/{id}/unselect | 不掲載 |
| POST | /api/editor/articles/{id}/to-draft | 下書きに戻す |
| POST | /api/editor/articles/{id}/hide | 公開中の記事を非公開 |
| POST | /api/editor/articles/{id}/restore | 非公開を公開に戻す |
| GET | /api/editor/issues | 号の一覧 |
| POST | /api/editor/issues | 号を作る（kind, target） |
| PATCH | /api/editor/issues/{id} | タイトル・編集後記・記事の並び順・トップ記事 |
| POST | /api/editor/issues/{id}/publish | 発行（掲載決定の記事を公開し、notices を作る） |
| GET | /api/editor/issues/{id}/notices | 掲載通知の文面一覧 |
| POST | /api/editor/notices/{id}/mark-sent | 送信済にする |
| GET | /api/editor/members | 名簿 |
| PATCH | /api/editor/members/{id} | GitHub 紐付け・参加日の手直し・在籍・編集部の付け外し |
| GET | /api/editor/imports | 取り込み記録と月ごとの状況 |

- 「作り直し」は Worker で Gemini を呼ばず、regeneration_requests（id, article_id, note, status, created_at）に積む。スクリプト `pnpm drafts:regenerate` が処理する。PoC では編集部が手で実行する
- 一括取り込み・集計・下書き生成の API は持たない（スクリプトで行う）

### 5.4 共通ルール
- エラーは `{"error": {"code": "...", "message": "..."}}`
- 400 validation_error / 401 unauthorized / 403 forbidden / 404 not_found / 409 invalid_state_transition / 429 rate_limited
- 状態遷移は基本設計 8 章の図にないものを 409 にする
- タレコミの送信は1人1日20件まで（暫定）。超えたら 429
- 匿名タレコミの送り主は /api/editor/... 以外では返さない

## 6. スクリプト（Worker の外で実行）
| コマンド | 内容 |
|---|---|
| `pnpm import:slack <YYYY-MM> <dir>` | コネクターで作った JSON を検証して R2 に上げ、activity_imports に記録 |
| `pnpm import:github <YYYY-MM>` | GitHub API から取得して R2 に上げ、activity_imports に記録 |
| `pnpm members:sync` | Slack の生データから局員を名簿に追加・更新、参加日を推定 |
| `pnpm aggregate <YYYY-MM>` | monthly_stats を計算 |
| `pnpm seeds <YYYY-MM>` | 種を検出して seeds・evidences を作る |
| `pnpm drafts <YYYY-MM>` | 種と採用タレコミから下書きをまとめて作る（Gemini） |
| `pnpm drafts:regenerate` | 作り直しの依頼を処理 |
| `pnpm cleanup` | 1年経過した生データを削除 |
| `pnpm monthly <YYYY-MM>` | import:github → members:sync → aggregate → seeds → drafts を順に実行 |

- スクリプトは wrangler の D1 / R2 バインディング（getPlatformProxy）を使い、ローカル開発 DB と本番 DB を `--remote` で切り替える

## 7. 判定のしきい値（暫定）
| 種 | 判定 |
|---|---|
| K-01 開発量 | commits・prs_opened・reviews のいずれかが、その月に活動した人の上位 10%（最低 3 人まで） |
| K-02 発信量 | posts が上位 10% |
| K-03 レビューで支えた | 他人の PR への reviews＋review_comments が 5 以上 |
| K-04 質問に答えた | question_replies が 3 以上。質問の判定：親投稿に「？」「?」「教えて」「わから」「どうすれば」「詰まって」「エラー」のいずれか |
| K-05 一番乗りで迎えた | 新入生の投稿に最初に返信・リアクションした回数（first_greetings）が 3 以上 |
| K-06 リアクションで応援した | reactions_given が 30 以上、かつ相手が 5 人以上 |
| K-07 先月より伸びた | いずれかの指標が直近3か月平均の2倍以上、かつ 5 以上。過去データが1か月以上ある人だけ |
| K-08 はじめての〇〇 | firsts にその月の項目がある（初コミット・初 PR・初マージ・初レビュー・初めて触るリポジトリ） |
| K-09 反応を集めた投稿 | リアクション合計が、その月の全投稿の上位 5 件 |
| K-10 感謝された | thanks_received が 3 以上。感謝の判定：スレッドで本人の直後の他人の返信に「ありがとう」「ありがと」「助かり」「助かる」「感謝」、または本人の投稿に pray・arigatou 系のリアクション |
| K-11 毎週続けた | active_weeks = weeks_in_month（その月の全週に活動） |
| K-12 推薦された | 採用したタレコミがある |
| K-13 課題を見つけた | issues_opened が 3 以上 |
| K-14 ドキュメントを書いた | doc_changes が 1 以上（README・docs/・*.md を変更したコミット・PR） |

- score ＝ 種ごとの基本点（K-12 は最高）＋ しきい値を超えた割合 ＋ 「最近載っていない」加点（直近3号に載っていなければ加点、一度も載っていなければさらに加点）
- ボット・オプトアウト中の人の投稿は全指標から除く。自分の投稿への自分のリアクションは数えない

## 8. 良良の下書き（Gemini）
- モデル：Gemini の高速モデル（設定値 GEMINI_MODEL）
- 入力：主役の種と添える種（種類・summary・metrics）、根拠の抜粋（最大5件）、採用タレコミの本文（匿名なら送り主なし、記名なら送り主の表示名）、新入生かどうか、味付け（peak_hour, top_emoji）
- 出力（JSON）：headline（25字以内）、body（新聞調、200〜400字）、reporter_comment（良良の口調、80字以内）
- システム指示に入れること
  - 本文は新聞調「〜した。」。誇張しない。根拠にない事実を足さない
  - 記者コメントは一人称「りゃんりゃん」、語尾「〜だよ」「〜だよ〜」、ゆるく優しく褒める
  - NG：他人や平均と比べて下げる、ミスや不在に触れる、徹夜・休みなし・深夜を褒める、成績・体調・私生活・DM・非公開の内容
  - 名前は Slack の表示名に「さん」を付ける
- 失敗時は3回まで再試行し、だめなら下書きを作らず候補のまま残す（S-22 に「下書きなし」と表示）

## 9. 表現チェック（F-10）
- 保存時と下書き生成時に実行し、lint_warnings に保存。警告があっても保存はできる。掲載決定時に未解消の警告があれば確認ダイアログを出す
- キーワード（暫定）
  - 比較で下げる：「より少な」「最下位」「平均以下」「だけしか」「に比べて」
  - ミス・不在：「休んで」「いなかった」「サボ」「バグを出」「失敗」「ミス」「遅れ」
  - 労働量の賛美：「徹夜」「寝ずに」「休みなし」「深夜まで」「朝まで」「不眠不休」
  - 個人情報：「成績」「単位」「体調」「病気」「彼氏」「彼女」「バイト先」

## 10. 画面詳細

### 10.1 読者向け
**S-01 トップ（/）**
- 最新号の題字・号数・発行日・トップ記事の見出し → S-02
- バックナンバー（号の一覧）
- 「あなたのまわりのいい話を教えて」ボタン → S-12（未ログインなら S-10）

**S-02 紙面（/issues/{kind}/{target}、例 /issues/monthly/2026-11）**
- 題字「良良タイムズ」、第◯号、発行日、対象月
- トップ記事（大見出し＋本文冒頭＋良良の絵）
- 残りの記事を新聞の段組みで（見出し＋冒頭 60 字）→ S-03
- 良良の編集後記、タレコミ導線
- スマホ幅（375px）では1段組み

**S-03 記事（/articles/{slug}）**
- 見出し、号へのリンク、本文、良良の記者コメント（吹き出し）、根拠の要約（数字と、Slack の投稿・PR へのリンク。リンク先は局員しか開けない）
- 「画像で保存」：1080×1350 の PNG（題字・見出し・本文冒頭・記者コメント）
- タレコミ導線。公開中でなければ 404。noindex。OGP は見出しと題字

### 10.2 局員向け
**S-10 ログイン（/login?return_to=）**：「Slack でログイン」。DEV_LOGIN=1 なら名簿から選ぶ欄

**S-11 マイページ（/me）**
- 自分の記事（公開中）：見出し・号・「取り下げる」（確認：「取り下げると元に戻せません」）
- 送ったタレコミ：対象者・送った日・状態（受付・採用・見送り）・「取り消す」（受付中のみ）
- GitHub アカウント：入力して保存
- 「記事にしないで」：オンにするときの確認「過去の記事を含めて、あなたのデータをすべて削除します。元に戻せません」

**S-12 タレコミ（/tips/new）**
- 対象者（名前で検索して選ぶ）、何が良かったか（必須、1000字まで）、関連リンク（任意、3件まで）、「匿名で送る」（説明：「紙面にも本人にも名前は出ません。編集部には分かります」）

**S-13 タレコミ完了（/tips/done）**：良良「教えてくれてありがとうだよ〜」、「もう1件送る」

### 10.3 編集部向け
- **S-20 編集部トップ（/editor）**：対象月の号の状態、未処理タレコミ数、下書き数、取り込み漏れの警告（前月分が未取り込み、または取り込みから80日を過ぎても未集計の月）、各画面へのリンク
- **S-21 タレコミ一覧（/editor/tips）**：状態で絞り込み。対象者・本文・送り主（匿名なら「匿名：◯◯」）・日付・採用／見送り
- **S-22 候補・下書き一覧（/editor/articles?month=）**：対象者・主役の種・下書きの見出し・警告数・状態。種の種類で絞り込み。「最近載っていない人」の印
- **S-23 記事の編集（/editor/articles/{id}）**：左に見出し・本文・記者コメントの編集欄と警告、右に根拠（種の数字、元の投稿の抜粋とリンク、タレコミ）。「作り直す」（注文を書ける）、「保存」、状態に応じたボタン
- **S-24 号の編集（/editor/issues/{id}）**：掲載決定の記事の並べ替え、トップ記事、編集後記、プレビュー（S-02 と同じ見た目）、「発行」（確認ダイアログ）
- **S-25 掲載通知（/editor/issues/{id}/notices）**：本人ごとの DM 文面（「りゃんりゃんだよ〜。今月の良良タイムズに◯◯さんの記事が載ったよ！ {URL}」）、「コピー」、Slack の DM を開くリンク、「送信済」
- **S-26 名簿・編集部員（/editor/members）**：表示名・GitHub・参加日・新入生・オプトアウト・編集部の一覧と編集
- **S-27 取り込み・集計（/editor/imports）**：月ごとの状況（Slack・GitHub・集計・種・下書き）と実行するコマンドの案内

## 11. 開発の順番（ハッカソン）
1. 土台：Next.js on Workers、D1 / R2、Drizzle のスキーマ、開発用ログイン、サンプルデータ
2. 読者向け：S-01〜S-03（サンプルの号で表示、画像保存）
3. スクリプト：GitHub 取り込み、Slack JSON 取り込み、集計、種の検出（テスト付き）
4. 下書き：Gemini、表現チェック
5. 編集部：S-20〜S-27
6. 局員：S-10〜S-13、取り下げ、オプトアウト
7. 実データ（11月分）で1号発行 → 成果発表
