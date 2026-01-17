# Instagram/X 自動投稿システム セットアップ手順書

## 前提条件

- Python 3.10以上
- Google アカウント
- Instagram Business または Creator アカウント（Facebookページと連携済み）
- X（Twitter）アカウント
- Cloudflare アカウント
- GitHub アカウント

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
3. 「許可を追加」で以下を追加:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
4. 「Generate Access Token」をクリック
5. 生成されたトークンを控える（短期トークン）

#### 長期トークンへの変換

ブラウザで以下のURLにアクセス:

```
https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={短期トークン}
```

レスポンスの `access_token` が60日有効の長期トークンです。

---

### 1.2 X (Twitter) API

1. [X Developer Portal](https://developer.twitter.com/) にアクセス
2. 「Projects & Apps」→「+ New Project」
3. プロジェクト名・用途を入力
4. 「App」を作成

#### 認証情報の取得

1. 作成したApp → 「Keys and tokens」タブ
2. 以下を控える:
   - **API Key** (Consumer Key)
   - **API Key Secret** (Consumer Secret)
3. 「Access Token and Secret」→ 「Generate」
4. 以下を控える:
   - **Access Token**
   - **Access Token Secret**

#### 権限設定

- App → 「Settings」→ 「User authentication settings」→ **Read and write**

---

### 1.3 Cloudflare R2

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にアクセス
2. 左メニュー → 「R2」→「Create bucket」
3. バケット名（例: `instagram-temp`）を入力

#### API Token の作成

1. R2 → 「Manage R2 API Tokens」→「Create API token」
2. 権限: **Admin Read & Write**
3. 以下を控える:
   - **Access Key ID**
   - **Secret Access Key**
   - **Account ID**（ダッシュボード右側）

---

### 1.4 Google Cloud / サービスアカウント

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 新しいプロジェクトを作成
3. 「APIとサービス」→「ライブラリ」
4. 以下のAPIを有効化:
   - Google Drive API
   - Google Sheets API

#### サービスアカウントの作成

1. 「APIとサービス」→「認証情報」
2. 「認証情報を作成」→「サービスアカウント」
3. 名前を入力して作成
4. 作成したサービスアカウントをクリック
5. 「キー」タブ →「鍵を追加」→「新しい鍵を作成」→ JSON
6. ダウンロードされた `credentials.json` を保存

#### スプレッドシートへの共有

1. Google Sheets で新規スプレッドシートを作成
2. スプレッドシートIDを控える（URLの `/d/` と `/edit` の間の文字列）
3. サービスアカウントのメールアドレス（`xxx@xxx.iam.gserviceaccount.com`）に編集権限を付与

#### Google Drive フォルダの共有

1. 「Instagram投稿用」フォルダを作成
2. フォルダIDを控える（URLの `/folders/` の後ろの文字列）
3. サービスアカウントのメールアドレスに閲覧権限を付与

---

## Step 2: ローカル環境のセットアップ

### 2.1 リポジトリのクローン

```bash
git clone https://github.com/kwsksj/auto-post.git
cd auto-post
```

### 2.2 Python 環境の構築

```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -e ".[dev]"
```

### 2.3 環境変数の設定

```bash
cp .env.example .env
```

`.env` ファイルを編集して認証情報を入力:

```
INSTAGRAM_APP_ID=your_app_id
INSTAGRAM_APP_SECRET=your_app_secret
INSTAGRAM_ACCESS_TOKEN=your_long_lived_access_token
...
```

### 2.4 credentials.json の配置

ダウンロードした `credentials.json` をプロジェクトルートに配置。

---

## Step 3: 初期設定

### 3.1 スプレッドシートの初期化

```bash
auto-post setup
```

### 3.2 フォルダのスキャン

Google Drive に画像フォルダを配置した後:

```bash
auto-post scan
```

### 3.3 フォルダ一覧の確認

```bash
auto-post list-folders
```

---

## Step 4: テスト投稿

### 4.1 特定フォルダをテスト投稿

```bash
# Instagram のみ
auto-post test-post FOLDER_ID --platform instagram

# X のみ
auto-post test-post FOLDER_ID --platform x

# 両方
auto-post test-post FOLDER_ID --platform both
```

---

## Step 5: GitHub Actions の設定

### 5.1 リポジトリのSecrets設定

GitHub リポジトリ → Settings → Secrets and variables → Actions

以下のSecretsを追加:

| Secret名 | 値 |
|---------|---|
| `INSTAGRAM_APP_ID` | Facebook App ID |
| `INSTAGRAM_APP_SECRET` | Facebook App Secret |
| `INSTAGRAM_ACCESS_TOKEN` | 長期アクセストークン |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram Business Account ID |
| `X_API_KEY` | X API Key |
| `X_API_KEY_SECRET` | X API Key Secret |
| `X_ACCESS_TOKEN` | X Access Token |
| `X_ACCESS_TOKEN_SECRET` | X Access Token Secret |
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Access Key |
| `R2_BUCKET_NAME` | バケット名 |
| `GOOGLE_CREDENTIALS_JSON` | credentials.json の内容（JSON文字列） |
| `GOOGLE_SPREADSHEET_ID` | スプレッドシートID |
| `GOOGLE_DRIVE_FOLDER_ID` | DriveフォルダID |

### 5.2 ワークフローの確認

- **Daily Post**: 毎日 12:00 JST に自動実行
- **Scan Folders**: 手動実行（Actions → Scan Folders → Run workflow）

---

## CLI コマンド一覧

```bash
# スプレッドシート初期化
auto-post setup

# フォルダスキャン
auto-post scan

# フォルダ一覧表示
auto-post list-folders

# 今日の投稿を実行
auto-post post

# 特定日の投稿を実行
auto-post post --date 2025-01-20

# テスト投稿
auto-post test-post FOLDER_ID --platform both

# トークン更新
auto-post refresh-token

# デバッグモード
auto-post --debug post
```

---

## トラブルシューティング

### Instagram投稿が失敗する

- トークンの有効期限を確認（60日で失効）
- `auto-post refresh-token` でトークンを更新
- 画像サイズがInstagramの要件を満たしているか確認

### X投稿が失敗する

- APIキーの権限が「Read and write」になっているか確認
- レート制限に引っかかっていないか確認

### R2アップロードが失敗する

- Access Key ID と Secret Access Key が正しいか確認
- バケット名とAccount IDが正しいか確認

### Google API エラー

- サービスアカウントにスプレッドシート・フォルダへのアクセス権限があるか確認
- credentials.json が正しい場所にあるか確認
