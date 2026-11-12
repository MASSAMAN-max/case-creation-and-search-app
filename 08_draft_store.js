// =====================================================================
// 08_draft_store.js ― 入力途中データの自動保存・復元（第1段階）
// ---------------------------------------------------------------------
// 【目的】
// 新規登録モーダル・案件の編集フォームに入力した内容を、入力中から端末内（IndexedDB）へ
// 自動保存し、画面の再描画・アプリの再読み込み・OSによる終了のあとでも復元する。
//
// 【考え方】
// ・保存するのは「開いた時点の値（baseline）から変更された項目だけ」（差分）。
//   → 編集フォームでは、保存時の元の値（base）も一緒に持つ。復元時に、画面の現在値が
//     base と違う項目（＝その間にサーバー側で更新された項目）は復元せず、最新の値を優先する。
// ・保存は入力のたびに少し待ってから（デバウンス）行う。終了直前のイベントだけには頼らない。
//   pagehide / visibilitychange は「保存の取りこぼし防止」の補助として使う。
// ・サーバーへの保存（1段目）が成功したら、その案件の下書きを削除する。
// ・IndexedDBが使えない環境では、何もせず従来どおり動く（エラーにしない）。
// ・添付ファイル（写真・PDF）は対象外（第3段階で対応する）。
//
// 【依存】01_config.js（currentWorkCount, appConfig）、07_record_form.js
//   （editWorkCounts, showNextWorkField, addEditWorkField, removeCreateWorkField,
//    removeEditWorkField）、04_form_parts.js（initWorkerMultiSelect）、02_utils.js
//   （getWeekday, showToast）。いずれも実行時に参照するだけなので、読み込み順は問わない。
// 【キー】新規登録＝"create" ／ 編集＝"edit:{案件No}"
// =====================================================================

