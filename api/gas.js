export default async function handler(req, res) {
  // POST以外は拒否
  if (req.method !== "POST") {
    return res.status(405).json({
      status: "error",
      message: "Method Not Allowed"
    });
  }

  const GAS_URL = process.env.GAS_API_URL;

  if (!GAS_URL) {
    console.error("GAS_API_URL が設定されていません。");

    return res.status(500).json({
      status: "error",
      message: "サーバー設定エラー"
    });
  }

  try {
    // ブラウザから受け取ったJSONをGASへそのまま転送
    const response = await fetch(GAS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();

    // GASから返ってきたJSONをそのまま返す
    let data;

    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("GASからJSONではないレスポンス:", text);

      return res.status(502).json({
        status: "error",
        message: "GASから不正なレスポンスが返されました。"
      });
    }

    return res.status(response.ok ? 200 : response.status).json(data);

  } catch (error) {
    console.error("GAS通信エラー:", error);

    return res.status(502).json({
      status: "error",
      message: "GASとの通信に失敗しました。"
    });
  }
}
