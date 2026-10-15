// =====================================================================
// 06_attachments.js ― 添付ファイル
// ---------------------------------------------------------------------
// ファイル選択・ドラッグ＆ドロップ、画像の送信前圧縮、PDF等のチャンク分割アップロード、
// アップロード中のリロード警告。rowNumberが確定した後（保存後）に呼び出される。
// 読み込み順：index.html の <script> タグの順（01 → 07）。通常の<script>のため、
// 各ファイルで宣言した変数・関数は、他のファイルからそのまま参照できる。
// =====================================================================

window.handleDragOver = function(e) { e.preventDefault(); e.currentTarget.classList.add('dragover'); };

window.handleDragLeave = function(e) { e.preventDefault(); e.currentTarget.classList.remove('dragover'); };

window.handleFileDrop = function(e, key) {
  e.preventDefault(); e.currentTarget.classList.remove('dragover');
  addSelectedFiles(Array.from(e.dataTransfer.files), key);
};

window.handleFileSelect = function(e, key) { addSelectedFiles(Array.from(e.target.files), key); };

function addSelectedFiles(files, key) {
  if (!selectedFilesMap[key]) selectedFilesMap[key] = [];

  files.forEach(file => {
    selectedFilesMap[key].push({
      file: file,
      fileType: null
    });
  });

  renderFileList(key);
}

function getFileTypeNum(fileName) {
  for (const [id, def] of Object.entries(FILE_TYPES_DEF)) {
    if (def.keywords.some(keyword => fileName.includes(keyword))) {
      return id;
    }
  }
  return "09";
}

function renderFileList(key) {
  const targetId = (key === 'NEW_PROJECT')
    ? 'createFileList'
    : `fileList_${key}`;

  const div = document.getElementById(targetId);
  if (!div) return;

  div.innerHTML = '';

  (selectedFilesMap[key] || []).forEach((obj, idx) => {

    // 初回だけ自動判定
    if (!obj.fileType) {
      obj.fileType = getFileTypeNum(obj.file.name);
    }

    const wrapper = document.createElement("div");
    wrapper.className = "file-item";
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.alignItems = "stretch";
    wrapper.style.gap = "6px";
    wrapper.style.padding = "8px 0";

    // プルダウン
    const select = document.createElement("select");
    select.style.width = "180px";

    Object.entries(FILE_TYPES_DEF).forEach(([id, def]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = def.name;
      option.selected = (id === obj.fileType);
      select.appendChild(option);
    });

    select.onchange = () => {
      obj.fileType = select.value;
    };

    // 下段
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "10px";

    const fileName = document.createElement("span");
    fileName.style.flex = "1";
    fileName.style.fontWeight = "bold";
    fileName.style.textAlign = "left";
    fileName.textContent = `📄 ${obj.file.name}`;

    const del = document.createElement("span");
    del.className = "material-symbols-outlined";
    del.style.cursor = "pointer";
    del.style.color = "#ef4444";
    del.textContent = "delete";

    del.onclick = () => removeSelectedFile(key, idx);

    row.appendChild(fileName);
    row.appendChild(del);

    wrapper.appendChild(select);
    wrapper.appendChild(row);

    div.appendChild(wrapper);
  });
}

window.removeSelectedFile = function(key, idx) {
  if (selectedFilesMap[key]) { selectedFilesMap[key].splice(idx, 1); renderFileList(key); }
};

// =================================================================
// 添付ファイルの送信前圧縮処理（413エラー対策）
// -----------------------------------------------------------------------
// スマホのカメラ写真はそのままだと数MB〜十数MBになることがあり、Base64化すると
// さらに約1.33倍に膨らむため、サーバー（Vercel中継）側のリクエストサイズ上限を
// 超えて413エラーになることがある。
// 対策として、画像ファイル（image/*）のみ送信前にキャンバスで縮小・JPEG再圧縮して
// サイズを抑える。PDF等の画像以外のファイルはキャンバスで扱えないため対象外とし、
// 従来通りそのまま送信する。
// =================================================================
const MAX_IMAGE_DIMENSION = 1600; // 長辺の最大ピクセル数（これより大きい画像のみ縮小）

