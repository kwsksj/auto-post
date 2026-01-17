/**
 * Instagram/X 自動投稿システム - 設定
 */

// スプレッドシートのシート名
const SHEET_NAMES = {
  MAIN: 'メイン',
  SETTINGS: '設定'
};

// メインシートの列インデックス（0始まり）
const COLUMNS = {
  FOLDER_ID: 0,        // A: Google DriveのフォルダID
  FOLDER_NAME: 1,      // B: フォルダ名
  FOLDER_LINK: 2,      // C: フォルダへのハイパーリンク
  IMAGE_COUNT: 3,      // D: 画像枚数
  FIRST_PHOTO_DATE: 4, // E: 最初の写真の撮影日時
  WORK_NAME: 5,        // F: 作品名
  SCHEDULED_DATE: 6,   // G: 投稿予定日
  SKIP: 7,             // H: スキップフラグ
  CAPTION: 8,          // I: キャプション
  TAGS: 9,             // J: ハッシュタグ
  IG_POSTED: 10,       // K: Instagram投稿済フラグ
  IG_POST_ID: 11,      // L: Instagram投稿ID
  X_POSTED: 12,        // M: X投稿済フラグ
  X_POST_ID: 13,       // N: X投稿ID
  ERROR_LOG: 14        // O: エラーログ
};

// デフォルトハッシュタグ
const DEFAULT_TAGS = '#木彫り教室生徒作品 #木彫り #woodcarving #彫刻 #handcarved #woodart #ハンドメイド #手仕事';

// Instagram制限
const INSTAGRAM_MAX_CAROUSEL = 10;

// X制限
const X_MAX_IMAGES = 4;

// グルーピングのデフォルト閾値（分）
const DEFAULT_GROUPING_THRESHOLD_MINUTES = 10;

/**
 * 設定シートから値を取得
 */
function getSettingValue(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!settingsSheet) return null;

  const data = settingsSheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === key) {
      return data[i][1];
    }
  }
  return null;
}

/**
 * 設定シートに値を保存
 */
function setSettingValue(key, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!settingsSheet) return false;

  const data = settingsSheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === key) {
      settingsSheet.getRange(i + 1, 2).setValue(value);
      return true;
    }
  }
  // キーが存在しない場合は追加
  settingsSheet.appendRow([key, value]);
  return true;
}

/**
 * Instagram認証情報を取得
 */
function getInstagramCredentials() {
  return {
    appId: getSettingValue('INSTAGRAM_APP_ID'),
    appSecret: getSettingValue('INSTAGRAM_APP_SECRET'),
    accessToken: getSettingValue('INSTAGRAM_ACCESS_TOKEN'),
    businessAccountId: getSettingValue('INSTAGRAM_BUSINESS_ACCOUNT_ID'),
    tokenExpiry: getSettingValue('INSTAGRAM_TOKEN_EXPIRY')
  };
}

/**
 * X認証情報を取得
 */
function getXCredentials() {
  return {
    apiKey: getSettingValue('X_API_KEY'),
    apiKeySecret: getSettingValue('X_API_KEY_SECRET'),
    accessToken: getSettingValue('X_ACCESS_TOKEN'),
    accessTokenSecret: getSettingValue('X_ACCESS_TOKEN_SECRET')
  };
}

/**
 * R2認証情報を取得
 */
function getR2Credentials() {
  return {
    accountId: getSettingValue('R2_ACCOUNT_ID'),
    accessKeyId: getSettingValue('R2_ACCESS_KEY_ID'),
    secretAccessKey: getSettingValue('R2_SECRET_ACCESS_KEY'),
    bucketName: getSettingValue('R2_BUCKET_NAME')
  };
}

/**
 * 通知設定を取得
 */
function getNotificationSettings() {
  return {
    email: getSettingValue('NOTIFICATION_EMAIL'),
    enabled: getSettingValue('NOTIFICATION_ENABLED') === 'TRUE'
  };
}
