/**
 * Instagram/X 自動投稿システム - メイン処理
 */

/**
 * スプレッドシートを開いたときにカスタムメニューを追加
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('自動投稿システム')
    .addItem('初期セットアップ', 'setupSpreadsheet')
    .addSeparator()
    .addSubMenu(
      ui.createMenu('Phase 1: 初期処理')
        .addItem('グルーピング実行', 'showGroupingDialog')
        .addItem('フォルダスキャン', 'showScanDialog')
        .addItem('スケジュール設定', 'showScheduleDialog')
    )
    .addSubMenu(
      ui.createMenu('Phase 2: 投稿')
        .addItem('本日の投稿を実行', 'runDailyPost')
        .addItem('テスト投稿（選択行）', 'testPostSelectedRow')
    )
    .addSubMenu(
      ui.createMenu('Phase 3: 運用')
        .addItem('新規フォルダをスキャン', 'scanNewFolders')
    )
    .addSeparator()
    .addSubMenu(
      ui.createMenu('メンテナンス')
        .addItem('Instagramトークン確認・更新', 'checkAndRefreshInstagramToken')
        .addItem('定期実行トリガーを設定', 'setupDailyTrigger')
        .addItem('トリガーを削除', 'removeTriggers')
    )
    .addToUi();
}

/**
 * 毎日の投稿処理（トリガーから呼び出される）
 */
function runDailyPost() {
  console.log('=== 日次投稿処理開始 ===');

  // Instagramトークンの有効期限チェック
  try {
    checkAndRefreshInstagramToken();
  } catch (e) {
    console.error(`トークンチェックエラー: ${e.message}`);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName(SHEET_NAMES.MAIN);

  if (!mainSheet) {
    console.error('メインシートが見つかりません');
    return;
  }

  const data = mainSheet.getDataRange().getValues();
  const todayStr = formatDate(today(), 'yyyy-MM-dd');

  let processedCount = 0;
  let errorCount = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 1;

    // 投稿対象かチェック
    if (!isPostTarget(row, todayStr)) {
      continue;
    }

    const folderId = row[COLUMNS.FOLDER_ID];
    const folderName = row[COLUMNS.FOLDER_NAME];
    const workName = row[COLUMNS.WORK_NAME];
    const customCaption = row[COLUMNS.CAPTION];
    const tags = row[COLUMNS.TAGS];

    console.log(`処理中: ${folderName} (row ${rowNum})`);

    // キャプション生成
    const caption = generateCaption(workName, customCaption, tags);

    // Instagram投稿
    if (row[COLUMNS.IG_POSTED] !== true) {
      try {
        const igPostId = postToInstagram(folderId, caption);
        mainSheet.getRange(rowNum, COLUMNS.IG_POSTED + 1).setValue(true);
        mainSheet.getRange(rowNum, COLUMNS.IG_POST_ID + 1).setValue(igPostId);
        console.log(`Instagram投稿成功: ${igPostId}`);
      } catch (e) {
        console.error(`Instagram投稿失敗: ${e.message}`);
        logError(mainSheet, rowNum, 'Instagram', e.message);
        errorCount++;
      }
    }

    // X投稿
    if (row[COLUMNS.X_POSTED] !== true) {
      try {
        const xPostId = postToX(folderId, caption);
        mainSheet.getRange(rowNum, COLUMNS.X_POSTED + 1).setValue(true);
        mainSheet.getRange(rowNum, COLUMNS.X_POST_ID + 1).setValue(xPostId);
        console.log(`X投稿成功: ${xPostId}`);
      } catch (e) {
        console.error(`X投稿失敗: ${e.message}`);
        logError(mainSheet, rowNum, 'X', e.message);
        errorCount++;
      }
    }

    processedCount++;

    // レート制限対策で少し待機
    sleep(2000);
  }

  console.log(`=== 日次投稿処理完了: ${processedCount}件処理、${errorCount}件エラー ===`);

  // エラーがあれば通知
  if (errorCount > 0) {
    sendErrorNotification(
      `投稿処理でエラーが発生しました (${errorCount}件)`,
      `${processedCount}件の投稿処理中に${errorCount}件のエラーが発生しました。\n` +
      `詳細はスプレッドシートのerror_log列を確認してください。`
    );
  }
}

/**
 * 投稿対象かどうかを判定
 */
function isPostTarget(row, todayStr) {
  // スケジュール日が今日か確認
  const scheduledDate = row[COLUMNS.SCHEDULED_DATE];
  if (!scheduledDate) {
    return false;
  }

  const scheduledStr = formatDate(new Date(scheduledDate), 'yyyy-MM-dd');
  if (scheduledStr !== todayStr) {
    return false;
  }

  // スキップフラグ確認
  if (row[COLUMNS.SKIP] === true || row[COLUMNS.SKIP] === 'TRUE') {
    return false;
  }

  // 両方とも投稿済みならスキップ
  if (row[COLUMNS.IG_POSTED] === true && row[COLUMNS.X_POSTED] === true) {
    return false;
  }

  return true;
}

/**
 * 選択行でテスト投稿
 */
