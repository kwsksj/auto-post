/**
 * Instagram/X 自動投稿システム - スプレッドシート管理
 */

/**
 * 初期セットアップ: スプレッドシートの構造を作成
 */
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // メインシートの作成/取得
  let mainSheet = ss.getSheetByName(SHEET_NAMES.MAIN);
  if (!mainSheet) {
    mainSheet = ss.insertSheet(SHEET_NAMES.MAIN);
  }

  // 設定シートの作成/取得
  let settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet(SHEET_NAMES.SETTINGS);
  }

  // メインシートのヘッダー設定
  setupMainSheetHeaders(mainSheet);

  // 設定シートの初期値設定
  setupSettingsSheet(settingsSheet);

  console.log('スプレッドシートのセットアップが完了しました');
}

/**
 * メインシートのヘッダーを設定
 */
function setupMainSheetHeaders(sheet) {
  const headers = [
    'folder_id',
    'folder_name',
    'folder_link',
    'image_count',
    'first_photo_date',
    'work_name',
    'scheduled_date',
    'skip',
    'caption',
    'tags',
    'instagram_posted',
    'instagram_post_id',
    'x_posted',
    'x_post_id',
    'error_log'
  ];

  // 既存データがあるか確認
  const existingData = sheet.getDataRange().getValues();
  if (existingData.length > 0 && existingData[0][0] === 'folder_id') {
    console.log('ヘッダーは既に設定されています');
    return;
  }

  // ヘッダー行を設定
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // ヘッダー行のスタイル設定
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4a86e8');
  headerRange.setFontColor('#ffffff');

  // 列幅の調整
  sheet.setColumnWidth(1, 120);  // folder_id
  sheet.setColumnWidth(2, 80);   // folder_name
  sheet.setColumnWidth(3, 100);  // folder_link
  sheet.setColumnWidth(4, 80);   // image_count
  sheet.setColumnWidth(5, 130);  // first_photo_date
  sheet.setColumnWidth(6, 150);  // work_name
  sheet.setColumnWidth(7, 100);  // scheduled_date
  sheet.setColumnWidth(8, 60);   // skip
  sheet.setColumnWidth(9, 200);  // caption
  sheet.setColumnWidth(10, 300); // tags
  sheet.setColumnWidth(11, 100); // instagram_posted
  sheet.setColumnWidth(12, 150); // instagram_post_id
  sheet.setColumnWidth(13, 80);  // x_posted
  sheet.setColumnWidth(14, 150); // x_post_id
  sheet.setColumnWidth(15, 300); // error_log

  // 1行目を固定
  sheet.setFrozenRows(1);
}

/**
 * 設定シートの初期値を設定
 */
function setupSettingsSheet(sheet) {
  const settings = [
    ['設定項目', '値'],
    ['GROUPING_THRESHOLD_MINUTES', '10'],
    ['DEFAULT_TAGS', DEFAULT_TAGS],
    ['INSTAGRAM_APP_ID', ''],
    ['INSTAGRAM_APP_SECRET', ''],
    ['INSTAGRAM_ACCESS_TOKEN', ''],
    ['INSTAGRAM_BUSINESS_ACCOUNT_ID', '17841422021372550'],
    ['INSTAGRAM_TOKEN_EXPIRY', ''],
    ['X_API_KEY', ''],
    ['X_API_KEY_SECRET', ''],
    ['X_ACCESS_TOKEN', ''],
    ['X_ACCESS_TOKEN_SECRET', ''],
    ['R2_ACCOUNT_ID', ''],
    ['R2_ACCESS_KEY_ID', ''],
    ['R2_SECRET_ACCESS_KEY', ''],
    ['R2_BUCKET_NAME', 'instagram-temp'],
    ['NOTIFICATION_EMAIL', ''],
    ['NOTIFICATION_ENABLED', 'TRUE'],
    ['POST_TIME', '12:00']
  ];

  // 既存データがあるか確認
  const existingData = sheet.getDataRange().getValues();
  if (existingData.length > 1) {
    console.log('設定シートは既にデータがあります');
    return;
  }

  sheet.getRange(1, 1, settings.length, 2).setValues(settings);

  // ヘッダー行のスタイル
  const headerRange = sheet.getRange(1, 1, 1, 2);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4a86e8');
  headerRange.setFontColor('#ffffff');

  // 列幅の調整
  sheet.setColumnWidth(1, 250);
  sheet.setColumnWidth(2, 400);
}

/**
 * Google Driveのフォルダ構造をスキャンしてスプレッドシートに反映
 * @param {string} rootFolderId - Instagram投稿用フォルダのID
 */
