// =====================================================================
// sw.js ― Background Fetch 検証用の最小のサービスワーカー（検証が済んだら本導入用に作り直す）
// ---------------------------------------------------------------------
// ・fetch イベントは処理しない（＝キャッシュも書き換えもしない）。既存アプリの通信には影響しない。
// ・Background Fetch が終わったとき（成功・失敗・中止）に、結果を IndexedDB へ記録する。
//   画面がロックされていた間に完了したかを、あとで検証ページ（bgfetch-test.html）から確認するため。
// =====================================================================

const DB_NAME = "bgfetch-test";
const STORE = "results";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveResult(record) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// 各リクエストの応答（ステータスと本文の先頭）を集める
async function summarize(registration) {
  const records = await registration.matchAll();
  const items = [];
  for (const record of records) {
    let status = null;
    let body = null;
    try {
      const response = await record.responseReady;
      status = response.status;
      body = (await response.text()).slice(0, 300);
    } catch (err) {
      status = "ERR: " + err.message;
    }
    items.push({ url: record.request.url, status: status, body: body });
  }
  return items;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("backgroundfetchsuccess", event => {
  const registration = event.registration;
  event.waitUntil((async () => {
    const items = await summarize(registration);
    await saveResult({ id: registration.id, state: "success", at: Date.now(), items: items });
    await event.updateUI({ title: "検証：送信完了" });
  })());
});

self.addEventListener("backgroundfetchfail", event => {
  const registration = event.registration;
  event.waitUntil((async () => {
    const items = await summarize(registration);
    await saveResult({
      id: registration.id, state: "fail", reason: registration.failureReason, at: Date.now(), items: items
    });
    await event.updateUI({ title: "検証：送信失敗" });
  })());
});

self.addEventListener("backgroundfetchabort", event => {
  event.waitUntil(saveResult({
    id: event.registration.id, state: "abort", reason: event.registration.failureReason, at: Date.now(), items: []
  }));
});

// 通知（進捗の表示）をタップしたら、検証ページを開く
self.addEventListener("backgroundfetchclick", event => {
  event.waitUntil(self.clients.openWindow("/bgfetch-test.html"));
});
