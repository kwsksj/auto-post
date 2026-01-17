/**
 * Instagram/X 自動投稿システム - Instagram Graph API 連携
 */

const IG_API_BASE = 'https://graph.facebook.com/v18.0';

/**
 * Instagramにカルーセル投稿
 * @param {string} folderId - Google DriveのフォルダID
 * @param {string} caption - キャプション（タグ含む）
 * @returns {string} 投稿ID
 */
function postToInstagram(folderId, caption) {
  const creds = getInstagramCredentials();

  if (!creds.accessToken || !creds.businessAccountId) {
    throw new Error('Instagram認証情報が設定されていません');
  }

  // フォルダから画像を取得
  const folder = DriveApp.getFolderById(folderId);
  const images = getImagesFromFolder(folder);

  if (images.length === 0) {
    throw new Error('フォルダに画像がありません');
  }

  console.log(`Instagram投稿開始: ${images.length}枚の画像`);

  // 画像をR2にアップロードして署名付きURLを取得
  const imageUrls = [];
  const r2Keys = [];

  for (const image of images) {
    const blob = image.file.getBlob();
    const signedUrl = uploadToR2AndGetSignedUrl(blob, image.name);
    imageUrls.push(signedUrl);
    // R2のキーを保存（後で削除用）
    const match = signedUrl.match(/temp\/[^?]+/);
    if (match) {
      r2Keys.push(match[0]);
    }
  }

  try {
    let postId;

    if (images.length === 1) {
      // 単一画像投稿
      postId = postSingleImage(creds, imageUrls[0], caption);
    } else {
      // カルーセル投稿
      postId = postCarousel(creds, imageUrls, caption);
    }

    console.log(`Instagram投稿完了: ${postId}`);
    return postId;

  } finally {
    // R2から一時ファイルを削除（エラーでも実行）
    for (const key of r2Keys) {
      try {
        deleteFromR2(key);
      } catch (e) {
        console.warn(`R2削除失敗: ${key} - ${e.message}`);
      }
    }
  }
}

/**
 * 単一画像を投稿
 */
function postSingleImage(creds, imageUrl, caption) {
  // メディアコンテナ作成
  const containerId = createMediaContainer(creds, imageUrl, caption);

  // ステータス確認
  waitForMediaReady(creds, containerId);

  // 公開
  return publishMedia(creds, containerId);
}

/**
 * カルーセル投稿
 */
function postCarousel(creds, imageUrls, caption) {
  const childIds = [];

  // 子コンテナを作成
  for (const imageUrl of imageUrls) {
    const childId = createCarouselItem(creds, imageUrl);
    waitForMediaReady(creds, childId);
    childIds.push(childId);
    sleep(1000); // レート制限対策
  }

  // カルーセルコンテナ作成
  const carouselId = createCarouselContainer(creds, childIds, caption);
  waitForMediaReady(creds, carouselId);

  // 公開
  return publishMedia(creds, carouselId);
}

/**
 * メディアコンテナを作成（単一画像）
 */
function createMediaContainer(creds, imageUrl, caption) {
  const url = `${IG_API_BASE}/${creds.businessAccountId}/media`;

  const payload = {
    image_url: imageUrl,
    caption: caption,
    access_token: creds.accessToken
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'POST',
    payload: payload,
    muteHttpExceptions: true
  });

  const result = parseJSON(response.getContentText());

  if (result.error) {
    throw new Error(`メディアコンテナ作成失敗: ${result.error.message}`);
  }

  console.log(`メディアコンテナ作成: ${result.id}`);
  return result.id;
}

/**
 * カルーセルアイテム（子コンテナ）を作成
 */
function createCarouselItem(creds, imageUrl) {
  const url = `${IG_API_BASE}/${creds.businessAccountId}/media`;

  const payload = {
    image_url: imageUrl,
    is_carousel_item: 'true',
    access_token: creds.accessToken
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'POST',
    payload: payload,
    muteHttpExceptions: true
  });

  const result = parseJSON(response.getContentText());

  if (result.error) {
    throw new Error(`カルーセルアイテム作成失敗: ${result.error.message}`);
  }

  console.log(`カルーセルアイテム作成: ${result.id}`);
  return result.id;
}

/**
 * カルーセルコンテナを作成
 */