function scanFoldersToSpreadsheet(rootFolderId) {
  console.log('フォルダスキャンを開始...');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName(SHEET_NAMES.MAIN);

  if (!mainSheet) {
    throw new Error('メインシートが見つかりません。setupSpreadsheet()を先に実行してください。');
  }

  const rootFolder = DriveApp.getFolderById(rootFolderId);
  const subFolders = rootFolder.getFolders();

  // 既存のフォルダIDを取得（重複チェック用）
  const existingData = mainSheet.getDataRange().getValues();
  const existingFolderIds = new Set();
  const existingRows = {};

  for (let i = 1; i < existingData.length; i++) {
    const folderId = existingData[i][COLUMNS.FOLDER_ID];
    if (folderId) {
      existingFolderIds.add(folderId);
      existingRows[folderId] = i + 1; // 1-indexed row number
    }
  }

  // 新規フォルダを処理
  const newRows = [];

  while (subFolders.hasNext()) {
    const folder = subFolders.next();
    const folderId = folder.getId();
    const folderName = folder.getName();

    // 画像を取得
    const images = getImagesFromFolder(folder);

    if (images.length === 0) {
      console.log(`スキップ: ${folderName} (画像なし)`);
      continue;
    }

    // 既存フォルダの場合は画像枚数を更新
    if (existingFolderIds.has(folderId)) {
      const rowNum = existingRows[folderId];
      mainSheet.getRange(rowNum, COLUMNS.IMAGE_COUNT + 1).setValue(images.length);
      console.log(`更新: ${folderName} (${images.length}枚)`);
      continue;
    }

    // 新規フォルダの場合は行データを作成
    const firstPhotoDate = images[0].created;
    const folderLink = getHyperlinkFormula(getFolderLink(folderId), folderName);

    // 11枚以上の場合は分割
    if (images.length > INSTAGRAM_MAX_CAROUSEL) {
      const chunks = chunkArray(images, INSTAGRAM_MAX_CAROUSEL);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const suffix = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';

        newRows.push(createRowData(
          folderId,
          folderName + suffix,
          folderLink,
          chunk.length,
          firstPhotoDate,
          '', // work_name
          null, // scheduled_date
          '', // skip
          '', // caption
          DEFAULT_TAGS, // tags
          false, false, '', false, false, '', '' // posted flags
        ));
      }

      console.log(`追加: ${folderName} (${images.length}枚 → ${chunks.length}分割)`);
    } else {
      newRows.push(createRowData(
        folderId,
        folderName,
        folderLink,
        images.length,
        firstPhotoDate,
        '', // work_name
        null, // scheduled_date
        '', // skip
        '', // caption
        DEFAULT_TAGS, // tags
        false, false, '', false, false, '', '' // posted flags
      ));

      console.log(`追加: ${folderName} (${images.length}枚)`);
    }
  }

  // 新規行を追加
  if (newRows.length > 0) {
    const lastRow = mainSheet.getLastRow();
    mainSheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    console.log(`${newRows.length}件の新規フォルダを追加しました`);
  } else {
    console.log('新規フォルダはありませんでした');
  }

  console.log('フォルダスキャンが完了しました');
}

/**
 * 行データを作成
 */
function createRowData(folderId, folderName, folderLink, imageCount, firstPhotoDate,
                       workName, scheduledDate, skip, caption, tags,
                       igPosted, igPostId, xPosted, xPostId, errorLog) {
  return [
    folderId,
    folderName,
    folderLink,
    imageCount,
    firstPhotoDate,
    workName,
    scheduledDate,
    skip,
    caption,
    tags,
    igPosted,
    igPostId,
    xPosted,
    xPostId,
    errorLog
  ];
}

/**
 * 投稿スケジュールを自動設定
 * @param {Date} startDate - 開始日
 * @param {boolean} includeWeekends - 土日も含める（デフォルト: true）
 */
function setSchedule(startDate, includeWeekends = true) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName(SHEET_NAMES.MAIN);

  const data = mainSheet.getDataRange().getValues();
  let currentDate = new Date(startDate);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // 既に投稿済み or スキップの場合はパス
    if (row[COLUMNS.IG_POSTED] === true || row[COLUMNS.SKIP] === true) {
      continue;
    }

    // 既にスケジュール設定済みの場合はパス
    if (row[COLUMNS.SCHEDULED_DATE]) {
      continue;
    }

    // 土日スキップ
    if (!includeWeekends) {
      while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    // スケジュール設定
    mainSheet.getRange(i + 1, COLUMNS.SCHEDULED_DATE + 1).setValue(new Date(currentDate));

    // 次の日へ
    currentDate.setDate(currentDate.getDate() + 1);
  }

  console.log('スケジュール設定が完了しました');
}

/**
 * UI: フォルダスキャンダイアログ
 */
function showScanDialog() {
  const ui = SpreadsheetApp.getUi();

  const result = ui.prompt(
    'フォルダスキャン',
    'Instagram投稿用フォルダのIDを入力してください:',
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const folderId = result.getResponseText().trim();
  if (!folderId) {
    ui.alert('エラー', 'フォルダIDを入力してください', ui.ButtonSet.OK);
    return;
  }

  try {
    scanFoldersToSpreadsheet(folderId);
    ui.alert('完了', 'フォルダスキャンが完了しました', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', `処理中にエラーが発生しました: ${e.message}`, ui.ButtonSet.OK);
    console.error(e);
  }
}

/**
 * UI: スケジュール設定ダイアログ
 */
function showScheduleDialog() {
  const ui = SpreadsheetApp.getUi();

  const result = ui.prompt(
    'スケジュール設定',
    '開始日を入力してください (例: 2025-01-20):',
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const dateStr = result.getResponseText().trim();
  const startDate = new Date(dateStr);

  if (isNaN(startDate.getTime())) {
    ui.alert('エラー', '日付の形式が正しくありません', ui.ButtonSet.OK);
    return;
  }

  const weekendResult = ui.alert(
    '土日も投稿しますか？',
    '「はい」: 毎日投稿\n「いいえ」: 平日のみ投稿',
    ui.ButtonSet.YES_NO
  );

  const includeWeekends = weekendResult === ui.Button.YES;

  try {
    setSchedule(startDate, includeWeekends);
    ui.alert('完了', 'スケジュール設定が完了しました', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', `処理中にエラーが発生しました: ${e.message}`, ui.ButtonSet.OK);
    console.error(e);
  }
}
