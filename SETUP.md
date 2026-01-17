# Instagram/X 自動投稿システム セットアップ手順書

## 前提条件

- Google アカウント
- Instagram Business または Creator アカウント（Facebookページと連携済み）
- X（Twitter）アカウント
- Cloudflare アカウント

---

## Step 1: API認証情報の取得

### 1.1 Instagram Graph API

#### Facebook Developer 設定

1. [Facebook Developers](https://developers.facebook.com/) にアクセス
2. 「マイアプリ」→「アプリを作成」
3. アプリタイプ: 「ビジネス」を選択
4. アプリ名を入力して作成

#### 必要な権限を追加

1. アプリダッシュボード → 「製品を追加」
2. 「Instagram Graph API」を追加
3. 左メニュー → 「アプリの設定」→「ベーシック」
4. 以下を控える:
   - **App ID**
   - **App Secret**（「表示」をクリック）

#### アクセストークンの取得

1. [Graph API Explorer](https://developers.facebook.com/tools/explorer/) にアクセス
2. 右上のアプリを作成したアプリに切り替え
3. 「ユーザーまたはページ」→ 自分のFacebookアカウントを選択
4. 「許可を追加」で以下を追加:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
5. 「Generate Access Token」をクリック
6. 生成されたトークンを控える（短期トークン）

#### 長期トークンへの変換

ブラウザで以下のURLにアクセス（値を置換）:

```
https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={短期トークン}
```

レスポンスの `access_token` が60日有効の長期トークンです。

#### Instagram Business Account ID の確認

```
https://graph.facebook.com/v18.0/me/accounts?access_token={長期トークン}
```

返ってきたページIDを使って:

```
https://graph.facebook.com/v18.0/{ページID}?fields=instagram_business_account&access_token={長期トークン}
```

`instagram_business_account.id` が **Instagram Business Account ID** です。

---

### 1.2 X (Twitter) API

1. [X Developer Portal](https://developer.twitter.com/) にアクセス
2. サインアップ / サインイン
3. 「Projects & Apps」→「+ New Project」
4. プロジェクト名・用途を入力
5. 「App」を作成

#### 認証情報の取得

1. 作成したApp → 「Keys and tokens」タブ
2. 以下を控える:
   - **API Key** (Consumer Key)
   - **API Key Secret** (Consumer Secret)
3. 「Access Token and Secret」セクション → 「Generate」
4. 以下を控える:
   - **Access Token**
   - **Access Token Secret**

#### 権限設定

1. App → 「Settings」タブ
2. 「User authentication settings」→ 「Set up」
3. App permissions: **Read and write** を選択
4. 保存

---

### 1.3 Cloudflare R2

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にアクセス
2. 左メニュー → 「R2」
3. 「Create bucket」→ バケット名（例: `instagram-temp`）を入力

#### API Token の作成

1. R2 → 「Manage R2 API Tokens」
2. 「Create API token」
3. 権限: **Admin Read & Write** を選択
4. 以下を控える:
   - **Access Key ID**
   - **Secret Access Key**

#### Account ID の確認

1. ダッシュボード右側の「Account ID」をコピー

---

## Step 2: Google Apps Script のセットアップ

### 2.1 スプレッドシートの作成

1. [Google Sheets](https://sheets.google.com/) で新規スプレッドシートを作成
2. 名前を「Instagram自動投稿管理」などに設定

### 2.2 Apps Script プロジェクトの作成

1. スプレッドシートで「拡張機能」→「Apps Script」
2. 新しいエディタが開く

### 2.3 スクリプトのコピー

`gas/src/` フォルダ内の各ファイルの内容をコピー:

1. エディタ左側の「+」→「スクリプト」で新規ファイル作成
2. 以下のファイルを作成してコードをコピー:
   - `Config.gs`
   - `Utils.gs`
   - `Grouping.gs`
   - `Spreadsheet.gs`
   - `R2Storage.gs`
   - `Instagram.gs`
   - `Twitter.gs`
   - `Main.gs`

3. `appsscript.json` の設定:
   - エディタ左側「プロジェクトの設定」（歯車アイコン）
   - 「appsscript.json」マニフェストを表示」にチェック
   - `appsscript.json` を開いて内容を置き換え

### 2.4 初期セットアップの実行

1. スプレッドシートを更新（F5）
2. メニューに「自動投稿システム」が追加される
3. 「自動投稿システム」→「初期セットアップ」を実行
4. 認可を求められたら許可

---

## Step 3: 認証情報の設定

「設定」シートに以下の値を入力:

| 設定項目 | 値 |
|---------|---|
| INSTAGRAM_APP_ID | Facebook App ID |
| INSTAGRAM_APP_SECRET | Facebook App Secret |
| INSTAGRAM_ACCESS_TOKEN | 長期アクセストークン |
| INSTAGRAM_BUSINESS_ACCOUNT_ID | 17841422021372550（既定値） |
| INSTAGRAM_TOKEN_EXPIRY | トークン有効期限（例: 2025-03-17） |
| X_API_KEY | X API Key |
| X_API_KEY_SECRET | X API Key Secret |
| X_ACCESS_TOKEN | X Access Token |
| X_ACCESS_TOKEN_SECRET | X Access Token Secret |
| R2_ACCOUNT_ID | Cloudflare Account ID |
| R2_ACCESS_KEY_ID | R2 Access Key ID |
| R2_SECRET_ACCESS_KEY | R2 Secret Access Key |
| R2_BUCKET_NAME | バケット名（例: instagram-temp） |
| NOTIFICATION_EMAIL | 通知先メールアドレス |
| POST_TIME | 投稿時刻（例: 12:00） |

---

## Step 4: 写真のエクスポートとグルーピング

### 4.1 Google Takeout でエクスポート

1. [Google Takeout](https://takeout.google.com/) にアクセス
2. 「選択をすべて解除」
3. 「Google フォト」のみチェック
4. 「すべてのフォトアルバムが含まれます」→ 対象アルバムを選択
5. エクスポート形式: ZIP
6. ダウンロード・展開

### 4.2 Google Drive にアップロード

1. 展開したフォルダを Google Drive にアップロード
2. アップロード先フォルダのIDを控える（URLの `/folders/` の後ろの文字列）

### 4.3 出力先フォルダの作成

1. Google Drive に「Instagram投稿用」フォルダを作成
2. フォルダIDを控える

### 4.4 グルーピング実行

1. スプレッドシートで「自動投稿システム」→「Phase 1: 初期処理」→「グルーピング実行」
2. ソースフォルダID、出力先フォルダIDを入力
3. 処理完了を待つ

### 4.5 フォルダスキャン

1. 「自動投稿システム」→「Phase 1: 初期処理」→「フォルダスキャン」
2. 「Instagram投稿用」フォルダのIDを入力
3. メインシートに作品一覧が生成される

---

## Step 5: スケジュール設定と投稿

### 5.1 作品名の入力（オプション）

メインシートの `work_name` 列に作品名を入力すると、キャプションが自動生成されます。

### 5.2 スケジュール設定

1. 「自動投稿システム」→「Phase 1: 初期処理」→「スケジュール設定」
2. 開始日を入力
3. 土日も投稿するか選択

### 5.3 テスト投稿

1. メインシートで任意の行を選択
2. 「自動投稿システム」→「Phase 2: 投稿」→「テスト投稿（選択行）」
3. Instagram / X を選んで投稿を確認

### 5.4 定期実行トリガーの設定

1. 「自動投稿システム」→「メンテナンス」→「定期実行トリガーを設定」
2. 設定シートの `POST_TIME` の時刻に毎日実行される

---

## トラブルシューティング

### Instagram投稿が失敗する

- トークンの有効期限を確認
- Instagram Business Account IDが正しいか確認
- 画像のサイズ・形式がInstagramの要件を満たしているか確認

### X投稿が失敗する

- APIキーの権限が「Read and write」になっているか確認
- レート制限に引っかかっていないか確認

### R2アップロードが失敗する

- Access Key ID と Secret Access Key が正しいか確認
- バケット名が正しいか確認
- Account IDが正しいか確認

---

## メンテナンス

### Instagramトークンの更新

システムは自動的にトークンの有効期限をチェックし、残り15日を切ると自動更新します。
手動で確認・更新する場合:

「自動投稿システム」→「メンテナンス」→「Instagramトークン確認・更新」

### 新規作品の追加（継続運用）

1. Google Drive の「Instagram投稿用」フォルダに新規フォルダを作成
2. 写真をアップロード
3. 「自動投稿システム」→「Phase 3: 運用」→「新規フォルダをスキャン」
4. 自動的にスプレッドシートに追加され、スケジュールが設定される