function createCarouselContainer(creds, childIds, caption) {
  const url = `${IG_API_BASE}/${creds.businessAccountId}/media`;

  const payload = {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: caption,
    access_token: creds.accessToken
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'POST',
    payload: payload,
    muteHttpExceptions: true
  });

  const result = parseJSON(response.getContentText());

  if (result.error) {
    throw new Error(`カルーセルコンテナ作成失敗: ${result.error.message}`);
  }

  console.log(`カルーセルコンテナ作成: ${result.id}`);
  return result.id;
}

/**
 * メディアの処理完了を待機
 */
function waitForMediaReady(creds, containerId, maxWaitSeconds = 60) {
  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;

  while (Date.now() - startTime < maxWaitMs) {
    const status = getMediaStatus(creds, containerId);

    console.log(`メディアステータス: ${containerId} = ${status}`);

    if (status === 'FINISHED') {
      return;
    }

    if (status === 'ERROR') {
      throw new Error(`メディア処理エラー: ${containerId}`);
    }

    // 2秒待機してリトライ
    sleep(2000);
  }

  throw new Error(`メディア処理タイムアウト: ${containerId}`);
}

/**
 * メディアステータスを取得
 */
function getMediaStatus(creds, containerId) {
  const url = `${IG_API_BASE}/${containerId}?fields=status_code&access_token=${creds.accessToken}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'GET',
    muteHttpExceptions: true
  });

  const result = parseJSON(response.getContentText());

  if (result.error) {
    console.warn(`ステータス取得エラー: ${result.error.message}`);
    return 'UNKNOWN';
  }

  return result.status_code || 'IN_PROGRESS';
}

/**
 * メディアを公開
 */
function publishMedia(creds, containerId) {
  const url = `${IG_API_BASE}/${creds.businessAccountId}/media_publish`;

  const payload = {
    creation_id: containerId,
    access_token: creds.accessToken
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'POST',
    payload: payload,
    muteHttpExceptions: true
  });

  const result = parseJSON(response.getContentText());

  if (result.error) {
    throw new Error(`メディア公開失敗: ${result.error.message}`);
  }

  return result.id;
}

/**
 * Instagramアクセストークンを更新
 */
function refreshInstagramToken() {
  const creds = getInstagramCredentials();

  if (!creds.accessToken || !creds.appId || !creds.appSecret) {
    throw new Error('トークン更新に必要な情報が不足しています');
  }

  const url = `${IG_API_BASE}/oauth/access_token?` +
    `grant_type=fb_exchange_token&` +
    `client_id=${creds.appId}&` +
    `client_secret=${creds.appSecret}&` +
    `fb_exchange_token=${creds.accessToken}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'GET',
    muteHttpExceptions: true
  });

  const result = parseJSON(response.getContentText());

  if (result.error) {
    throw new Error(`トークン更新失敗: ${result.error.message}`);
  }

  // 新しいトークンを保存
  setSettingValue('INSTAGRAM_ACCESS_TOKEN', result.access_token);

  // 有効期限を計算して保存（60日後）
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 60);
  setSettingValue('INSTAGRAM_TOKEN_EXPIRY', formatDate(expiry, 'yyyy-MM-dd'));

  console.log(`Instagramトークン更新完了。新しい有効期限: ${formatDate(expiry, 'yyyy-MM-dd')}`);

  return result.access_token;
}

/**
 * トークンの有効期限をチェックし、必要なら更新
 */
function checkAndRefreshInstagramToken() {
  const creds = getInstagramCredentials();

  if (!creds.tokenExpiry) {
    console.log('トークン有効期限が設定されていません');
    return;
  }

  const expiry = new Date(creds.tokenExpiry);
  const daysUntilExpiry = Math.floor((expiry - now()) / (1000 * 60 * 60 * 24));

  console.log(`Instagramトークン有効期限まで: ${daysUntilExpiry}日`);

  if (daysUntilExpiry <= 15) {
    console.log('トークンを自動更新します...');
    try {
      refreshInstagramToken();
      sendErrorNotification(
        'Instagramトークン更新完了',
        `トークンを自動更新しました。新しい有効期限は60日後です。`
      );
    } catch (e) {
      console.error(`トークン更新失敗: ${e.message}`);
      sendErrorNotification(
        'Instagramトークン更新失敗（緊急）',
        `トークンの自動更新に失敗しました。\n\n` +
        `エラー: ${e.message}\n\n` +
        `手動でトークンを更新してください。残り${daysUntilExpiry}日で失効します。`
      );
    }
  }
}
