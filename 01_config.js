// =====================================================================
// 01_config.js ― 設定値とグローバル状態
// ---------------------------------------------------------------------
// 画面全体で共有する状態（マスタデータ・案件キャッシュ・ログイン状態・一覧のページ位置など）と、
// GAS由来のマスタ（添付ファイル種別・受注媒体のリンクパターン）の置き場。
// ※ Vercelの /api/config（環境変数を返すAPI）とは別物。
// 読み込み順：index.html の <script> タグの順（01 → 07）。通常の<script>のため、
// 各ファイルで宣言した変数・関数は、他のファイルからそのまま参照できる。
// =====================================================================

//const GAS_URL = process.env.NEXT_PUBLIC_GAS_URL;
//const GAS_URL = 'https://script.google.com/macros/s/AKfycbzDU-eldEfHba9IA1vXFZDogvozxKlUOfp_e3XMjOZFj519yFskQrvykhzgp3G18Uic6w/exec';
let appConfig = {};

let allRecordsCache = null; // 案件データの全件キャッシュ（アプリ起動/リロード時に1回だけ取得）

const selectedFilesMap = {};

let currentWorkCount = 1;

// 添付ファイル種別マスタ（id・名称・自動判定用キーワード）：
// 以前はここに、GAS側（00_設定_共通ユーティリティ.js の FILE_TYPES）と全く同じ内容を
// 別途ハードコードしていたが、二重管理による更新漏れリスクがあったため廃止した。
// 現在は loadAppDataMaster() のレスポンス（appConfig.fileTypes）から
// applySharedMasterData() が組み立てる。ログイン完了前は空オブジェクトのままなので、
// このオブジェクトを参照する処理（renderFileList等）はログイン後にしか呼ばれないこと。
let FILE_TYPES_DEF = {};

// ログインの有効期限切れ（AUTH_EXPIRED）への対応用フラグ。
// isAppInitialized … メイン画面を表示済みか（起動時の認証失敗は、initializeApp側のcatchで処理するため区別する）
let isAppInitialized = false;

let isHandlingAuthExpired = false;

// -------------------------------------------------------------
// 【環境設定値の取得】
// 案件共有アプリ（Vercel）のドメイン等、環境依存の値を保持するグローバル変数。
// 以前はこの値を各所にハードコードしていたが、ドメイン変更時の修正漏れ事故が
// 起きたため、/api/config（Vercelの環境変数を返すだけの軽量API）から
// ページ読み込み時に一度だけ取得する方式に統一した。
// 取得前（fetchAppEnvConfig完了前）は null のままなので、参照する側
// （buildShareUrl等）は必ずnullチェックを行うこと。
// 【命名について】既存の appConfig（マスタデータ：発注元一覧・担当者一覧等）
// と役割が異なるため、混同を避けるために appEnvConfig という別名にしている。
// -------------------------------------------------------------
let appEnvConfig = null;

// 案件データのバックグラウンド読み込み中のPromiseを保持する。
// search()実行時にこれが残っていればawaitするだけにして、二重に読み込みに行かないようにする。
let recordsLoadingPromise = null;

// =================================================================
// 検索結果リスト表示
// =================================================================
// 受注媒体ごとのデータ元サイトURLパターン（Webボタン用）。
// ※ 以前はGAS側（07_カレンダー連携.js の MEDIA_LINK_MAP）と全く同じ内容を
//   別途ハードコードしていたが、二重管理による更新漏れリスクがあったため廃止した。
//   現在は loadAppDataMaster() のレスポンス（appConfig.mediaLinkMap）から
//   applySharedMasterData() が組み立てる。これにより、カレンダー説明欄の
//   リンク（GAS側 buildDataSourceUrl）と一覧のWebボタンのリンク先が
//   常に同じマスタから生成され、ズレる心配がなくなる。
let MEDIA_LINK_MAP_FRONT = {};

// 検索結果のページング設定（50件ずつ表示）
const RESULTS_PAGE_SIZE = 50;

let currentSearchResults = [];

let currentSearchPage = 1;

// ページ送りボタン（前へ／次へ）を指定したコンテナ（上部 or 下部）に描画する。
// 同じページ内に複数箇所ボタンを置くため、ボタンIDが重複しないよう毎回ユニークなIDを振る。
let _pagerInstanceCounter = 0;