const IMAGE_JPEG_QUALITY = 0.75;  // 再圧縮時のJPEG品質（初回）

const TARGET_MAX_BYTES = 1.2 * 1024 * 1024; // 圧縮後の目標上限（約1.2MB）。これを超える場合はさらに画質を下げる

const MIN_JPEG_QUALITY = 0.35; // これ以上は画質を下げない下限

// 指定した画質でキャンバスに描画してJPEG Blobを作る（1回分の処理）
function drawToJpegBlob(img, width, height, quality) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error("画像の圧縮に失敗しました")); return; }
      resolve(blob);
    }, 'image/jpeg', quality);
  });
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = async () => {
      URL.revokeObjectURL(objectUrl);
      try {
        let { width, height } = img;
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          if (width >= height) {
            height = Math.round(height * (MAX_IMAGE_DIMENSION / width));
            width = MAX_IMAGE_DIMENSION;
          } else {
            width = Math.round(width * (MAX_IMAGE_DIMENSION / height));
            height = MAX_IMAGE_DIMENSION;
          }
        }

        // 1回目は通常品質で圧縮し、それでもまだ目標サイズを超えていれば、
        // 画質を段階的に下げながら再圧縮する（安全装置：どんなに大きい元画像でも
        // 最終的には一定サイズ以下に収まるようにする）。
        let quality = IMAGE_JPEG_QUALITY;
        let blob = await drawToJpegBlob(img, width, height, quality);
        while (blob.size > TARGET_MAX_BYTES && quality > MIN_JPEG_QUALITY) {
          quality = Math.max(MIN_JPEG_QUALITY, quality - 0.15);
          blob = await drawToJpegBlob(img, width, height, quality);
        }
        resolve(blob);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = (err) => { URL.revokeObjectURL(objectUrl); reject(err); };
    img.src = objectUrl;
  });
}

// ファイルが画像かどうかを判定する。
// file.type（MIMEタイプ）はスマートフォンの機種・ブラウザによっては空文字や
// 想定外の値になることがあるため、MIMEタイプが取得できない場合は拡張子でも判定する
// （413エラー対策：この判定に漏れると圧縮されずに元の大きいファイルが送信されてしまうため）。
function isImageFile(file) {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type) return false; // 画像以外と明確に分かっている場合（application/pdf等）は対象外
  const name = (file.name || '').toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.bmp'].some(ext => name.endsWith(ext));
}

// =================================================================
// 📦 チャンク分割アップロード方式によるファイルアップロード（413エラー根本対策）
// -----------------------------------------------------------------------
// 【方針転換の経緯】
// 当初はPDF.js/jsPDFによる圧縮方式（文字情報が失われる副作用あり）→
// Google Drive APIへの直接アップロード（CORS/404エラーで実機動作せず）と
// 試したが、いずれも問題があり不採用とした。
// 「GASを直接呼び出す構成には戻さない」という既存方針を踏まえ、
// Vercelを経由する構成を維持しつつ、ファイルを約1.2MBずつのチャンクに分割して
// 複数回のリクエストに分けて送信する方式を採用する（413エラー対策）。
// 画像以外のファイル（PDF等）が対象。画像（写真）は従来通り、
// 送信前圧縮＋Base64＋uploadboxの方式を維持する。
// =================================================================
const UPLOAD_CHUNK_SIZE = 1.2 * 1024 * 1024; // 1チャンクあたりの元データサイズ（Base64化前）

// FileをArrayBufferとして読み込み、指定サイズごとにBase64文字列の配列へ分割する
function splitFileIntoBase64Chunks(file, chunkSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bytes = new Uint8Array(reader.result);
        const chunks = [];
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          const slice = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
          // バイナリ文字列化してからbtoaでBase64化する（大きい配列でもスタック超過しないよう分割して結合）
          let binary = '';
          const stepSize = 0x8000;
          for (let i = 0; i < slice.length; i += stepSize) {
            binary += String.fromCharCode.apply(null, slice.subarray(i, i + stepSize));
          }
          chunks.push(btoa(binary));
        }
        resolve(chunks.length > 0 ? chunks : ['']); // 0バイトファイルでも最低1チャンクは送る
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