function testPostSelectedRow() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName(SHEET_NAMES.MAIN);

  const selection = mainSheet.getActiveRange();
  const rowNum = selection.getRow();

  if (rowNum <= 1) {
    ui.alert('エラー', 'データ行を選択してください（ヘッダー行は不可）', ui.ButtonSet.OK);
    return;
  }

  const row = mainSheet.getRange(rowNum, 1, 1, 15).getValues()[0];
  const folderId = row[COLUMNS.FOLDER_ID];
  const folderName = row[COLUMNS.FOLDER_NAME];
  const workName = row[COLUMNS.WORK_NAME];
  const customCaption = row[COLUMNS.CAPTION];
  const tags = row[COLUMNS.TAGS];

  const confirm = ui.alert(
    'テスト投稿',
    `以下の作品をテスト投稿します:\n\n` +
    `フォルダ: ${folderName}\n` +
    `作品名: ${workName || '(未設定)'}\n\n` +
    `続行しますか？`,
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) {
    return;
  }

  const caption = generateCaption(workName, customCaption, tags);

  // 投稿先選択
  const targetResult = ui.alert(
    '投稿先',
    'どこに投稿しますか？',
    ui.ButtonSet.YES_NO_CANCEL
  );

  try {
    if (targetResult === ui.Button.YES) {
      // Instagram
      const igPostId = postToInstagram(folderId, caption);
      mainSheet.getRange(rowNum, COLUMNS.IG_POSTED + 1).setValue(true);
      mainSheet.getRange(rowNum, COLUMNS.IG_POST_ID + 1).setValue(igPostId);
      ui.alert('成功', `Instagram投稿完了: ${igPostId}`, ui.ButtonSet.OK);
    } else if (targetResult === ui.Button.NO) {
      // X
      const xPostId = postToX(folderId, caption);
      mainSheet.getRange(rowNum, COLUMNS.X_POSTED + 1).setValue(true);
      mainSheet.getRange(rowNum, COLUMNS.X_POST_ID + 1).setValue(xPostId);
      ui.alert('成功', `X投稿完了: ${xPostId}`, ui.ButtonSet.OK);
    } else {
      // 両方
      const igPostId = postToInstagram(folderId, caption);
      mainSheet.getRange(rowNum, COLUMNS.IG_POSTED + 1).setValue(true);
      mainSheet.getRange(rowNum, COLUMNS.IG_POST_ID + 1).setValue(igPostId);

      sleep(2000);

      const xPostId = postToX(folderId, caption);
      mainSheet.getRange(rowNum, COLUMNS.X_POSTED + 1).setValue(true);
      mainSheet.getRange(rowNum, COLUMNS.X_POST_ID + 1).setValue(xPostId);

      ui.alert('成功', `投稿完了\nInstagram: ${igPostId}\nX: ${xPostId}`, ui.ButtonSet.OK);
    }
  } catch (e) {
    logError(mainSheet, rowNum, 'テスト投稿', e.message);
    ui.alert('エラー', `投稿に失敗しました: ${e.message}`, ui.ButtonSet.OK);
  }
}

/**
 * 毎日の定期実行トリガーを設定
 */
function setupDailyTrigger() {
  // 既存のトリガーを削除
  removeTriggers();

  // 投稿時刻を取得
  const postTime = getSettingValue('POST_TIME') || '12:00';
  const [hours, minutes] = postTime.split(':').map(Number);

  // トリガーを作成
  ScriptApp.newTrigger('runDailyPost')
    .timeBased()
    .atHour(hours)
    .nearMinute(minutes)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();

  console.log(`定期実行トリガーを設定しました: 毎日 ${postTime}`);

  const ui = SpreadsheetApp.getUi();
  ui.alert('完了', `定期実行トリガーを設定しました: 毎日 ${postTime}`, ui.ButtonSet.OK);
}

/**
 * すべてのトリガーを削除
 */
function removeTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'runDailyPost') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  console.log('トリガーを削除しました');
}

/**
 * 新規フォルダをスキャン（Phase 3用）
 */
function scanNewFolders() {
  const rootFolderId = getSettingValue('ROOT_FOLDER_ID');

  if (!rootFolderId) {
    const ui = SpreadsheetApp.getUi();
    ui.alert('エラー', '設定シートにROOT_FOLDER_IDが設定されていません', ui.ButtonSet.OK);
    return;
  }

  scanFoldersToSpreadsheet(rootFolderId);

  // 新規行にスケジュールを自動設定
  autoScheduleNewRows();
}

/**
 * 新規行に自動でスケジュールを設定
 */
function autoScheduleNewRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName(SHEET_NAMES.MAIN);
  const data = mainSheet.getDataRange().getValues();

  // 最後にスケジュールされた日付を探す
  let lastScheduledDate = null;

  for (let i = 1; i < data.length; i++) {
    const scheduledDate = data[i][COLUMNS.SCHEDULED_DATE];
    if (scheduledDate) {
      const date = new Date(scheduledDate);
      if (!lastScheduledDate || date > lastScheduledDate) {
        lastScheduledDate = date;
      }
    }
  }

  // 最後の日付がない場合は明日から
  if (!lastScheduledDate) {
    lastScheduledDate = today();
  }

  // スケジュール未設定の行に日付を設定
  let currentDate = new Date(lastScheduledDate);
  currentDate.setDate(currentDate.getDate() + 1);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // 既にスケジュール設定済み or 投稿済み or スキップ
    if (row[COLUMNS.SCHEDULED_DATE] ||
        row[COLUMNS.IG_POSTED] === true ||
        row[COLUMNS.SKIP] === true) {
      continue;
    }

    mainSheet.getRange(i + 1, COLUMNS.SCHEDULED_DATE + 1).setValue(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  console.log('新規行のスケジュール設定が完了しました');
}
