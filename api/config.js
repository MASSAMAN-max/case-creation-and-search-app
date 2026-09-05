// =====================================================================
// /api/config
// -----------------------------------------------------------------------
// フロント（index.html）が起動時に一度だけ取得する、環境依存の設定値API。
//
// 【背景】
// 以前は案件一覧の「共有」ボタンのURLに、案件共有アプリ（Vercel）の
// ドメインを直接ハードコードしていた。これによりドメイン変更のたびに
// index.htmlを探して書き換える必要があり、変更漏れの事故が起きた
// （プレビュードメインのまま放置されていた等）。
// 今後は本ファイルのように「Vercelの環境変数 → API経由でフロントに渡す」
// 形に統一し、ドメイン変更時はVercelの環境変数を直すだけで済むようにする。
//
// 今後、他にも環境依存の値をフロントへ渡す必要が出た場合は、
// このAPIのレスポンスに項目を追加していく想定（＝設定値取得口の一本化）。
// =====================================================================

export default async function handler(req, res) {
  const shareAppDomain = process.env.SHARE_APP_DOMAIN;

  if (!shareAppDomain) {
    return res.status(500).json({
      error: "サーバー設定エラー: Vercel環境変数『SHARE_APP_DOMAIN』が読み込めていません。Redeployを実行してください。"
    });
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({
    shareAppDomain: shareAppDomain
  });
}
