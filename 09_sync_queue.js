// =====================================================================
// 09_sync_queue.js ― 送信キュー（第2段階）
// ---------------------------------------------------------------------
// 【目的】
// 案件の「新規登録」「更新」を、端末内（IndexedDB）に記録してからサーバーへ送る。
// 通信できない・画面を閉じた・アプリが終了した場合でも、記録が残り、通信が戻ると自動で再送する。
//
// 【送信の流れ（1件 = 1つのジョブ）】
//   stage "sheet"      … 1段目：スプレッドシートへ書き込み（新規作成 / 更新）
//   stage "background" … 2段目：カレンダー同期・通知メール・マスタ更新
//   stage "files"      … 添付ファイルのアップロード（現行の方式のまま。中断再開は第3段階）
//   stage "done"       … 完了（キューから削除される）
//   ※ 段階ごとに端末へ保存するため、再起動後も、途中の段階から再開する。
//
// 【二重送信の防止】
// ジョブIDを「リクエストID」としてサーバーへ送る（再送しても同じID）。
// サーバー側（GAS）は、このIDで「作成済みの行」「処理済みの結果」を照合し、二重に処理しない。
//
// 【状態】pending（送信待ち）／ uploading（通信中）／ failed（要確認：自動では再送しない）
//   ・通信エラー・一時的なエラー … pending のまま、間隔をあけて自動で再送する
//   ・入力内容の誤り等の確定したエラー … failed。画面左下の「送信状況」ボタンから再送・破棄する
//   ・ログイン期限切れ … ジョブは保持し、再ログイン後に再開する
//
// 【1段目だけは画面で結果を待つ】
// 入力内容の誤りなど、確定したエラーは、従来どおりその場でエラー表示し、入力を直せるようにする
// （キューに入れるのは、通信エラー・一時的なエラーの場合のみ）。
//
// 【依存】03_api_auth.js（Api）、05/07（refreshListAfterAllProcessing, applySharedMasterData,
//   appConfig）、06_attachments.js（uploadAllAttachedFiles）、02_utils.js（showToast, escapeHtml）。
// =====================================================================