async function uploadFileViaChunkedUpload(rowNumber, fileObj) {
  const file = fileObj.file;
  const mimeType = file.type || 'application/octet-stream';

  // ① アップロードセッションを開始する
  const session = await Api.initChunkedUpload(rowNumber, file.name);
  const uploadId = session && session.uploadId;
  if (!uploadId) {
    throw new Error("アップロードセッションを開始できませんでした。");
  }

  // ② ファイルをチャンクに分割し、1つずつ順番にVercel経由で送信する
  //    （並列に送ると合計の同時通信量が大きくなり得るため、あえて直列で送る）
  const chunks = await splitFileIntoBase64Chunks(file, UPLOAD_CHUNK_SIZE);
  for (let i = 0; i < chunks.length; i++) {
    await Api.uploadChunk(rowNumber, uploadId, i, chunks[i]);
    console.log(`📦 チャンク送信 ${i + 1}/${chunks.length}: ${file.name}`);
  }

  // ③ 全チャンク送信完了を通知し、GAS側で結合・正式保存してもらう
  await Api.finalizeChunkedUpload(rowNumber, uploadId, chunks.length, file.name, fileObj.fileType, mimeType);

  console.log(`📤 チャンク分割アップロード完了: ${file.name} (${(file.size/1024/1024).toFixed(2)}MB, ${chunks.length}チャンク)`);
}

// 画像ファイルを送信前に圧縮し、Base64データを生成する（写真のみが対象）。
// 画像以外のファイル（PDF等）はこの関数を通さず、チャンク分割方式で
// 別途アップロードするため、ここでは画像専用の処理として単純化している。
function fileToBase64(fileObj) {
  return new Promise(async (resolve, reject) => {
    try {
      const originalFile = fileObj.file;
      let sourceBlob = originalFile;
      let outputType = originalFile.type;
      let outputName = originalFile.name;

      try {
        sourceBlob = await compressImageFile(originalFile);
        outputType = 'image/jpeg';
        // 圧縮後はJPEG形式になるため、拡張子もそれに合わせて変更する
        const dotIdx = outputName.lastIndexOf(".");
        const baseName = dotIdx !== -1 ? outputName.substring(0, dotIdx) : outputName;
        outputName = baseName + ".jpg";
        console.log(`📷 画像圧縮: ${originalFile.name} ${(originalFile.size/1024).toFixed(0)}KB → ${(sourceBlob.size/1024).toFixed(0)}KB`);
      } catch (compressErr) {
        console.warn('⚠️ 画像圧縮に失敗したため、元のファイルをそのまま送信します:', compressErr);
        sourceBlob = originalFile;
        outputType = originalFile.type;
        outputName = originalFile.name;
      }

      const reader = new FileReader();
      reader.readAsDataURL(sourceBlob);
      reader.onload = () => {
        const base64Str = reader.result.split(',')[1];
        console.log(`📦 送信データ準備完了: ${outputName} 実サイズ約${(base64Str.length*0.75/1024).toFixed(0)}KB`);
        resolve({
          base64: base64Str,
          name: outputName,
          type: outputType,
          fileType: fileObj.fileType
        });
      };
      reader.onerror = (err) => reject(err);
    } catch (err) {
      reject(err);
    }
  });
}

