/**
 * Instagram/X 自動投稿システム - Cloudflare R2 連携
 *
 * S3互換APIを使用してR2にファイルをアップロードし、署名付きURLを生成
 */

/**
 * 画像をR2にアップロードし、署名付きURLを返す
 * @param {Blob} blob - 画像データ
 * @param {string} fileName - ファイル名
 * @param {number} expiresInSeconds - URL有効期限（秒）
 * @returns {string} 署名付きURL
 */
function uploadToR2AndGetSignedUrl(blob, fileName, expiresInSeconds = 3600) {
  const creds = getR2Credentials();

  if (!creds.accountId || !creds.accessKeyId || !creds.secretAccessKey || !creds.bucketName) {
    throw new Error('R2の認証情報が設定されていません');
  }

  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const key = `temp/${Date.now()}_${fileName}`;

  // アップロード
  uploadToR2(blob, key, creds, host);

  // 署名付きURL生成
  const signedUrl = generateR2SignedUrl(key, creds, host, expiresInSeconds);

  return signedUrl;
}

/**
 * R2にファイルをアップロード
 */
function uploadToR2(blob, key, creds, host) {
  const url = `https://${host}/${creds.bucketName}/${key}`;
  const method = 'PUT';
  const contentType = blob.getContentType();
  const content = blob.getBytes();

  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = formatDateStamp(now);

  const headers = {
    'Host': host,
    'Content-Type': contentType,
    'x-amz-content-sha256': sha256Hex(content),
    'x-amz-date': amzDate
  };

  const signature = signRequest(
    method,
    `/${creds.bucketName}/${key}`,
    '',
    headers,
    content,
    creds,
    'auto',
    dateStamp,
    amzDate
  );

  headers['Authorization'] = signature;

  const options = {
    method: method,
    headers: headers,
    payload: content,
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();

  if (responseCode < 200 || responseCode >= 300) {
    throw new Error(`R2アップロード失敗: ${responseCode} - ${response.getContentText()}`);
  }

  console.log(`R2アップロード完了: ${key}`);
}

/**
 * R2の署名付きURLを生成（GET用）
 */
function generateR2SignedUrl(key, creds, host, expiresInSeconds) {
  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = formatDateStamp(now);

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const credential = `${creds.accessKeyId}/${credentialScope}`;

  // クエリパラメータ
  const queryParams = {
    'X-Amz-Algorithm': algorithm,
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresInSeconds.toString(),
    'X-Amz-SignedHeaders': 'host'
  };

  // クエリ文字列を作成（アルファベット順）
  const sortedKeys = Object.keys(queryParams).sort();
  const canonicalQueryString = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  // 署名対象リクエストを作成
  const canonicalUri = `/${creds.bucketName}/${key}`;
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  // 署名文字列を作成
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256Hex(Utilities.newBlob(canonicalRequest).getBytes())
  ].join('\n');

  // 署名を計算
  const signingKey = getSignatureKey(creds.secretAccessKey, dateStamp, 'auto', 's3');
  const signature = hmacSha256Hex(signingKey, stringToSign);

  // 署名付きURLを組み立て
  const signedUrl = `https://${host}/${creds.bucketName}/${key}?${canonicalQueryString}&X-Amz-Signature=${signature}`;

  return signedUrl;
}

/**
 * R2から一時ファイルを削除
 */
function deleteFromR2(key) {
  const creds = getR2Credentials();
  const host = `${creds.accountId}.r2.cloudflarestorage.com`;

  const url = `https://${host}/${creds.bucketName}/${key}`;
  const method = 'DELETE';

  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = formatDateStamp(now);

  const headers = {
    'Host': host,
    'x-amz-content-sha256': sha256Hex([]),
    'x-amz-date': amzDate
  };

  const signature = signRequest(
    method,
    `/${creds.bucketName}/${key}`,
    '',
    headers,
    [],
    creds,
    'auto',
    dateStamp,
    amzDate
  );

  headers['Authorization'] = signature;

  const options = {
    method: method,
    headers: headers,
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  console.log(`R2削除: ${key} - ${response.getResponseCode()}`);
}

// === AWS Signature V4 ヘルパー関数 ===

/**
 * リクエストに署名
 */
function signRequest(method, path, queryString, headers, payload, creds, region, dateStamp, amzDate) {
  const algorithm = 'AWS4-HMAC-SHA256';
  const service = 's3';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  // ヘッダーを正規化
  const sortedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)]}`)
    .join('\n') + '\n';
  const signedHeaders = sortedHeaderKeys.join(';');

  // 正規リクエスト
  const payloadHash = sha256Hex(payload);
  const canonicalRequest = [
    method,
    path,
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  // 署名文字列
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256Hex(Utilities.newBlob(canonicalRequest).getBytes())
  ].join('\n');

  // 署名キーを導出
  const signingKey = getSignatureKey(creds.secretAccessKey, dateStamp, region, service);
  const signature = hmacSha256Hex(signingKey, stringToSign);

  // Authorization ヘッダー
  return `${algorithm} Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/**
 * 署名キーを導出
 */
function getSignatureKey(key, dateStamp, region, service) {
  const kDate = hmacSha256(`AWS4${key}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  return kSigning;
}

/**
 * HMAC-SHA256
 */
function hmacSha256(key, message) {
  const keyBytes = typeof key === 'string'
    ? Utilities.newBlob(key).getBytes()
    : key;
  return Utilities.computeHmacSha256Signature(
    Utilities.newBlob(message).getBytes(),
    keyBytes
  );
}

/**
 * HMAC-SHA256（16進数文字列）
 */
function hmacSha256Hex(key, message) {
  const signature = hmacSha256(key, message);
  return bytesToHex(signature);
}

/**
 * SHA256ハッシュ（16進数文字列）
 */
function sha256Hex(data) {
  const bytes = typeof data === 'string'
    ? Utilities.newBlob(data).getBytes()
    : data;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return bytesToHex(digest);
}

/**
 * バイト配列を16進数文字列に変換
 */
function bytesToHex(bytes) {
  return bytes.map(b => ('0' + ((b & 0xff).toString(16))).slice(-2)).join('');
}

/**
 * AMZ日付フォーマット（ISO 8601形式）
 */
function formatAmzDate(date) {
  return Utilities.formatDate(date, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
}

/**
 * 日付スタンプフォーマット
 */
function formatDateStamp(date) {
  return Utilities.formatDate(date, 'UTC', 'yyyyMMdd');
}
