// =====================================================================
// 03_api_auth.js ― GAS通信・ログイン・起動処理
// ---------------------------------------------------------------------
// Vercel経由のGAS通信（apiCall / Api）、ログイン・ログアウト、起動時の初期化（initializeApp）。
// ページ読み込み時の起動処理（DOMContentLoaded）もここにある。
// 読み込み順：index.html の <script> タグの順（01 → 07）。通常の<script>のため、
// 各ファイルで宣言した変数・関数は、他のファイルからそのまま参照できる。
// =====================================================================

// 利用中にログインの有効期限が切れた・無効化された場合の処理。
// 保存済みのトークンを破棄し（次に開いた時にログイン画面になる）、案内を出してOKで再読み込みする。
// ※ 呼び出し元（保存処理など）も続けて自分のエラー表示を出すことがあるが、SweetAlert2は同時に1つしか
//   表示できないため、後から出た同じ趣旨の表示に置き換わるだけで、重なることはない。
async function handleAuthExpired(message) {
  if (!isAppInitialized || isHandlingAuthExpired) return;
  isHandlingAuthExpired = true;
  localStorage.removeItem('app_login_token');
  const result = await Swal.fire({
    icon: 'info',
    title: '再ログインが必要です',
    text: message || 'ログインの有効期限が切れました。再度ログインしてください。',
    confirmButtonText: 'OK'
  });
  if (result.isConfirmed) window.location.reload();
}

async function apiCall(action, payload = {}, retriesLeft = 2) {
  // 🔐 ログイン簡略化のセキュリティ対策：
  // ブラウザにはID/パスワードそのものは保存せず、ログイントークンのみを保存する。
  // トークンがあればそれだけを送信し、無い場合（初回ログイン等）だけID/パスワードを送信する。
  // 【sessionStorageを使う理由】ID/パスワードは「初回ログインリクエストを送るまでの
  // ごく一瞬だけ」保持できればよい一時データのため、タブを閉じれば自動的に消える
  // sessionStorageを使う。トークン（app_login_token）は複数端末・タブをまたいだ
  // 永続ログインを維持する必要があるため、従来通りlocalStorageのままにしている。
  const token = localStorage.getItem('app_login_token');
  if (token) {
    payload.token = token;
  } else {
    payload.loginId = sessionStorage.getItem('app_login_id');
    payload.password = sessionStorage.getItem('app_login_password');
  }

  try {
    const response = await fetch("/api/gas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: action,
        payload: payload
      })
    });
    if (!response.ok) {
      throw new Error(`HTTPエラー! ステータス: ${response.status}`);
    }
    const resData = await response.json();
    if (resData.status === "error") {
      // サーバーが認証エラーの種類（code）を返した場合は、呼び出し側で判別できるよう保持する
      const businessError = new Error(resData.message);
      businessError.code = resData.code || "";
      throw businessError;
    }
    return resData.data;
  } catch (err) {
    const isTransientHttpError = err.message.startsWith("HTTPエラー");

    if (isTransientHttpError && retriesLeft > 0) {
      console.warn(
        `⚠️ ${action}: 通信エラーのため再試行します（残り${retriesLeft}回）: ${err.message}`
      );
      await new Promise(r => setTimeout(r, 1200));
      return apiCall(action, payload, retriesLeft - 1);
    }
    if (err.code === 'AUTH_EXPIRED') handleAuthExpired(err.message);
    throw err;
  }
}

