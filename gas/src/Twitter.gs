/**
 * Instagram/X 自動投稿システム - X (Twitter) API 連携
 *
 * OAuth 1.0a 認証を使用
 */

const X_API_BASE = 'https://api.twitter.com/2';
const X_UPLOAD_BASE = 'https://upload.twitter.com/1.1';

/**
 * Xに画像付きツイートを投稿
 * @param {string} folderId - Google DriveのフォルダID
 * @param {string} text - ツイート本文
 * @returns {string} ツイートID
 */
function postToX(folderId, text) {
  const creds = getXCredentials();

  if (!creds.apiKey || !creds.accessToken) {
    throw new Error('X認証情報が設定されていません');
  }

  // フォルダから画像を取得
  const folder = DriveApp.getFolderById(folderId);
  const images = getImagesFromFolder(folder);

  if (images.length === 0) {
    throw new Error('フォルダに画像がありません');
  }

  console.log(`X投稿開始: ${images.length}枚の画像`);

  // Xは最大4枚まで
  const imagesToPost = images.slice(0, X_MAX_IMAGES);

  if (images.length > X_MAX_IMAGES) {
    console.log(`注意: ${images.length}枚中、最初の${X_MAX_IMAGES}枚のみ投稿します`);
  }

  // 画像をアップロード
  const mediaIds = [];
  for (const image of imagesToPost) {
    const blob = image.file.getBlob();
    const mediaId = uploadMediaToX(creds, blob);
    mediaIds.push(mediaId);
    sleep(500); // レート制限対策
  }

  // ツイート投稿
  const tweetId = postTweet(creds, text, mediaIds);

  console.log(`X投稿完了: ${tweetId}`);
  return tweetId;
}

/**
 * 画像をXにアップロード
 */
function uploadMediaToX(creds, blob) {
  const url = `${X_UPLOAD_BASE}/media/upload.json`;

  // 画像をBase64エンコード
  const base64Data = Utilities.base64Encode(blob.getBytes());

  const params = {
    media_data: base64Data
  };

  const response = makeOAuth1Request(creds, 'POST', url, params);
  const result = parseJSON(response.getContentText());

  if (result.error || result.errors) {
    const errorMsg = result.error || result.errors.map(e => e.message).join(', ');
    throw new Error(`メディアアップロード失敗: ${errorMsg}`);
  }

  console.log(`メディアアップロード完了: ${result.media_id_string}`);
  return result.media_id_string;
}

/**
 * ツイートを投稿
 */
function postTweet(creds, text, mediaIds) {
  const url = `${X_API_BASE}/tweets`;

  const payload = {
    text: text
  };

  if (mediaIds && mediaIds.length > 0) {
    payload.media = {
      media_ids: mediaIds
    };
  }

  const response = makeOAuth1JsonRequest(creds, 'POST', url, payload);
  const result = parseJSON(response.getContentText());

  if (result.error || result.errors) {
    const errorMsg = result.error || result.errors.map(e => e.message).join(', ');
    throw new Error(`ツイート投稿失敗: ${errorMsg}`);
  }

  return result.data.id;
}

// === OAuth 1.0a ヘルパー関数 ===

/**
 * OAuth 1.0a リクエストを実行（form-urlencoded）
 */
function makeOAuth1Request(creds, method, url, params) {
  const oauth = generateOAuthParams(creds);
  const allParams = { ...oauth, ...params };

  // 署名ベース文字列を作成
  const signatureBase = createSignatureBase(method, url, allParams);

  // 署名キー
  const signingKey = `${encodeURIComponent(creds.apiKeySecret)}&${encodeURIComponent(creds.accessTokenSecret)}`;

  // 署名を計算
  const signature = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(signatureBase, signingKey)
  );

  oauth.oauth_signature = signature;

  // Authorization ヘッダーを作成
  const authHeader = createAuthHeader(oauth);

  // リクエスト本文
  const body = Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const options = {
    method: method,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    payload: body,
    muteHttpExceptions: true
  };

  return UrlFetchApp.fetch(url, options);
}

/**
 * OAuth 1.0a リクエストを実行（JSON）
 */
function makeOAuth1JsonRequest(creds, method, url, payload) {
  const oauth = generateOAuthParams(creds);

  // 署名ベース文字列を作成（JSON POSTの場合、bodyパラメータは含めない）
  const signatureBase = createSignatureBase(method, url, oauth);

  // 署名キー
  const signingKey = `${encodeURIComponent(creds.apiKeySecret)}&${encodeURIComponent(creds.accessTokenSecret)}`;

  // 署名を計算
  const signature = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(signatureBase, signingKey)
  );

  oauth.oauth_signature = signature;

  // Authorization ヘッダーを作成
  const authHeader = createAuthHeader(oauth);

  const options = {
    method: method,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  return UrlFetchApp.fetch(url, options);
}

/**
 * OAuthパラメータを生成
 */
function generateOAuthParams(creds) {
  return {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0'
  };
}

/**
 * 署名ベース文字列を作成
 */
function createSignatureBase(method, url, params) {
  // パラメータをソートしてエンコード
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  return `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
}

/**
 * Authorization ヘッダーを作成
 */
function createAuthHeader(oauth) {
  const parts = Object.keys(oauth)
    .filter(k => k.startsWith('oauth_'))
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauth[k])}"`)
    .join(', ');

  return `OAuth ${parts}`;
}

/**
 * ランダムなnonce（ワンタイムトークン）を生成
 */
function generateNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
