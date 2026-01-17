/**
 * Instagram/X 自動投稿システム - ユーティリティ関数
 */

/**
 * 日付をフォーマット
 */
function formatDate(date, format = 'yyyy-MM-dd HH:mm:ss') {
  return Utilities.formatDate(date, 'Asia/Tokyo', format);
}

/**
 * 現在日時を取得
 */
function now() {
  return new Date();
}

/**
 * 今日の日付を取得（時刻なし）
 */
function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * エラーログをスプレッドシートに記録
 */
function logError(sheet, row, service, message) {
  const timestamp = formatDate(now());
  const errorEntry = `${timestamp} | ${service} | ${message}`;

  const currentLog = sheet.getRange(row, COLUMNS.ERROR_LOG + 1).getValue();
  const newLog = currentLog ? `${currentLog}\n${errorEntry}` : errorEntry;

  sheet.getRange(row, COLUMNS.ERROR_LOG + 1).setValue(newLog);

  // コンソールにも出力
  console.error(`[${service}] Row ${row}: ${message}`);
}

/**
 * エラー通知を送信
 */
function sendErrorNotification(subject, body) {
  const settings = getNotificationSettings();
  if (!settings.enabled || !settings.email) {
    console.log('通知がオフか、メールアドレスが未設定です');
    return;
  }

  try {
    MailApp.sendEmail({
      to: settings.email,
      subject: `[自動投稿システム] ${subject}`,
      body: body
    });
    console.log(`通知送信完了: ${subject}`);
  } catch (e) {
    console.error(`通知送信失敗: ${e.message}`);
  }
}

/**
 * キャプションを生成
 */
function generateCaption(workName, customCaption, tags) {
  let caption = '';

  // カスタムキャプションが設定されている場合はそれを使用
  if (customCaption && customCaption.trim()) {
    caption = customCaption.trim();
  } else if (workName && workName.trim()) {
    // work_nameから自動生成
    caption = `${workName.trim()}の木彫りです！`;
  }

  // タグを追加
  const finalTags = tags && tags.trim() ? tags.trim() : DEFAULT_TAGS;

  if (caption) {
    return `${caption}\n\n${finalTags}`;
  } else {
    return finalTags;
  }
}

/**
 * 画像ファイルかどうかを判定
 */
function isImageFile(file) {
  const mimeType = file.getMimeType();
  return mimeType.startsWith('image/');
}

/**
 * フォルダ内の画像ファイルを取得（撮影日時順）
 */
function getImagesFromFolder(folder) {
  const files = folder.getFiles();
  const images = [];

  while (files.hasNext()) {
    const file = files.next();
    if (isImageFile(file)) {
      images.push({
        file: file,
        id: file.getId(),
        name: file.getName(),
        created: file.getDateCreated()
      });
    }
  }

  // ファイル名でソート（01_, 02_ などのプレフィックスを考慮）
  images.sort((a, b) => {
    // 数字プレフィックスを抽出
    const numA = extractNumericPrefix(a.name);
    const numB = extractNumericPrefix(b.name);

    if (numA !== null && numB !== null) {
      return numA - numB;
    }

    // プレフィックスがない場合は作成日時でソート
    return a.created - b.created;
  });

  return images;
}

/**
 * ファイル名から数字プレフィックスを抽出
 */
function extractNumericPrefix(filename) {
  const match = filename.match(/^(\d+)[_\-\s]/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * 配列を指定サイズのチャンクに分割
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * スリープ（ミリ秒）
 */
function sleep(ms) {
  Utilities.sleep(ms);
}

/**
 * リトライ付きでHTTPリクエストを実行
 */
function fetchWithRetry(url, options, maxRetries = 3, delayMs = 1000) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      return response;
    } catch (e) {
      lastError = e;
      console.warn(`リクエスト失敗 (${i + 1}/${maxRetries}): ${e.message}`);

      if (i < maxRetries - 1) {
        sleep(delayMs * (i + 1)); // 指数バックオフ
      }
    }
  }

  throw lastError;
}

/**
 * JSONをパース（エラーハンドリング付き）
 */
function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`JSON parse error: ${e.message}`);
    console.error(`Response: ${text.substring(0, 500)}`);
    return null;
  }
}

/**
 * Google Drive フォルダへのリンクを生成
 */
function getFolderLink(folderId) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/**
 * ハイパーリンク式を生成
 */
function getHyperlinkFormula(url, text) {
  return `=HYPERLINK("${url}", "${text}")`;
}