// =================================================================
// 🔌 GAS通信の集約レイヤー（Api）
// -----------------------------------------------------------------------
// これまでは各所で apiCall("アクション名", {...}) を直接呼び出しており、
// アクション名の文字列や送信パラメータの形をコード中に何度も手書きしていた
// （例："loadAllRecords" というスペルミスをしても実行時までエラーに気づけない、
//  同じAPIへの呼び出し方が呼び出し箇所ごとに微妙に違う、GAS側の仕様が変わった際に
//  修正箇所を探すのが大変、等）。
// このApiオブジェクトは、GASの各アクション（doPost内のswitch文の各case）に対応する
// 名前付きメソッドをまとめたものであり、実際の通信はこれまで通りapiCall()が担う
// （＝GAS側・Vercel側の実装や通信方式は一切変更していない、呼び出し方を整理しただけ）。
// 今後、新しいGASアクションを追加する場合はここにメソッドを1つ足すだけでよい。
// =================================================================
const Api = {
  // ---- 認証・マスタ ----
  loadAppDataMaster: () => apiCall("loadAppDataMaster"),
  logout: (token) => apiCall("logout", { token }),

  // ---- 案件データ 読み込み ----
  loadAllRecords: () => apiCall("loadAllRecords"),

  // ---- 案件データ 登録・更新 ----
  createRecordSheetOnly: (fData) => apiCall("createRecordSheetOnly", { fData }),
  updateRecordSheetOnly: (fData, rNum) => apiCall("updateRecordSheetOnly", { fData, rNum }),
  processBackgroundTasks: (fData, rNum, flags) => apiCall("processBackgroundTasks", { fData, rNum, flags }),

  // ---- 添付ファイル（チャンク分割アップロード） ----
  uploadbox: (rowNumber, filesData) => apiCall("uploadbox", { rowNumber, filesData }),
  initChunkedUpload: (rowNumber, fileName) => apiCall("initChunkedUpload", { rowNumber, fileName }),
  uploadChunk: (rowNumber, uploadId, chunkIndex, base64Chunk) => apiCall("uploadChunk", { rowNumber, uploadId, chunkIndex, base64Chunk }),
  finalizeChunkedUpload: (rowNumber, uploadId, totalChunks, fileName, fileType, mimeType) =>
    apiCall("finalizeChunkedUpload", { rowNumber, uploadId, totalChunks, fileName, fileType, mimeType }),
};

async function fetchAppEnvConfig() {
  try {
    const response = await fetch("/api/config");
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || "設定値の取得に失敗しました");
    }
    appEnvConfig = data;
  } catch (err) {
    console.error("❌ /api/config の取得に失敗しました:", err);
    // 失敗してもアプリ自体は継続させる（共有ボタンだけが使えなくなる程度に留める）
    appEnvConfig = null;
  }
}

// -------------------------------------------------------------
// 【共有ボタンの処理】
// 【方針転換】以前はviewKey（閲覧用一時トークン）をGASに発行して
// もらい、案件共有アプリ側のログインを省略する仕組みだったが、
// 「共有する」操作と「案件を見る」操作を分離する設計に変更した。
// 今はGAS通信を一切行わず、案件共有アプリの共有方法選択ページ
// （share.html）を、tokenだけ渡して新しいタブで開くだけのシンプルな
// 処理になっている（GAS通信が無いため、ポップアップブロック対策の
// ための「先に空タブを開く」工夫も不要）。
// -------------------------------------------------------------
function openShareApp(shareToken, shareAppDomain) {
  const url = `https://${shareAppDomain}/share.html?token=${encodeURIComponent(shareToken)}`;
  window.open(url, "_blank");
}

document.addEventListener("DOMContentLoaded", async () => {
  await fetchAppEnvConfig();
  initializeInspectionTimeSelects();
  const savedToken = localStorage.getItem('app_login_token');
  if (savedToken) {
    initializeApp();
  } else {
    document.getElementById("initLoader").style.display = "none";
    document.getElementById("loginScreen").style.display = "flex";
    // Enterキーでのログインは<form onsubmit>が処理するため、keypressの個別登録は不要
    // （以前は両方が発火し、ログイン処理・GAS通信が二重に走っていた）
  }
  document.getElementById("searchValue").addEventListener("keydown", function(e) {
    if (e.key === "Enter") search();
  });

  window.addEventListener("scroll", handleScroll);
});

function togglePasswordVisibility() {
  const passwordInput = document.getElementById("loginPasswordInput");
  const eyeIcon = document.getElementById("eyeIcon");

  if (passwordInput.type === "password") {
    // パスワードを表示する
    passwordInput.type = "text";
    eyeIcon.textContent = "visibility"; //  通常の目のアイコンに変化
  } else {
    // パスワードを非表示（伏せ字）にする
    passwordInput.type = "password";
    eyeIcon.textContent = "visibility_off"; //  斜線付きの目のアイコンに変化
  }
}

