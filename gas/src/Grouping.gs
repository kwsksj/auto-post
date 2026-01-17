/**
 * Instagram/X 自動投稿システム - グルーピング処理
 *
 * Google Takeout でエクスポートした写真をEXIF撮影日時でグルーピングし、
 * Google Drive にフォルダ構造を作成する
 */

/**
 * グルーピング処理のメイン関数
 * @param {string} sourceFolderId - Takeoutファイルを配置したフォルダID
 * @param {string} destFolderId - 出力先フォルダID（Instagram投稿用）
 */
function runGrouping(sourceFolderId, destFolderId) {
  console.log('グルーピング処理を開始...');

  const sourceFolder = DriveApp.getFolderById(sourceFolderId);
  const destFolder = DriveApp.getFolderById(destFolderId);

  // 閾値を設定シートから取得（デフォルト: 10分）
  const thresholdMinutes = getSettingValue('GROUPING_THRESHOLD_MINUTES') || DEFAULT_GROUPING_THRESHOLD_MINUTES;
  console.log(`グルーピング閾値: ${thresholdMinutes}分`);

  // 写真とメタデータを収集
  const photos = collectPhotosWithMetadata(sourceFolder);
  console.log(`${photos.length}枚の写真を検出`);

  if (photos.length === 0) {
    console.log('処理対象の写真がありません');
    return;
  }

  // 撮影日時でソート
  photos.sort((a, b) => a.takenTime - b.takenTime);

  // グルーピング
  const groups = groupPhotosByTime(photos, thresholdMinutes);
  console.log(`${groups.length}個のグループに分割`);

  // フォルダ作成と写真配置
  createGroupFolders(groups, destFolder);

  console.log('グルーピング処理が完了しました');
}

/**
 * ソースフォルダから写真とメタデータを収集
 */
function collectPhotosWithMetadata(folder) {
  const photos = [];
  const files = folder.getFiles();
  const jsonMetadata = loadTakeoutMetadata(folder);

  while (files.hasNext()) {
    const file = files.next();
    const mimeType = file.getMimeType();

    // 画像ファイルのみ処理
    if (!mimeType.startsWith('image/')) {
      continue;
    }

    const fileName = file.getName();
    let takenTime = null;

    // Takeout JSONから撮影日時を取得
    if (jsonMetadata[fileName]) {
      takenTime = jsonMetadata[fileName].photoTakenTime;
    }

    // JSONがない場合はファイルの作成日時をフォールバック
    if (!takenTime) {
      takenTime = file.getDateCreated();
      console.log(`JSONメタデータなし、作成日時を使用: ${fileName}`);
    }

    photos.push({
      file: file,
      fileName: fileName,
      takenTime: takenTime
    });
  }

  // サブフォルダも再帰的に処理
  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) {
    const subFolder = subFolders.next();
    const subPhotos = collectPhotosWithMetadata(subFolder);
    photos.push(...subPhotos);
  }

  return photos;
}

/**
 * TakeoutのJSONメタデータを読み込み
 */
function loadTakeoutMetadata(folder) {
  const metadata = {};
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();

    // .jsonファイルを処理
    if (fileName.endsWith('.json')) {
      try {
        const content = file.getBlob().getDataAsString();
        const json = JSON.parse(content);

        // Takeout形式: ファイル名.jpg.json → ファイル名.jpg のメタデータ
        // title フィールドに元のファイル名が入っている
        if (json.title) {
          const photoTakenTime = parsePhotoTakenTime(json);
          if (photoTakenTime) {
            metadata[json.title] = {
              photoTakenTime: photoTakenTime
            };
          }
        }
      } catch (e) {
        console.warn(`JSONパースエラー: ${fileName} - ${e.message}`);
      }
    }
  }

  // サブフォルダも処理
  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) {
    const subFolder = subFolders.next();
    const subMetadata = loadTakeoutMetadata(subFolder);
    Object.assign(metadata, subMetadata);
  }

  return metadata;
}

/**
 * Takeout JSONから撮影日時をパース
 */
function parsePhotoTakenTime(json) {
  // photoTakenTime フィールド
  if (json.photoTakenTime && json.photoTakenTime.timestamp) {
    return new Date(parseInt(json.photoTakenTime.timestamp) * 1000);
  }

  // creationTime フォールバック
  if (json.creationTime && json.creationTime.timestamp) {
    return new Date(parseInt(json.creationTime.timestamp) * 1000);
  }

  return null;
}

/**
 * 撮影日時でグルーピング
 */
function groupPhotosByTime(photos, thresholdMinutes) {
  const groups = [];
  let currentGroup = [];
  let lastTime = null;

  const thresholdMs = thresholdMinutes * 60 * 1000;

  for (const photo of photos) {
    if (lastTime === null) {
      // 最初の写真
      currentGroup.push(photo);
    } else {
      const timeDiff = photo.takenTime - lastTime;

      if (timeDiff > thresholdMs) {
        // 閾値を超えた → 新しいグループ
        groups.push(currentGroup);
        currentGroup = [photo];
      } else {
        // 同じグループ
        currentGroup.push(photo);
      }
    }

    lastTime = photo.takenTime;
  }

  // 最後のグループを追加
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * グループごとにフォルダを作成し写真を配置
 */
function createGroupFolders(groups, destFolder) {
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const folderName = String(i + 1).padStart(3, '0'); // 001, 002, ...

    console.log(`フォルダ作成: ${folderName} (${group.length}枚)`);

    // フォルダ作成
    const groupFolder = destFolder.createFolder(folderName);

    // 写真をコピー（移動ではなくコピー。元データは保持）
    for (let j = 0; j < group.length; j++) {
      const photo = group[j];

      // ファイル名にプレフィックスを付けて順序を明示
      const newName = `${String(j + 1).padStart(2, '0')}_${photo.fileName}`;

      photo.file.makeCopy(newName, groupFolder);
    }
  }
}

/**
 * UI: グルーピング実行ダイアログ
 */
function showGroupingDialog() {
  const ui = SpreadsheetApp.getUi();

  const sourceResult = ui.prompt(
    'グルーピング設定',
    'Takeoutファイルを配置したフォルダのIDを入力してください:',
    ui.ButtonSet.OK_CANCEL
  );

  if (sourceResult.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const destResult = ui.prompt(
    'グルーピング設定',
    '出力先フォルダ（Instagram投稿用）のIDを入力してください:',
    ui.ButtonSet.OK_CANCEL
  );

  if (destResult.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const sourceFolderId = sourceResult.getResponseText().trim();
  const destFolderId = destResult.getResponseText().trim();

  if (!sourceFolderId || !destFolderId) {
    ui.alert('エラー', 'フォルダIDを入力してください', ui.ButtonSet.OK);
    return;
  }

  ui.alert('処理開始', 'グルーピング処理を開始します。完了までお待ちください...', ui.ButtonSet.OK);

  try {
    runGrouping(sourceFolderId, destFolderId);
    ui.alert('完了', 'グルーピング処理が完了しました', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', `処理中にエラーが発生しました: ${e.message}`, ui.ButtonSet.OK);
    console.error(e);
  }
}