const SyncQueue = (function () {
  const DB_NAME = "anken-app-queue";
  const STORE_JOBS = "jobs";        // ジョブ本体（ファイルは含めない）
  const STORE_FILES = "jobFiles";   // 添付ファイル（大きいため、ジョブ本体とは別に保存する）
  const LOCK_NAME = "anken-sync-queue"; // 複数タブで同じジョブを同時に送らないためのロック名
  const MAX_TRANSIENT_ATTEMPTS = 5;     // 一時的なエラーの再試行の上限（通信エラーは上限なし）
  const BACKOFF_MS = [5000, 15000, 30000, 60000, 120000, 300000]; // 再送の間隔（回数が増えるほど長く）
  const REFRESH_DELAY_MS = 1500;        // 完了後の一覧更新を、まとめて1回にするための待ち時間

  // GAS内部エラーのうち、「待てば成功する可能性が高い」ものを見分ける目安。
  // 入力内容の誤りなども「GAS内部エラー: …」の形で返るため、これに当てはまらないものは確定したエラーとして扱う。
  const TRANSIENT_PATTERN = /lock timeout|ロック|timed out|timeout|タイムアウト|too many times|Service invoked|Service Unavailable|Exceeded maximum execution time/i;

  const jobs = new Map();       // id → ジョブ（メモリ上の写し）
  const inlineIds = new Set();  // 画面で結果を待っている最中のジョブ（キュー側では処理しない）
  let running = false;
  let paused = false;           // ログイン期限切れの間は、送信を止める
  let retryTimer = null;
  let refreshTimer = null;
  let dbPromise = null;
  let indicatorEl = null;

  // ---------------------------------------------------------------
  // IndexedDB（使えない環境では、メモリ上だけで動く）
  // ---------------------------------------------------------------
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
      try {
        if (!window.indexedDB) { resolve(null); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE_JOBS, { keyPath: "id" });
          req.result.createObjectStore(STORE_FILES, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { console.warn("⚠️ 送信キュー用DBを開けませんでした:", req.error); resolve(null); };
      } catch (e) {
        console.warn("⚠️ 送信キュー用DBを使えません:", e);
        resolve(null);
      }
    });
    return dbPromise;
  }

  // 書き込み。成功したら true
  async function dbWrite(work) {
    try {
      const db = await openDb();
      if (!db) return false;
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_JOBS, STORE_FILES], "readwrite");
        work({ jobs: tx.objectStore(STORE_JOBS), files: tx.objectStore(STORE_FILES) });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return true;
    } catch (e) {
      console.warn("⚠️ 送信キューの保存に失敗しました:", e);
      return false;
    }
  }

  // 全件読み込み。使えない・失敗した場合は null
  async function dbReadAll() {
    try {
      const db = await openDb();
      if (!db) return null;
      return await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_JOBS, STORE_FILES], "readonly");
        const reqJobs = tx.objectStore(STORE_JOBS).getAll();
        const reqFiles = tx.objectStore(STORE_FILES).getAll();
        tx.oncomplete = () => {
          const fileMap = new Map();
          (reqFiles.result || []).forEach(r => fileMap.set(r.id, r.files || []));
          resolve({ rows: reqJobs.result || [], fileMap: fileMap });
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (e) {
      console.warn("⚠️ 送信キューの読み込みに失敗しました:", e);
      return null;
    }
  }

  // ジョブを保存する。withFiles=true のときだけ、添付ファイルも書き込む
  // （写真は大きいので、段階が進むたびに書き直さない）
  async function persist(job, withFiles) {
    const record = Object.assign({}, job);
    delete record.files;
    record.fileCount = job.files.length;
    const ok = await dbWrite(stores => {
      stores.jobs.put(record);
      if (withFiles) {
        if (job.files.length > 0) stores.files.put({ id: job.id, files: job.files });
        else stores.files.delete(job.id);
      }
    });
    // 添付ファイルが大きすぎて保存できない場合は、ファイル無しで記録だけ残す（送信はメモリ上のファイルで続ける）
    if (!ok && withFiles && job.files.length > 0) {
      console.warn("⚠️ 添付ファイルを端末に保存できませんでした。アプリを閉じると、未送信の添付ファイルは失われます。");
      record.fileCount = 0;
      await dbWrite(stores => { stores.jobs.put(record); });
    }
  }

  const removeFromDb = id => dbWrite(stores => { stores.jobs.delete(id); stores.files.delete(id); });

  // ---------------------------------------------------------------
  // 起動時の読み込み
  // ---------------------------------------------------------------
  // 前回のセッションで通信中のまま終了したジョブは、送信待ちに戻す
  async function loadAll() {
    const data = await dbReadAll();
    if (data) {
      data.rows.forEach(row => {
        row.files = data.fileMap.get(row.id) || [];
        if (row.status === "uploading") row.status = "pending";
        row.nextAttemptAt = 0;
        jobs.set(row.id, row);
      });
    }
    renderIndicator();
  }

  // 処理の前に、他のタブ等が完了・追加した内容を取り込む
  async function reloadFromDb() {
    const data = await dbReadAll();
    if (!data) return; // DBが使えない場合は、メモリ上の状態をそのまま使う
    const ids = new Set(data.rows.map(r => r.id));
    data.rows.forEach(row => {
      if (jobs.has(row.id)) return;
      row.files = data.fileMap.get(row.id) || [];
      jobs.set(row.id, row);
    });
    Array.from(jobs.keys()).forEach(id => {
      if (!ids.has(id) && !inlineIds.has(id)) jobs.delete(id);
    });
  }

  // ---------------------------------------------------------------
  // ID・エラーの分類・再送の間隔
  // ---------------------------------------------------------------
  // リクエストID。サーバー側（GAS）の形式チェック：英数字・「_」・「-」のみ、8〜80文字
  function newRequestId() {
    let body;
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      body = window.crypto.randomUUID();
    } else {
      body = Date.now().toString(16) + "-" + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    }
    return "req_" + body;
  }

  // エラーの種類を判定する
  //   auth          … ログインの期限切れ等。再ログイン後に再開する
  //   communication … 通信できない・サーバー側の一時的な障害。自動で再送する
  //   transient     … 待てば成功する可能性があるエラー（ロック待ち等）。回数を限って再送する
  //   business      … 入力内容の誤り等、確定したエラー。再送しても成功しない
  function classify(err) {
    if (err && typeof err.code === "string" && err.code.indexOf("AUTH") === 0) return "auth";
    if (err && err.isCommunicationError) {
      const status = err.httpStatus;
      // 413（大きすぎる）などの4xxは、再送しても成功しないため確定したエラー
      if (!status || status >= 500 || status === 408 || status === 429) return "communication";
      return "business";
    }
    if (TRANSIENT_PATTERN.test(String(err && err.message))) return "transient";
    return "business";
  }

  function backoff(attempts) {
    return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];
  }

  // ---------------------------------------------------------------
  // 各段階の処理
  // ---------------------------------------------------------------
  // 1段目の後にやることを決める（添付ファイルがあれば files、無ければ完了）
  function stageAfterBackground(job) {
    return job.files.length > 0 ? "files" : "done";
  }

  async function runSheetStage(job) {
    let res;
    if (job.type === "create") {
      res = await Api.createRecordSheetOnly(job.fData, job.id);
      job.rowNumber = res.rowNumber;
      job.expectedNo = res.newNo; // 2段目で、別の案件を処理しないよう、Noを照合するため
      job.stage = "background";
    } else {
      res = await Api.updateRecordSheetOnly(job.fData, job.rowNumber, job.expectedNo, job.id);
      const unchanged = !!res && res.isDataChanged === false;
      // 再送の場合は、1回目にサーバーで処理済みだが応答だけ失われた可能性がある
      // （その場合、再送時は「変更なし」と返る）。2段目が漏れないよう、再送のときは必ず2段目も行う
      job.stage = (unchanged && job.attempts === 0) ? stageAfterBackground(job) : "background";
    }
    job.sheetResult = res;
    await persist(job, false);
    return res;
  }

  async function runBackgroundStage(job) {
    await Api.processBackgroundTasks(job.fData, job.rowNumber, job.flags || {}, job.expectedNo, job.id);
    job.stage = stageAfterBackground(job);
    await persist(job, false);
    scheduleRefresh(); // 一覧・マスタを最新化する（複数ジョブが続く場合は、まとめて1回）
  }

  async function runFilesStage(job) {
    const result = await uploadAllAttachedFiles(job.rowNumber, job.files);
    const failedNames = (result && result.failedNames) ? result.failedNames : [];
    if (failedNames.length > 0) {
      // 送信できなかったファイルだけを残す（成功済みのものを再送して、二重保存しないため）
      job.files = job.files.filter(f => failedNames.indexOf(f.file.name) !== -1);
      const err = new Error("添付ファイルの一部を送信できませんでした: " + failedNames.join("、"));
      err.alreadyNotified = true; // 失敗の案内は uploadAllAttachedFiles が表示済み
      err.filesChanged = true;
      throw err;
    }
    job.stage = "done";
  }

  // ---------------------------------------------------------------
  // ジョブの送信
  // ---------------------------------------------------------------
  async function processJob(job) {
    job.status = "uploading";
    await persist(job, false);
    renderIndicator();
    try {
      if (job.stage === "sheet") await runSheetStage(job);
      if (job.stage === "background") await runBackgroundStage(job);
      if (job.stage === "files") await runFilesStage(job);
      // 完了
      jobs.delete(job.id);
      await removeFromDb(job.id);
      renderIndicator();
      return "done";
    } catch (err) {
      return await handleFailure(job, err);
    }
  }

  // 失敗したときの扱いを決める。戻り値："stop"（今回の送信を止める）／"continue"（次のジョブへ）
  async function handleFailure(job, err) {
    const kind = classify(err);
    console.error(`❌ 送信に失敗しました（${job.label} / ${job.stage} / ${kind}）:`, err);
    job.lastError = String((err && err.message) || err);
    const withFiles = !!(err && err.filesChanged);

    if (kind === "auth") {
      // ジョブは保持する。再ログイン（再読み込み）後に、続きから送る
      job.status = "pending";
      paused = true;
      await persist(job, withFiles);
      renderIndicator();
      return "stop";
    }

    job.attempts = (job.attempts || 0) + 1;
    const retryable = (kind === "communication") || (kind === "transient" && job.attempts < MAX_TRANSIENT_ATTEMPTS);
    if (retryable) {
      job.status = "pending";
      job.nextAttemptAt = Date.now() + backoff(job.attempts);
      await persist(job, withFiles);
      renderIndicator();
      return kind === "communication" ? "stop" : "continue";
    }

    job.status = "failed";
    await persist(job, withFiles);
    renderIndicator();
    if (!err || !err.alreadyNotified) notifyFailure(job);
    return "continue";
  }

  function notifyFailure(job) {
    if (typeof Swal === "undefined") return;
    Swal.fire({
      icon: "error",
      title: "データを送信できませんでした",
      html: `<strong>${escapeHtml(job.label)}</strong><br>${escapeHtml(job.lastError)}<br><br>` +
            `<small>左下の「送信状況」ボタンから、再送または破棄できます。</small>`,
      confirmButtonText: "了解"
    });
  }

  // ---------------------------------------------------------------
  // 送信の実行ループ
  // ---------------------------------------------------------------
  function sortedJobs() {
    return Array.from(jobs.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  // 送信待ちのジョブを、古い順に1件ずつ送る。複数タブで同時に動かないよう、ロックを取る
  function kick() {
    if (running || paused) return;
    if (navigator.locks && typeof navigator.locks.request === "function") {
      navigator.locks.request(LOCK_NAME, { ifAvailable: true }, lock => (lock ? loop() : null)).catch(() => {});
    } else {
      loop();
    }
  }

  async function loop() {
    if (running) return;
    running = true;
    try {
      await reloadFromDb();
      for (;;) {
        if (paused || navigator.onLine === false) break;
        const now = Date.now();
        const next = sortedJobs().find(j =>
          j.status === "pending" && !inlineIds.has(j.id) && (j.nextAttemptAt || 0) <= now);
        if (!next) break;
        const outcome = await processJob(next);
        if (outcome === "stop") break;
      }
    } finally {
      running = false;
      renderIndicator();
      scheduleRetry();
    }
  }

  // 送信待ちが残っていれば、次の再送時刻にもう一度動かす
  function scheduleRetry() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (paused || navigator.onLine === false) return; // オンライン復帰のイベントで再開する
    const pending = Array.from(jobs.values()).filter(j => j.status === "pending" && !inlineIds.has(j.id));
    if (pending.length === 0) return;
    const nextAt = Math.min.apply(null, pending.map(j => j.nextAttemptAt || 0));
    retryTimer = setTimeout(kick, Math.max(1000, nextAt - Date.now()));
  }

  // 完了後の一覧・マスタの更新（続けて完了した場合は、まとめて1回にする）
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      Api.loadAppDataMaster().then(data => {
        if (data && typeof appConfig !== "undefined") {
          appConfig = data;
          applySharedMasterData(data);
        }
      }).catch(console.error);
      await refreshListAfterAllProcessing();
    }, REFRESH_DELAY_MS);
  }

  // ---------------------------------------------------------------
  // 画面からの登録
  // ---------------------------------------------------------------
  // ジョブを端末に記録してから、1段目だけをその場で送って結果を待つ。
  //   input : { type, label, stage, rowNumber, expectedNo, fData, flags, files }
  //   stage : "sheet"（通常）／"files"（変更はなく、添付ファイルだけの場合）
  // 戻り値 : { queued, job, sheetResult }
  //   queued=true … 通信できなかったため、キューに残した（自動で再送する）
  // 例外   : 入力内容の誤りなど、確定したエラー（呼び出し側でエラーを表示し、入力を直せるようにする）
  async function submit(input) {
    const job = {
      id: newRequestId(),
      type: input.type,
      label: input.label || "",
      stage: input.stage || "sheet",
      status: "uploading",
      fData: input.fData || {},
      rowNumber: input.rowNumber || null,
      expectedNo: input.expectedNo || null,
      flags: input.flags || {},
      files: (input.files || []).slice(), // 画面側の配列を後で空にしても影響しないよう、複製する
      attempts: 0,
      nextAttemptAt: 0,
      lastError: "",
      createdAt: Date.now()
    };

    jobs.set(job.id, job);
    inlineIds.add(job.id);
    await persist(job, true); // 通信の前に、まず端末へ記録する
    renderIndicator();

    let sheetResult = null;
    try {
      if (job.stage === "sheet") sheetResult = await runSheetStage(job);
    } catch (err) {
      inlineIds.delete(job.id);
      const kind = classify(err);

      if (kind === "business") {
        // 確定したエラー：キューには残さず、呼び出し側でエラー表示する
        jobs.delete(job.id);
        await removeFromDb(job.id);
        renderIndicator();
        throw err;
      }

      // 通信エラー・一時的なエラー・ログイン期限切れ：キューに残して、あとで送る
      job.status = "pending";
      job.lastError = String((err && err.message) || err);
      if (kind === "auth") {
        paused = true;
      } else {
        job.attempts = 1;
        job.nextAttemptAt = Date.now() + backoff(1);
      }
      await persist(job, false);
      renderIndicator();
      scheduleRetry();
      return { queued: true, job: job, sheetResult: null };
    }

    inlineIds.delete(job.id);
    job.status = "pending";
    await persist(job, false);
    kick(); // 2段目以降は、画面を待たせずに進める
    return { queued: false, job: job, sheetResult: sheetResult };
  }

  // ---------------------------------------------------------------
  // 送信状況の表示（画面左下のボタン）
  // ---------------------------------------------------------------
  function renderIndicator() {
    if (!document.body) return;
    if (!indicatorEl) {
      indicatorEl = document.createElement("button");
      indicatorEl.type = "button";
      indicatorEl.id = "syncQueueIndicator";
      indicatorEl.style.cssText = "position:fixed; left:16px; bottom:24px; z-index:998; display:none; align-items:center; gap:6px; " +
        "padding:10px 14px; border:none; border-radius:24px; color:#fff; font-size:14px; font-weight:bold; cursor:pointer; " +
        "box-shadow:0 4px 12px rgba(0,0,0,0.25); font-family:inherit;";
      indicatorEl.onclick = showDetails;
      document.body.appendChild(indicatorEl);
    }

    const all = Array.from(jobs.values());
    if (all.length === 0) { indicatorEl.style.display = "none"; return; }

    const failed = all.filter(j => j.status === "failed").length;
    const uploading = all.filter(j => j.status === "uploading").length;
    const pending = all.length - failed - uploading;

    let text = "送信状況：";
    const parts = [];
    if (uploading > 0) parts.push("送信中");
    if (pending > 0) parts.push(`送信待ち${pending}件`);
    if (failed > 0) parts.push(`要確認${failed}件`);
    text += parts.join(" / ");

    indicatorEl.textContent = text;
    indicatorEl.style.background = failed > 0 ? "#ef4444" : (uploading > 0 ? "#3b82f6" : "#f59e0b");
    indicatorEl.style.display = "flex";
  }

  const STAGE_LABEL = { sheet: "登録", background: "カレンダー等", files: "添付ファイル", done: "完了処理" };
  const STATUS_LABEL = { pending: "送信待ち", uploading: "送信中", failed: "要確認" };

  async function showDetails() {
    const all = sortedJobs();
    if (all.length === 0 || typeof Swal === "undefined") return;
    const hasFailed = all.some(j => j.status === "failed");

    const rows = all.map(j => {
      const error = j.lastError ? `<div style="color:#b91c1c; font-size:12px; margin-top:2px;">${escapeHtml(j.lastError)}</div>` : "";
      return `<li style="margin-bottom:10px;"><strong>${escapeHtml(j.label)}</strong>` +
             `（${STATUS_LABEL[j.status] || j.status} / ${STAGE_LABEL[j.stage] || j.stage}）${error}</li>`;
    }).join("");

    const result = await Swal.fire({
      title: "未送信のデータ",
      html: `<ul style="text-align:left; padding-left:18px; margin:0;">${rows}</ul>` +
            `<p style="font-size:12px; color:#64748b; margin-top:12px;">通信が回復すると、送信待ちのものは自動で送信されます。</p>`,
      showCancelButton: true,
      showDenyButton: hasFailed,
      confirmButtonText: "今すぐ再送",
      denyButtonText: "要確認のものを破棄",
      cancelButtonText: "閉じる"
    });

    if (result.isConfirmed) {
      paused = false;
      all.forEach(j => {
        if (j.status !== "uploading") { j.status = "pending"; j.nextAttemptAt = 0; j.attempts = 0; }
      });
      await Promise.all(all.map(j => persist(j, false)));
      renderIndicator();
      kick();
    } else if (result.isDenied) {
      const confirm = await Swal.fire({
        icon: "warning",
        title: "破棄しますか？",
        text: "破棄したデータは元に戻せません（入力内容も失われます）。",
        showCancelButton: true,
        confirmButtonText: "破棄する",
        cancelButtonText: "やめる"
      });
      if (!confirm.isConfirmed) return;
      const failedJobs = all.filter(j => j.status === "failed");
      for (const j of failedJobs) {
        jobs.delete(j.id);
        await removeFromDb(j.id);
      }
      renderIndicator();
    }
  }

  // ---------------------------------------------------------------
  // その他
  // ---------------------------------------------------------------
  const hasJobs = () => jobs.size > 0;

  // ログアウト時：他のユーザーの権限で送信されないよう、未送信のデータも削除する
  async function clearAll() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    jobs.clear();
    inlineIds.clear();
    await dbWrite(stores => { stores.jobs.clear(); stores.files.clear(); });
    renderIndicator();
  }

  // 通信が回復したとき・アプリに戻ってきたときに、すぐ再送を試みる
  window.addEventListener("online", () => {
    jobs.forEach(j => { if (j.status === "pending") j.nextAttemptAt = 0; });
    kick();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick();
  });

  return {
    loadAll: loadAll,
    submit: submit,
    kick: kick,
    hasJobs: hasJobs,
    clearAll: clearAll
  };
})();