const DraftStore = (function () {
  const DB_NAME = "anken-app-drafts";
  const STORE_NAME = "drafts";
  const SAVE_DELAY_MS = 600;                          // 最後の操作から保存までの待ち時間
  const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;  // 30日経った下書きは起動時に削除する
  const MAX_WORK_SET_LOOP = 30;                       // 工事セット追加ループの安全装置（GAS側の上限と同じ）

  const cache = new Map();      // key → 下書き（メモリ上の写し。描画時に同期で参照するため）
  const contexts = new Map();   // key → { root, baseline, checkBase }（今画面にあるフォーム）
  const timers = new Map();     // key → 保存待ちのタイマー
  const suppressed = new Set(); // 送信成功後、フォームが作り直されるまで保存しないkey
  let dbPromise = null;

  // ---------------------------------------------------------------
  // IndexedDB（失敗しても例外にせず、保存なしで動き続ける）
  // ---------------------------------------------------------------
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
      try {
        if (!window.indexedDB) { resolve(null); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { console.warn("⚠️ 下書き用DBを開けませんでした:", req.error); resolve(null); };
      } catch (e) {
        console.warn("⚠️ 下書き用DBを使えません:", e);
        resolve(null);
      }
    });
    return dbPromise;
  }

  // 書き込み系（put / delete / clear）を1つのトランザクションで実行する
  async function dbWrite(work) {
    try {
      const db = await openDb();
      if (!db) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        work(tx.objectStore(STORE_NAME));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (e) {
      console.warn("⚠️ 下書きの保存に失敗しました:", e);
    }
  }

  const dbPut = rec => dbWrite(store => store.put(rec));
  const dbDelete = key => dbWrite(store => store.delete(key));

  // ---------------------------------------------------------------
  // 起動時：保存済みの下書きをメモリへ読み込む（描画の前に1回だけ呼ぶ）
  // ---------------------------------------------------------------
  async function loadAll() {
    try {
      // 端末の空き容量が少ないときに、ブラウザが勝手に消さないよう要求する（許可されなくても動作に影響なし）
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

      const db = await openDb();
      if (!db) return;
      const all = await new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const now = Date.now();
      all.forEach(rec => {
        if (now - rec.savedAt > DRAFT_MAX_AGE_MS) dbDelete(rec.key);
        else cache.set(rec.key, rec);
      });
    } catch (e) {
      console.warn("⚠️ 下書きの読み込みに失敗しました:", e);
    }
  }

  // ---------------------------------------------------------------
  // フォームの値の取得
  // ---------------------------------------------------------------
  // id を持つ入力欄の値を { id: 値 } で返す。
  // ファイル選択・ボタン・チェックボックスは対象外
  // （工事担当者の選択状態は、hidden（workerHiddenInput_...）にカンマ区切りで入っているため）。
  function collectState(root) {
    const state = {};
    root.querySelectorAll("input, select, textarea").forEach(el => {
      if (!el.id) return;
      const type = (el.type || "").toLowerCase();
      if (["file", "button", "submit", "reset", "checkbox", "radio"].indexOf(type) !== -1) return;
      state[el.id] = el.value;
    });
    return state;
  }

  function collectGroupIds(root) {
    return Array.from(root.querySelectorAll(".work-input-group")).map(el => el.id);
  }

  // "addWorkGroup_3" / "editWorkGroup_12_3" の末尾の番号（工事セット番号）
  function groupNumber(groupId) {
    const m = String(groupId).match(/_(\d+)$/);
    return m ? Number(m[1]) : 0;
  }

  // ---------------------------------------------------------------
  // 保存（デバウンス）
  // ---------------------------------------------------------------
  function scheduleSave(key) {
    if (suppressed.has(key)) return;
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => saveNow(key), SAVE_DELAY_MS));
  }

  function saveNow(key) {
    timers.delete(key);
    if (suppressed.has(key)) return;
    const ctx = contexts.get(key);
    if (!ctx || !ctx.root.isConnected) return; // 再描画で消えたフォームは対象にしない

    const current = collectState(ctx.root);
    const diff = {};
    Object.keys(current).forEach(id => {
      const base = ctx.baseline[id] !== undefined ? ctx.baseline[id] : "";
      if (current[id] !== base) diff[id] = { base: base, value: current[id] };
    });

    // 変更が1つも無い（元に戻した）場合は、下書きを残さない
    if (Object.keys(diff).length === 0) {
      if (cache.has(key)) { cache.delete(key); dbDelete(key); }
      return;
    }
    const rec = { key: key, diff: diff, groups: collectGroupIds(ctx.root), savedAt: Date.now() };
    cache.set(key, rec);
    dbPut(rec);
  }

  // 保存待ちのものを今すぐ保存する（画面を離れる・再描画する直前に使う）
  function flushAll() {
    Array.from(timers.keys()).forEach(key => {
      clearTimeout(timers.get(key));
      saveNow(key);
    });
  }

  // ---------------------------------------------------------------
  // 削除
  // ---------------------------------------------------------------
  // サーバーへの保存が成功したときなどに呼ぶ。
  // フォームが作り直されるまでは、そのkeyの保存を止める（成功後の操作で下書きが復活しないように）。
  function remove(key) {
    if (timers.has(key)) { clearTimeout(timers.get(key)); timers.delete(key); }
    suppressed.add(key);
    cache.delete(key);
    return dbDelete(key);
  }

  // 不要になった下書きを、保存停止にはせず消す（復元できるものが無かった場合など）
  function discardQuietly(key) {
    if (timers.has(key)) { clearTimeout(timers.get(key)); timers.delete(key); }
    cache.delete(key);
    return dbDelete(key);
  }

  // ログアウト時：共用端末に顧客情報が残らないよう、すべて削除する
  async function clearAll() {
    timers.forEach(t => clearTimeout(t));
    timers.clear();
    cache.clear();
    contexts.clear();
    await dbWrite(store => store.clear());
  }

  // ---------------------------------------------------------------
  // 復元
  // ---------------------------------------------------------------
  // 保存済みの差分を、画面に反映する。戻り値：{ applied, conflicts, skipped }
  //   applied   … 復元できた項目数
  //   conflicts … 保存後にサーバー側で更新されていたため、復元しなかった項目数（編集のみ）
  //   skipped   … 選択肢が今は存在せず、復元できなかった項目数
  function applyState(root, saved, checkBase, recordNo) {
    const isCreate = (root.id === "createProjectForm");
    const maxNum = Math.max(0, ...(saved.groups || []).map(groupNumber));

    // 1) 保存時にあった工事セットの枠を、足りない分だけ追加する
    for (let n = 0; n < MAX_WORK_SET_LOOP; n++) {
      if (isCreate) {
        if (currentWorkCount >= maxNum) break;
        showNextWorkField();
      } else {
        if ((editWorkCounts[recordNo] || 1) >= maxNum) break;
        addEditWorkField(recordNo);
      }
    }

    // 2) 画面上の順（上から下）に値を入れる。
    //    順序が大事：発注元→担当者（発注元の変更で担当者の選択肢が作り直されるため）、
    //    担当者→連絡先（「(新規担当者)」の選択で連絡先が空になるため）。
    let applied = 0, conflicts = 0, skipped = 0;
    root.querySelectorAll("input, select, textarea").forEach(el => {
      const entry = el.id ? saved.diff[el.id] : null;
      if (!entry) return;

      // 編集：保存したときの元の値と、今の値が違う＝その後にサーバー側で更新された。最新を優先する
      if (checkBase && el.value !== entry.base) { conflicts++; return; }

      // 工事担当者（複数選択）：hiddenの値だけ変えても表示が更新されないため、選択UIごと作り直す
      if (el.id.indexOf("workerHiddenInput_") === 0) {
        initWorkerMultiSelect(el.id.slice("workerHiddenInput_".length), appConfig.userList, entry.value);
        applied++;
        return;
      }

      // 今は選択肢に無い値（マスタ側で変わった等）は復元しない
      if (el.tagName === "SELECT" && !Array.from(el.options).some(o => o.value === entry.value)) {
        skipped++;
        return;
      }

      el.value = entry.value;

      // 「(新規○○)」の入力欄の表示切替、発注元に応じた担当者候補の更新だけは、画面側の処理を呼ぶ
      // （連絡先などの自動入力が走っても、後ろの入力欄が保存値で上書きするので問題ない）
      if (el.tagName === "SELECT" && typeof el.onchange === "function" &&
          (String(entry.value).indexOf("(新規") === 0 || el.id === "addClientSelect")) {
        el.onchange.call(el);
      }
      applied++;
    });

    // 3) 保存時より多い工事セットが画面にある場合（保存後に「×」で削除していた）は、末尾から削除する
    if ((saved.groups || []).length > 0) {
      const extras = collectGroupIds(root).map(groupNumber).filter(n => n > maxNum).sort((a, b) => b - a);
      extras.forEach(n => { isCreate ? removeCreateWorkField(n) : removeEditWorkField(recordNo, n); });
    }

    // 4) 施工予定日の曜日表示を更新する（値を直接入れたため、changeイベントが走っていない）
    root.querySelectorAll(".work-input-group input[type='date']").forEach(el => {
      const span = el.nextElementSibling;
      if (span && span.tagName === "SPAN") span.textContent = getWeekday(el.value);
    });

    return { applied: applied, conflicts: conflicts, skipped: skipped };
  }

  // ---------------------------------------------------------------
  // 編集フォーム：描画のたびに呼ぶ（05_search.js の描画ループの最後）
  // ---------------------------------------------------------------
  function attachEditForm(item, recordNo) {
    const key = "edit:" + recordNo;
    suppressed.delete(key);
    // フォームの初期化（担当者・検査日の時刻など）が済んだ状態を「元の値」とする
    contexts.set(key, { root: item, baseline: collectState(item), checkBase: true });

    const saved = cache.get(key);
    if (!saved) return;

    const result = applyState(item, saved, true, recordNo);
    if (result.applied === 0) {
      // 復元できるものが無い＝すでに不要な下書き。削除する
      discardQuietly(key);
      return;
    }
    showEditBanner(item, key, result);
  }

  function showEditBanner(item, key, result) {
    const details = item.querySelector(".result-details");
    if (!details) return;
    const banner = document.createElement("div");
    banner.style.cssText = "background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; border-radius:8px; padding:10px 12px; margin-bottom:16px; font-size:14px; display:flex; flex-wrap:wrap; align-items:center; gap:8px;";

    const text = document.createElement("span");
    text.style.flex = "1";
    let message = "保存していなかった入力内容を復元しました（" + result.applied + "項目）。";
    if (result.conflicts + result.skipped > 0) {
      message += "最新のデータと食い違う" + (result.conflicts + result.skipped) + "項目は、復元していません。";
    }
    text.textContent = message;

    const discardBtn = document.createElement("button");
    discardBtn.type = "button";
    discardBtn.className = "btn btn-secondary";
    discardBtn.style.cssText = "padding:6px 12px; font-size:13px;";
    discardBtn.textContent = "復元した内容を破棄";
    discardBtn.onclick = function (e) {
      e.stopPropagation();
      flushAll();                      // 他の案件の入力途中の内容を、再描画の前に保存する
      discardQuietly(key);
      renderCurrentResultsPage();      // 一覧を描き直す（この案件は元の値に戻る）
    };

    banner.appendChild(text);
    banner.appendChild(discardBtn);
    details.insertBefore(banner, details.firstChild);
  }

  // ---------------------------------------------------------------
  // 新規登録モーダル：openCreateModal() の最後に呼ぶ
  // ---------------------------------------------------------------
  function attachCreateForm() {
    const form = document.getElementById("createProjectForm");
    if (!form) return;
    suppressed.delete("create");
    contexts.set("create", { root: form, baseline: collectState(form), checkBase: false });

    const saved = cache.get("create");
    if (!saved) return;

    // 新規登録は「新しく入力したい」場合もあるため、確認してから復元する
    // （モーダルの表示順が高く、SweetAlert2が隠れてしまうため、標準のconfirmを使う）
    const ok = window.confirm("前回の入力途中の内容があります。復元しますか？\n（キャンセルすると破棄します）");
    if (!ok) { discardQuietly("create"); return; }

    const result = applyState(form, saved, false, null);
    if (result.applied === 0) { discardQuietly("create"); return; }
    showToast("前回の入力途中の内容を復元しました。");
  }

  // ---------------------------------------------------------------
  // 画面操作の監視（このファイルを読み込んだ時点で1回だけ登録する）
  // ---------------------------------------------------------------
  // どのフォームの操作かを判定し、そのフォームの保存を予約する。
  // clickも対象にしているのは、工事セットの追加・削除ボタンや担当者のトグルなど、
  // inputイベントが出ない操作を拾うため（保存は操作の少し後に行うので、処理の終了後の状態が保存される）。
  function onUserEvent(e) {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const item = target.closest(".result-item[data-record-no]");
    if (item) { scheduleSave("edit:" + item.dataset.recordNo); return; }
    if (target.closest("#createModal")) scheduleSave("create");
  }

  // capture（true）で受けるのは、画面側のonclickが stopPropagation() していても拾うため
  ["input", "change", "click"].forEach(type => document.addEventListener(type, onUserEvent, true));

  // 画面を離れる・隠れるときは、待たずに保存する（補助。通常は入力中の保存で済んでいる）
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); });
  window.addEventListener("pagehide", flushAll);

  return {
    loadAll: loadAll,
    attachEditForm: attachEditForm,
    attachCreateForm: attachCreateForm,
    remove: remove,
    clearAll: clearAll,
    flushAll: flushAll
  };
})();