async function handleLoginSubmit(e) {
  if (e && e.preventDefault) {
      e.preventDefault();
  }
  const id = document.getElementById("loginIdInput").value.trim();
  const pw = document.getElementById("loginPasswordInput").value.trim();
  if (!id || !pw) return showToast("IDとパスワードを入力してください。", true);
  const btn = document.getElementById("loginBtn");
  btn.disabled = true; btn.textContent = "認証中...";
  localStorage.removeItem('app_login_token'); // 念のため古いトークンをクリアしてからID/パスワードでログインする
  sessionStorage.setItem('app_login_id', id);
  sessionStorage.setItem('app_login_password', pw);
  document.getElementById("loginScreen").style.display = "none";
  await initializeApp();
}

// =================================================================
// 🔗 GAS側マスタデータをフロント用の形へ変換して反映する
// -----------------------------------------------------------------------
// 【背景】以前は「添付ファイル種別マスタ（FILE_TYPES_DEF）」と
// 「受注媒体ごとのURLパターン（MEDIA_LINK_MAP_FRONT）」を、GAS側の定義
// （00_設定_共通ユーティリティ.js の FILE_TYPES、07_カレンダー連携.js の
// MEDIA_LINK_MAP）と全く同じ内容でこのファイルにも別途ハードコードしており、
// 「片方だけ更新して不整合になる」事故のリスクを抱えていた。
// 今後はGAS側から届いた値をこの関数でそのまま展開するだけにし、
// マスタの実体はGAS側の1箇所だけで管理する。
// loadAppDataMaster()を呼ぶたびに（初回ログイン時・新規/更新保存後の
// バックグラウンド再取得時）必ずこの関数も合わせて呼ぶこと。
// =================================================================
function applySharedMasterData(data) {
  // 添付ファイル種別マスタ：GASからは配列 [{id, name, keywords}, ...] で届くため、
  // 既存コード（FILE_TYPES_DEF[code].name 等）がそのまま使える「idをキーにしたオブジェクト」へ変換する
  const fileTypesArray = Array.isArray(data.fileTypes) ? data.fileTypes : [];
  const newFileTypesDef = {};
  fileTypesArray.forEach(t => {
    if (t && t.id) newFileTypesDef[t.id] = { name: t.name, keywords: t.keywords || [] };
  });
  FILE_TYPES_DEF = newFileTypesDef;

  // 受注媒体ごとのURLパターン：GAS側と全く同じ形（{ 媒体名: { prefix } }）で届くため、そのまま反映する
  MEDIA_LINK_MAP_FRONT = (data.mediaLinkMap && typeof data.mediaLinkMap === 'object') ? data.mediaLinkMap : {};
}

