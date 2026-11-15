// =====================================================================
// /api/bgfetch-test ― Background Fetch 検証用の受け口（検証が済んだら削除する）
// ---------------------------------------------------------------------
// ・受け取ったデータの大きさ（バイト数）と受信時刻を返すだけ。GAS・Drive・シートには一切触れない。
// ・Vercelの環境変数 BGFETCH_TEST_ENABLED が "1" のときだけ動く。未設定なら 404 を返す
//   （検証期間以外に、誰でも呼べる状態にしないため）。
// ・delay（ミリ秒、最大3000）を指定すると、その時間だけ応答を遅らせる。
//   送信が長引く状況（画面ロック中など）を作るために使う。
// ・リクエストのサイズは、Vercelの関数の上限（約4.5MB）以内にすること。
// =====================================================================

export const config = {
  api: {
    bodyParser: false, // 本文は読み込まず、バイト数だけ数える
  },
};

export default async function handler(req, res) {
  if (process.env.BGFETCH_TEST_ENABLED !== "1") {
    return res.status(404).json({ error: "Not Found" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
  }

  const delay = Math.min(Math.max(Number(req.query.delay) || 0, 0), 3000);
  if (delay > 0) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(200).json({
    ok: true,
    index: Number(req.query.i) || 0,
    bytes: bytes,
    receivedAt: new Date().toISOString(),
  });
}
