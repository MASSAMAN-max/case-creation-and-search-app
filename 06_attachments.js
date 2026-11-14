// =====================================================================
// 06_attachments.js ― 添付ファイル
// ---------------------------------------------------------------------
// ファイル選択・ドラッグ＆ドロップ、画像の送信前圧縮、PDF等のチャンク分割アップロード（中断・再開に対応）。
// アップロードの実行は、送信キュー（09_sync_queue.js）が uploadJobFiles() を呼んで行う。rowNumberが確定した後に呼ばれる。
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

// ファイルの「index番目のチャンク」だけを読み込み、Base64文字列にして返す。
// 以前は、ファイル全体をBase64の配列に変換してから送っていたため、大きなPDFではメモリを多く使い、
// OSにアプリが終了されやすかった。今は、送る直前に、そのチャンクの分だけを読み込む（中断・再開にも都合がよい）。
function readChunkAsBase64(file, index, chunkSize) {
  return new Promise((resolve, reject) => {
    const start = index * chunkSize;
    const blob = file.slice(start, Math.min(start + chunkSize, file.size));
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bytes = new Uint8Array(reader.result);
        // バイナリ文字列化してからbtoaでBase64化する（大きい配列でもスタック超過しないよう分割して結合）
        let binary = '';
        const stepSize = 0x8000;
        for (let i = 0; i < bytes.length; i += stepSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + stepSize));
        }
        resolve(btoa(binary));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
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
// 送信中の画面の自動消灯の防止（Wake Lock）
// -----------------------------------------------------------------------
// 画面が自動で消灯（ロック）すると、アプリのJavaScriptが止まり、アップロードが中断される。
// 送信中だけ、画面を点灯したままにする。
// ・対応していない端末・ブラウザでは、何もしない（エラーにしない）
// ・画面がバックグラウンドに回ると、ブラウザが自動で解除する。アプリに戻ったときに、取り直す
// ・端末の電源ボタンによる手動のロックは、防げない
// ・送信が終わると解除する（電池の消費を抑えるため）
// =================================================================
const UploadWakeLock = (function () {
  let sentinel = null;
  let holders = 0; // 送信中の処理の数

  async function request() {
    if (!("wakeLock" in navigator) || sentinel || document.visibilityState !== "visible") return;
    try {
      sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", () => { sentinel = null; });
    } catch (err) {
      console.warn("⚠️ 画面の消灯防止を開始できませんでした:", err);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (holders > 0 && document.visibilityState === "visible") request();
  });

  return {
    acquire: function () { holders++; return request(); },
    release: function () {
      holders = Math.max(0, holders - 1);
      if (holders === 0 && sentinel) {
        sentinel.release().catch(() => {});
        sentinel = null;
      }
    }
  };
})();

// =================================================================
// 添付ファイルのアップロード（中断・再開に対応）
// -----------------------------------------------------------------------
// 送信キュー（09_sync_queue.js）から、ジョブごとに呼ばれる。
//   ・画像 ：送信前に圧縮してBase64化し、GASの「uploadbox」で1枚ずつ送信する（1リクエスト）。
//   ・画像以外（PDF等）：約1.2MBのチャンクに分けて送る。サーバーに届いているチャンクを確認し、
//     足りない分だけ送る（途中から再開）。最後に結合・保存を依頼する。
//   ・ファイルごとに、フロントが発行したID（fileKey）をサーバーへ送る。再送しても同じIDなので、
//     サーバー側で、保存済みのファイルを二重に保存しない。
//   ・完了したファイルは progress に記録される。再送のとき、完了済みのファイルは送らない。
//
// 引数：
//   rowNumber : 案件の行番号（保存が完了してから呼ぶこと）
//   files     : [{ file, fileType, fileKey }]
//   progress  : fileKey → { done, error, chunkSize, totalChunks, sentChunks }（呼び出し側が端末に保存しておく）
//   hooks     : { onProgress: 進捗が変わるたびに呼ばれる非同期関数, classify: エラーの種類を判定する関数 }
// 例外：通信エラーなどはそのまま投げる（キュー側が、間隔をあけて再送する）。
//       入力内容の誤りなど、再送しても成功しないファイルは、他のファイルの送信を続けたうえで、最後にまとめて投げる。
// =================================================================
async function uploadOneFileResumable(rowNumber, fileObj, st, hooks) {
  const file = fileObj.file;

  // 画像：圧縮して1リクエストで送る（uploadKey でサーバー側の二重保存を防ぐ）
  if (isImageFile(file)) {
    const base64File = await fileToBase64(fileObj);
    base64File.uploadKey = fileObj.fileKey;
    await Api.uploadbox(rowNumber, [base64File]);
    st.done = true;
    await hooks.onProgress();
    return;
  }

  // 画像以外：チャンク分割。分割の大きさは、最初に決めた値を使い続ける（再開時に、区切りがずれないように）
  const chunkSize = st.chunkSize || UPLOAD_CHUNK_SIZE;
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  st.chunkSize = chunkSize;
  st.totalChunks = totalChunks;

  // セッションの開始（または再開）。すでに届いているチャンクの番号が返る
  const session = await Api.initChunkedUpload(rowNumber, file.name, fileObj.fileKey);
  if (session && session.finalized) {
    st.done = true; // すでに保存まで完了している
    await hooks.onProgress();
    return;
  }
  const received = new Set((session && session.receivedChunks) || []);
  st.sentChunks = received.size;

  // 足りないチャンクだけを、順番に送る
  for (let i = 0; i < totalChunks; i++) {
    if (received.has(i)) continue;
    const base64Chunk = await readChunkAsBase64(file, i, chunkSize);
    await Api.uploadChunk(rowNumber, fileObj.fileKey, i, base64Chunk);
    received.add(i);
    st.sentChunks = received.size;
    await hooks.onProgress();
    console.log(`📦 チャンク送信 ${received.size}/${totalChunks}: ${file.name}`);
  }

  // 全チャンクが届いたので、結合・保存を依頼する
  await Api.finalizeChunkedUpload(rowNumber, fileObj.fileKey, totalChunks, file.name, fileObj.fileType, file.type || 'application/octet-stream');
  st.done = true;
  await hooks.onProgress();
  console.log(`📤 チャンク分割アップロード完了: ${file.name} (${(file.size/1024/1024).toFixed(2)}MB, ${totalChunks}チャンク)`);
}

async function uploadJobFiles(rowNumber, files, progress, hooks) {
  const failedNames = [];

  await UploadWakeLock.acquire();
  try {
    for (const fileObj of files) {
      const st = progress[fileObj.fileKey] || (progress[fileObj.fileKey] = {});
      if (st.done) continue; // 完了済みのファイルは送らない

      try {
        await uploadOneFileResumable(rowNumber, fileObj, st, hooks);
      } catch (err) {
        // 通信エラー・ログイン期限切れなどは、キュー側で再送する。ここでは止める
        if (hooks.classify(err) !== "business") throw err;
        // 再送しても成功しないファイルは、記録して、他のファイルの送信を続ける
        console.error(`❌ ファイルアップロード失敗: ${fileObj.file.name}`, err);
        st.error = String((err && err.message) || err);
        failedNames.push(fileObj.file.name);
        await hooks.onProgress();
      }
    }
  } finally {
    UploadWakeLock.release();
  }

  if (failedNames.length > 0) {
    throw new Error("次のファイルを送信できませんでした: " + failedNames.join("、"));
  }
}