async function initializeApp() {
  const loader = document.getElementById("initLoader");
  loader.style.display = "flex";
  document.getElementById("loaderText").textContent = "ログイン認証中...";
  try {
    // ① まずログイン認証を兼ねるマスタデータ取得のみを待つ。ここが通ればログイン成功。
    const data = await Api.loadAppDataMaster();
    appConfig = data;
    applySharedMasterData(data);
    if (data.loginUser) {
      document.getElementById("userDisplayLabel").textContent = `👤${data.loginUser}`;
    }
    // 🔐 ID/パスワードでの認証が成功した場合、サーバーから新しいログイントークンが返ってくる。
    //   これを保存し、代わりにID/パスワードは（ログイン処理の一時保持用に入れていたものを）直ちに削除する。
    //   以後の通信はこのトークンのみで行われ、パスワードそのものはブラウザに残らない。
    if (data.token) {
      localStorage.setItem('app_login_token', data.token);
    }
    sessionStorage.removeItem('app_login_id');
    sessionStorage.removeItem('app_login_password');
    initSelectWithOptions("filterClient", data.clientList, "発注元", "すべて");

    // 検索フィルター：工事内容・工事担当者（複数選択トグル）を初期化
    document.getElementById("filterWorkContentContainer").innerHTML = buildFilterMultiSelectHtml("filterWorkContent", "工事内容を選択");
    initWorkerMultiSelect("filterWorkContent", data.workContentList || [], "");
    document.getElementById("filterWorkerContainer").innerHTML = buildFilterMultiSelectHtml("filterWorker", "工事担当者を選択");
    initWorkerMultiSelect("filterWorker", data.userList || [], "");
    document.getElementById("filterManagerContainer").innerHTML = buildFilterMultiSelectHtml("filterManager", "担当者を選択");
    initWorkerMultiSelect("filterManager", data.managerList || [], "");

    // ② 認証が完了した時点で、案件データの読み込み完了を待たずにすぐメイン画面を表示する
    loader.style.display = "none";
    document.getElementById("mainApp").style.display = "block";
    isAppInitialized = true; // 以後の認証エラーは、handleAuthExpired で処理する
    // ログインが成功してメイン画面が出たら、ユーザー表示ラベル（兼ログアウトボタン）を表示する
    const logoutBtn = document.getElementById("userLogoutLabel");
    if (logoutBtn) logoutBtn.style.display = "flex";

    // ③ 案件データはメイン画面表示をブロックせず、裏側で読み込む
    loadAllRecordsInBackground();

  } catch (err) {
    // 1. ローダーを非表示にする
    loader.style.display = "none";
    // 2. await を使ってユーザーがOKを押すのを待つ
    await Swal.fire({
      title: err.code === 'AUTH_EXPIRED' ? '再ログインが必要です' : 'ログインに失敗しました。',
      text: err.message,
      icon: err.code === 'AUTH_EXPIRED' ? 'info' : 'error',
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'OK'
    });
    // 【互換性のための後片付け】以前のバージョンではID/パスワードをlocalStorageに
    // 保存していたため、旧バージョンから移行してきた利用者の端末に残っている
    // 可能性がある古い値も念のため消しておく（新バージョンではsessionStorageのみ使用）。
    localStorage.removeItem('app_login_id');
    localStorage.removeItem('app_login_password');
    localStorage.removeItem('app_login_token');
    sessionStorage.removeItem('app_login_id');
    sessionStorage.removeItem('app_login_password');
    // 3. ユーザーがOKを押した後にリロードが走る
    window.location.reload();
  }
}

window.handleLogout = async function() {
  const result = await Swal.fire({
    title: 'ログアウトしますか？',
    text: "ログイン情報をクリアして最初の画面に戻ります。",
    icon: 'question',                // 質問マークのアイコン
    showCancelButton: true,          // キャンセルボタンを表示
    confirmButtonColor: '#ef4444',   // ログアウトボタンの色（赤）
    cancelButtonColor: '#64748b',    // キャンセルボタンの色（グレー）
    confirmButtonText: 'ログアウト',
    cancelButtonText: 'キャンセル'
  });

  // 「ログアウト」ボタンを押した場合のみ、以下の処理が走ります
  if (result.isConfirmed) {
    // 1. フォームの入力欄をクリア
    const idInput = document.getElementById("loginIdInput");
    const passInput = document.getElementById("loginPasswordInput");
    if (idInput) idInput.value = "";
    if (passInput) passInput.value = "";

    // 2. ユーザー表示ラベル（兼ログアウトボタン）を隠す
    const logoutBtn = document.getElementById("userLogoutLabel");
    if (logoutBtn) logoutBtn.style.display = "none";

    // 3. サーバー側のトークンも確実に失効させる（漏洩時の悪用防止のため、
    //    ブラウザ側だけでなくGAS側のホワイトリストからもトークンを消す）
    const tokenToRevoke = localStorage.getItem('app_login_token');
    if (tokenToRevoke) {
      try {
        await Api.logout(tokenToRevoke);
      } catch (revokeErr) {
        // 失効APIが失敗しても、ローカルの情報は必ず消してログアウト自体は完了させる
        console.error("❌ サーバー側トークンの失効に失敗しました:", revokeErr);
      }
    }

    // 4. ブラウザに記憶されている自動ログイン用の情報を完全に削除
    // （app_login_id/app_login_passwordは現在sessionStorageのみで使うが、
    //   旧バージョンのlocalStorageに残っている可能性も考慮し両方消しておく）
    localStorage.removeItem('app_login_id');
    localStorage.removeItem('app_login_password');
    localStorage.removeItem('app_login_token');
    sessionStorage.removeItem('app_login_id');
    sessionStorage.removeItem('app_login_password');

    // 5. すべてをクリアした状態で画面をリロード
    window.location.reload();
  }
};
