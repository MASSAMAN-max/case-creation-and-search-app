// =====================================================================
// 02_utils.js ― 共通ユーティリティ
// ---------------------------------------------------------------------
// HTMLエスケープ・日付／文字列の正規化・トースト表示など、どの画面からも使う小さな共通関数。
// 他のファイルに依存しない（01_config.js の変数だけ参照する）。
// 読み込み順：index.html の <script> タグの順（01 → 07）。通常の<script>のため、
// 各ファイルで宣言した変数・関数は、他のファイルからそのまま参照できる。
// =====================================================================

// =================================================================
// 共通: HTMLエスケープ（動的に生成するHTMLに人名等を差し込む際の安全対策）
// =================================================================
function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 属性値用。escapeHtmlと同じ処理に統一（&や<を含む値も正しく扱える）
function escapeAttr(str) {
  return escapeHtml(str);
}

// onclick="...('${...}')" のように、HTML属性内のJS文字列リテラル
// （シングルクォートで囲む想定）に値を埋め込む際に使うエスケープ。
// escapeHtml/escapeAttrはHTML特殊文字用で、JS文字列としての
// シングルクォート・バックスラッシュのエスケープは行わないため別関数にしている。
function escapeForJsAttr(str) {
  return String(str == null ? "" : str)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;");
}