// =================================================================
// 添付ファイルのアップロード（413エラー対策：種別ごとに経路を振り分けて送信）
// -----------------------------------------------------------------------
// ・画像：送信前に圧縮してBase64化し、GASの「uploadbox」アクションで1枚ずつ送信
// ・画像以外（PDF等）：ファイル本体を一切加工せず、チャンク分割方式で
//   ブラウザから直接Google Driveへ送信（Vercel/GASのリクエストサイズ上限を
//   受けないため、ファイルサイズに関わらず413エラーが起きない）
//
// rowNumberが確定してから（案件の保存が完了してから）呼び出す必要がある。
// =================================================================
// -------------------------------------------------------------
// 【離脱確認】添付ファイルのアップロード中に、誤ってページを
// リロード・タブを閉じてしまうと、その時点までの進捗が失われ、
// 一部のファイルだけが保存されない事故に繋がる（実際に発生した）。
// アップロード中はこのフラグを立て、beforeunloadで警告を出すことで、
// 事故の発生を減らす（完全に防げるわけではない点に注意。ユーザーが
// 確認ダイアログで「離れる」を選べば、結局中断される）。
// -------------------------------------------------------------
let isUploadingAttachedFiles = false;

window.addEventListener("beforeunload", (e) => {
  if (isUploadingAttachedFiles) {
    // 【重要】現在のブラウザ仕様では、カスタムメッセージの表示は
    // できず、ブラウザ標準の確認文言が出るだけになる。
    // preventDefault()とreturnValueの設定が、確認ダイアログを
    // 表示させるための標準的な書き方。
    e.preventDefault();
    e.returnValue = "";
  }
});

async function uploadAllAttachedFiles(rowNumber, files) {
  if (!files || files.length === 0) return;

  const imageFileObjs = files.filter(f => isImageFile(f.file));
  const otherFileObjs = files.filter(f => !isImageFile(f.file));
  const skippedNames = [];
  const totalCount = imageFileObjs.length + otherFileObjs.length;
  let succeededCount = 0;

  isUploadingAttachedFiles = true;
  try {
    // 画像：圧縮してBase64化してから1枚ずつ送信
    for (const fileObj of imageFileObjs) {
      try {
        const base64File = await fileToBase64(fileObj);
        await Api.uploadbox(rowNumber, [base64File]);
        succeededCount++;
      } catch (err) {
        console.error(`❌ 画像アップロード失敗: ${fileObj.file.name}`, err);
        skippedNames.push(fileObj.file.name);
      }
    }

    // 画像以外：チャンク分割方式でVercel経由で送信
    for (const fileObj of otherFileObjs) {
      try {
        await uploadFileViaChunkedUpload(rowNumber, fileObj);
        succeededCount++;
      } catch (err) {
        console.error(`❌ ファイルアップロード失敗: ${fileObj.file.name}`, err);
        skippedNames.push(fileObj.file.name);
      }
    }
  } finally {
    // 【重要】途中で例外が起きた場合でも、必ずフラグを戻す
    // （そうしないと、以降ずっとリロード警告が出続けてしまう）
    isUploadingAttachedFiles = false;
  }

  if (skippedNames.length > 0 && typeof Swal !== "undefined") {
    await Swal.fire({
      icon: 'warning',
      title: '一部のファイルを送信できませんでした',
      html: `次のファイルのアップロードに失敗しました。<br><strong>${skippedNames.join('、')}</strong><br><br>お手数ですが、もう一度お試しください。`,
      confirmButtonText: '了解'
    });
  }

  // -------------------------------------------------------------
  // 【完了後の件数チェック】try/catchで捕捉できるエラー（通信失敗等）
  // とは別に、「試行した件数」と「実際に成功した件数」を突き合わせる。
  // これにより、想定外の原因（リロードによる中断等、tryブロックの
  // 外側で処理そのものが止まってしまうケース）で一部が欠けていても、
  // ユーザーが気づけるようにする。
  // -------------------------------------------------------------
  if (succeededCount < totalCount && skippedNames.length === 0 && typeof Swal !== "undefined") {
    await Swal.fire({
      icon: 'warning',
      title: 'アップロード件数をご確認ください',
      html: `${totalCount}件中${succeededCount}件のみ保存が確認できました。<br>編集画面から、添付ファイルの件数をご確認ください。`,
      confirmButtonText: '了解'
    });
  }
}