// 日付文字列/ISO文字列を <input type="date"> にそのまま渡せる "yyyy-MM-dd" 形式へ変換する
function parseDateForInput(d) {
  if (!d) return "";
  const str = String(d).split("T")[0].replace(/\//g, "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : "";
}

// 担当者データから安全に名前を取り出すヘルパー
function getStaffName(s) {
  if (!s || s === "undefined" || s === "null") return "";
  if (typeof s === 'object') {
    // 想定されるプロパティ名を片っ端からチェックし、なければ最初の値を返す
    return s.name || s.氏名 || s.担当者名 || s.value || Object.values(s)[0] || "";
  }
  return String(s); // 単なる文字列ならそのまま返す
}

// =================================================================
// クライアント側検索フィルタ（旧GAS側 searchRecordsExtended と同一ロジックを移植。
// サーバー側との二重管理を避けるため、絞り込みはここでのみ行う）
// =================================================================
const KANA_TO_HANKAKU_MAP = {
  'ガ':'ｶﾞ','ギ':'ｷﾞ','グ':'ｸﾞ','ゲ':'ｹﾞ','ゴ':'ｺﾞ','ザ':'ｻﾞ','ジ':'ｼﾞ','ズ':'ｽﾞ','ゼ':'ｾﾞ','ゾ':'ｿﾞ',
  'ダ':'ﾀﾞ','ヂ':'ﾁﾞ','ヅ':'ﾂﾞ','デ':'ﾃﾞ','ド':'ﾄﾞ','バ':'ﾊﾞ','ビ':'ﾋﾞ','ブ':'ﾌﾞ','ベ':'ﾍﾞ','ボ':'ﾎﾞ',
  'パ':'ﾊﾟ','ピ':'ﾋﾟ','プ':'ﾌﾟ','ペ':'ﾍﾟ','ポ':'ﾎﾟ','ヴ':'ｳﾞ',
  'ア':'ｱ','イ':'ｲ','ウ':'ｳ','エ':'ｴ','オ':'ｵ','カ':'ｶ','キ':'ｷ','ク':'ｸ','ケ':'ｹ','コ':'ｺ',
  'サ':'ｻ','シ':'ｼ','ス':'ｽ','セ':'ｾ','ソ':'ｿ','タ':'ﾀ','チ':'ﾁ','ツ':'ﾂ','テ':'ﾃ','ト':'ﾄ',
  'ナ':'ﾅ','ニ':'ﾆ','ヌ':'ﾇ','ネ':'ﾈ','ノ':'ﾉ','ハ':'ﾊ','ヒ':'ﾋ','フ':'ﾌ','ヘ':'ﾍ','ホ':'ﾎ',
  'マ':'ﾏ','ミ':'ﾐ','ム':'ﾑ','メ':'ﾒ','モ':'ﾓ','ヤ':'ﾔ','ユ':'ﾕ','ヨ':'ﾖ',
  'ラ':'ﾗ','リ':'ﾘ','ル':'ﾙ','レ':'ﾚ','ロ':'ﾛ','ワ':'ﾜ','ヲ':'ｦ','ン':'ﾝ',
  'ァ':'ｧ','ィ':'ｨ','ゥ':'ｩ','ェ':'ｪ','ォ':'ｫ','ッ':'ｯ','ャ':'ｬ','ュ':'ｭ','ョ':'ｮ','ー':'ｰ'
};

const KANA_TO_HANKAKU_REGEX = new RegExp(Object.keys(KANA_TO_HANKAKU_MAP).join('|'), 'g');

function normalizeText(t) {
  if (!t) return "";
  let text = String(t).replace(KANA_TO_HANKAKU_REGEX, m => KANA_TO_HANKAKU_MAP[m]);
  text = text.replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  return text.trim().toLowerCase();
}

// 施主名よみ検索用の正規化：全角英数→半角、半角カナ→全角カナ（NFKC）にしたうえで、
// カタカナをひらがなへ統一する。これにより、ひらがな・カタカナどちらで入力しても
// ひらがなで保存されている「施主名よみ」に一致する。
function normalizeYomi(t) {
  if (!t) return "";
  return String(t).normalize("NFKC")
    .replace(/[ァ-ヶ]/g, s => String.fromCharCode(s.charCodeAt(0) - 0x60))
    .trim().toLowerCase();
}

function getWeekday(dateStr) {
  if (!dateStr) return "";
  const cleanDate = dateStr.split("T")[0].replace(/\//g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return "";
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const date = new Date(cleanDate);
  return isNaN(date.getTime()) ? "" : `(${days[date.getDay()]})`;
}

// オブジェクト対応の値抽出
function extractValue(v) {
  if (!v) return "";
  if (typeof v === 'object') {
    return String(v.name || v.value || Object.values(v)[0] || "");
  }
  return String(v);
}

// ★【修正版】「株式会社」「(株)」等を消去する関数（引数の条件を解除し、常に整形）
function formatDisplayText(val) {
  let text = String(val || "").trim();

  // (株)、（株）、株式会社、有限会社 などを強力に消去
  return text
    // 「株式会社」等の法人格、および括弧付きの略称（株）（有）のみ除去する。
    // ※「株」「有」を括弧なしで消すと「有田建設」等の社名まで壊れるため、括弧付きに限定している
    .replace(/株式会社|有限会社|合同会社|[（(\[【][株有][）)\]】]/g, "")
    .trim();
}

// トップへスクロール
window.scrollToTop = function() {
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// スクロール位置でボタンを表示/非表示
window.handleScroll = function() {
  const scrollToTopBtn = document.getElementById("scrollToTopBtn");
  if (window.scrollY > 300) {
    scrollToTopBtn.style.display = "flex";
  } else {
    scrollToTopBtn.style.display = "none";
  }
};

// persist=true の場合は自動非表示にせず、次のshowToast呼び出し（＝2段目完了などの通知）が
// 来るまで表示し続ける。既存のタイマーが残っていると新しい表示を誤って消してしまうため、
// 呼び出しのたびに前回のタイマーを必ずクリアする。
let _toastHideTimer = null;

function showToast(message, isError = false, persist = false) {
  const toast = document.getElementById("toastNotification");
  toast.innerText = message;

  // エラーか成功かで色を変える（お好みで）
  if (isError) {
    toast.style.background = "#ef4444"; // 赤
  } else {
    toast.style.background = "#10b981"; // 緑
  }
  // 表示
  toast.classList.add("show");

  if (_toastHideTimer) {
    clearTimeout(_toastHideTimer);
    _toastHideTimer = null;
  }
  if (!persist) {
    // 10秒後に自動で隠す
    _toastHideTimer = setTimeout(() => {
      toast.classList.remove("show");
      _toastHideTimer = null;
    }, 10000);
  }
}
