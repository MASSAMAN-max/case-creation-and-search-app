// =====================================================================
// 05_search.js ― 検索・一覧表示
// ---------------------------------------------------------------------
// 案件データの読み込み、クライアント側の絞り込み（filterRecordsClientSide）、一覧カードの描画、
// ページ送り、詳細検索の開閉、カードのアコーディオン。
// 読み込み順：index.html の <script> タグの順（01 → 07）。通常の<script>のため、
// 各ファイルで宣言した変数・関数は、他のファイルからそのまま参照できる。
// =====================================================================

// 案件データ（loadAllRecords）をバックグラウンドで読み込む。
// 完了するとallRecordsCacheにセットされ、以後の検索で使われる。
// 既に読み込み中の場合は、そのPromiseをそのまま返す（二重読み込み防止）。
function loadAllRecordsInBackground() {
  if (recordsLoadingPromise) return recordsLoadingPromise;
  const countDiv = document.getElementById("searchCount");
  if (countDiv && !countDiv.innerHTML) {
    countDiv.innerHTML = '<span style="color:#94a3b8;">案件データを読み込み中...</span>';
  }
  recordsLoadingPromise = Api.loadAllRecords()
    .then(records => {
      allRecordsCache = records;
      recordsLoadingPromise = null;
      const cd = document.getElementById("searchCount");
      if (cd && cd.innerHTML.includes("読み込み中")) cd.innerHTML = "";
      return records;
    })
    .catch(err => {
      recordsLoadingPromise = null;
      console.error("❌ 案件データの読み込みに失敗しました:", err);
      const cd = document.getElementById("searchCount");
      if (cd) cd.innerHTML = '<span style="color:#ef4444;">案件データの読み込みに失敗しました。検索ボタンで再試行してください。</span>';
      throw err;
    });
  return recordsLoadingPromise;
}

// 日程検索
// shouldScroll: 検索結果が表示された際に画面を少し下へスクロールするかどうか（既定はtrue）。
//   保存後のバックグラウンド更新（refreshListAfterAllProcessing）など、
//   ユーザー操作を伴わない自動再描画のときはfalseを渡してスクロールしないようにする。
async function search(shouldScroll = true) {
  const btn = document.getElementById("searchBtn");
  const resultsDiv = document.getElementById("results");
  const loader = document.getElementById("initLoader");
  btn.disabled = true;

  const client = document.getElementById("filterClient").value;
  const startDate = document.getElementById("filterStartDate").value;
  const endDate = document.getElementById("filterEndDate").value;
  const unscheduledOnly = document.getElementById("filterUnscheduledOnly").checked;
  const keyword = document.getElementById("searchValue").value;
  const workContentFilter = getFilterMultiSelectValues("filterWorkContent");
  const workerFilter = getFilterMultiSelectValues("filterWorker");
  const managerFilter = getFilterMultiSelectValues("filterManager");

  try {
    // キャッシュが無い場合：バックグラウンド読み込みが進行中ならその完了を待ち、
    // まだ何も走っていなければ（通信エラー等で初期読み込みに失敗した場合）念のため取得し直す
    if (!allRecordsCache) {
      loader.style.display = "flex";
      document.getElementById("loaderText").textContent = "データを読み込み中...";
      await loadAllRecordsInBackground();
    }
    const records = filterRecordsClientSide(allRecordsCache, { client, keyword, startDate, endDate, unscheduledOnly, workContentFilter, workerFilter, managerFilter });
    displayResults(records);
    loader.style.display = "none";
    btn.disabled = false;
    resultsDiv.style.opacity = "1";
    // 検索結果が1件以上あれば、結果が見える位置まで少し下にスクロールする
    if (shouldScroll && records && records.length > 0) {
      scrollToSearchResults();
    }
  } catch (err) {
    loader.style.display = "none";
    btn.disabled = false;
    resultsDiv.innerHTML = '<p style="color:red; text-align:center;">エラー: ' + err.message + '</p>';
    console.error("❌ 検索エラー:", err);
    Swal.fire({
      icon: 'error',
      title: '検索中にエラーが発生しました',
      html: `<strong>${err.message}</strong><br><br><small>詳細はコンソール（F12）を確認してください</small>`,
      confirmButtonText: '了解'
    });
  }
}

// 検索結果（件数表示）が画面上部に少し余裕を持って見える位置までスムーズにスクロールする
function scrollToSearchResults() {
  const target = document.getElementById("searchCount");
  if (!target) return;
  // 描画が完了してから位置を計算するため、わずかに遅延させる
  setTimeout(() => {
    const rect = target.getBoundingClientRect();
    const targetY = window.pageYOffset + rect.top - 80;
    window.scrollTo({ top: Math.max(targetY, 0), behavior: "smooth" });
  }, 50);
}

function filterRecordsClientSide(records, { client, keyword, startDate, endDate, unscheduledOnly, workContentFilter = [], workerFilter = [], managerFilter = [] }) {
  const nClient = normalizeText(client);
  const nKeyword = normalizeText(keyword);
  const nYomiKeyword = normalizeYomi(keyword);
  const sDate = startDate ? new Date(startDate) : null;
  const eDate = endDate ? new Date(endDate) : null;
  const noDateFilter = !sDate && !eDate && !unscheduledOnly;
  const searchStart = sDate || new Date("1900-01-01");
  const searchEnd = eDate || new Date("2099-12-31");

  return records.filter(r => {
    if (nClient && normalizeText(r["発注元"]) !== nClient) return false;

    // 担当者フィルター（複数選択・OR条件）：何も選択されていなければ絞り込まず全件対象。
    if (managerFilter.length > 0 && !managerFilter.includes(String(r["担当者"] || "").trim())) return false;

    const workSetIndices = getRecordWorkSetIndices(r);

    // 工事内容フィルター（複数選択・OR条件）：
    // 何も選択されていなければ絞り込まず全件対象。選択されている場合は、
    // 案件が持つ複数の工事セットのうち、いずれか1つでも選択内容に一致すればヒット。
    if (workContentFilter.length > 0) {
      const hasMatchedContent = workSetIndices.some(n => workContentFilter.includes(String(r[`工事内容${n}`] || "").trim()));
      if (!hasMatchedContent) return false;
    }

    // 工事担当者フィルター（複数選択・OR条件）：
    // 各工事セットの担当者はカンマ区切りで複数入っているため、そのいずれかが選択リストに含まれればヒット。
    if (workerFilter.length > 0) {
      const hasMatchedWorker = workSetIndices.some(n => {
        const names = String(r[`工事担当者${n}`] || "").split(",").map(s => s.trim()).filter(Boolean);
        return names.some(name => workerFilter.includes(name));
      });
      if (!hasMatchedWorker) return false;
    }

    let isDateMatched = false;
    if (unscheduledOnly) {
      // 施工日（開始）が1つも入っていない案件のみ対象にする
      const hasAnyDate = workSetIndices.some(n => {
        const v = r[`施工日${n}開始`];
        return v && String(v).trim() !== "";
      });
      isDateMatched = !hasAnyDate;
    } else if (noDateFilter) {
      // 日付範囲・チェックボックスとも未指定の場合は、日付で絞り込まず全件を対象にする
      isDateMatched = true;
    } else {
      // 各工事セットの施工期間［開始〜終了］と検索期間が少しでも重なっていればヒット
      isDateMatched = workSetIndices.some(n => {
        const vStart = r[`施工日${n}開始`];
        if (!vStart) return false;
        const dStart = new Date(String(vStart).split("T")[0]);
        if (isNaN(dStart.getTime())) return false;
        const vEnd = r[`施工日${n}終了`];
        const dEndRaw = (vEnd && String(vEnd).trim() !== "") ? new Date(String(vEnd).split("T")[0]) : dStart;
        const dEnd = isNaN(dEndRaw.getTime()) ? dStart : dEndRaw;
        return dStart <= searchEnd && dEnd >= searchStart;
      });
    }
    if (!isDateMatched) return false;

    if (nKeyword) {
      // 検索対象：No・案件名・現場住所・施主名（通常の文字列照合）＋ 施主名よみ（ひらがな照合）
      const fullText = normalizeText(String(r["No"] || "") + String(r["案件名"] || "") + String(r["現場住所"] || "") + String(r["施主名"] || ""));
      const yomiText = normalizeYomi(r["施主名よみ"]);
      if (!fullText.includes(nKeyword) && !yomiText.includes(nYomiKeyword)) return false;
    }
    return true;
  });
}

function buildDataSourceUrlFront(media, systemId) {
  if (!media || !systemId) return null;
  const cfg = MEDIA_LINK_MAP_FRONT[String(media).trim()];
  if (!cfg) return null;
  return `${cfg.prefix}${String(systemId).trim()}`;
}

// MAPボタン用：GAS側 buildEventDescription() 内のMAPリンク生成ロジックと同一内容にしている
// （緯度経度があればそれを優先、無ければ住所でGoogleマップ検索する）。
// カレンダー説明欄のMAPリンクと同じ行き先になるよう、どちらか一方だけ変更した場合は
// もう一方も必ず合わせて更新すること。
function buildMapUrlFront(latLng, address) {
  if (latLng) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(latLng).trim())}`;
  } else if (address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(address).trim())}`;
  }
  return null;
}

// resetPage=true（既定）の場合は1ページ目から表示し直す。
// ページ送りボタンからの再描画時のみfalseを渡す。
function displayResults(records, resetPage = true) {
  currentSearchResults = records || [];
  if (resetPage) currentSearchPage = 1;
  renderCurrentResultsPage();
}

function renderCurrentResultsPage() {
  const container = document.getElementById("results");
  const countDiv = document.getElementById("searchCount");
  const topPagerDiv = document.getElementById("searchPagerTop");
  container.innerHTML = "";
  if (topPagerDiv) topPagerDiv.innerHTML = "";
  const records = currentSearchResults;
  if (!records || records.length === 0) {
    countDiv.innerHTML = "条件に一致する案件は見つかりませんでした。";
    return;
  }

  const totalCount = records.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / RESULTS_PAGE_SIZE));
  if (currentSearchPage > totalPages) currentSearchPage = totalPages;
  if (currentSearchPage < 1) currentSearchPage = 1;
  const startNo = (currentSearchPage - 1) * RESULTS_PAGE_SIZE;
  const endNo = Math.min(startNo + RESULTS_PAGE_SIZE, totalCount);

  countDiv.innerHTML = `<span style="color:var(--primary); font-size: 18px;">${totalCount}</span> 件を表示中`
    + (totalPages > 1 ? `（${startNo + 1}〜${endNo}件目 / ${currentSearchPage} / ${totalPages}ページ）` : '');

  // -----------------------------------------------------------------
  // 【変更箇所】配列の末尾から先頭に向かって逆順に処理し、現在のページ範囲（50件分）だけ描画する
  // （並び順は従来通り「新しい方が先」を維持したままページングする）
  // -----------------------------------------------------------------
  let displayedCount = 0;
  for (let index = records.length - 1; index >= 0; index--) {
    if (displayedCount >= endNo) break;
    if (displayedCount < startNo) { displayedCount++; continue; }
    displayedCount++;
    const record = records[index];

    const item = document.createElement("div");
    item.className = "result-item";
    const parseDate = parseDateForInput;
    const savedBadges = String(record.保存済みファイル || "").split(",").map(s => s.trim()).filter(Boolean);

    let badgeHtml = '<div style="margin-top:6px; margin-bottom:2px; display:flex; flex-wrap:wrap; gap:4px; align-items:center;">';
    let hasBadge = false;
    for (let code in FILE_TYPES_DEF) {
      if (savedBadges.includes(code)) {
        badgeHtml += `<span class="file-badge">${FILE_TYPES_DEF[code].name}</span>`;
        hasBadge = true;
      }
    }
    badgeHtml += '</div>';

    // ドライブフォルダリンクの組み立て
    // ※ ボタンが5つ（資料・共有・Web・メール・MAP）に増えたため、共通クラス .action-btn で
    //   padding・font-sizeをさらに詰めたデザインに統一している（デザインの方向性は維持）。
    let driveLinkHtml = '';
    const folderUrl = String(record.添付資料 || "").trim();
    if (folderUrl) {
      driveLinkHtml = `
      <a href="${escapeAttr(folderUrl)}" target="_blank" rel="noopener noreferrer" class="drive-folder-link action-btn action-btn-yellow" onclick="event.stopPropagation();">
        <span class="material-symbols-outlined" style="font-size:22px; color:#ca8a04">folder_open</span><span style="font-weight:bold; color:#a16207;">資 料</span>
      </a>`;
    } else {
      driveLinkHtml = `
      <div class="drive-folder-link-disabled action-btn">
        <span class="material-symbols-outlined cloud-icon" style="font-size:22px !important; width:22px; height:22px;">folder_off</span><span>資料無し</span>
      </div>`;
    }
    // 案件共有ボタン
    // ※ URLにはNo（連番）ではなく、他案件を推測されないようハッシュ化された共有トークンを使う。
    //   共有方法選択ページ（share.html）を、tokenだけ付けて新しいタブで開く。
    //   ドメインはハードコードせず、/api/config から取得した appEnvConfig.shareAppDomain を使う
    //   （以前ハードコードしていたことで、プレビュードメインのまま放置される事故が起きたため）。
    // 【注記】クリック時の処理（openShareApp）で share.html を開くため、
    //   <a> ではなく <button onclick> を使っている。
    const shareToken = record.共有トークン || "";
    const shareDomainReady = shareToken && appEnvConfig && appEnvConfig.shareAppDomain;
    const shareButtonHtml = shareDomainReady ? `
    <button type="button" onclick="event.stopPropagation(); openShareApp('${escapeForJsAttr(shareToken)}', '${escapeForJsAttr(appEnvConfig.shareAppDomain)}')" class="drive-folder-link action-btn action-btn-green">
      <span class="material-symbols-outlined" style="font-size:22px; color:#22c55e">share</span><span style="font-weight:bold; color:#16a34a;">共 有</span>
    </button>` : "";

    // Webボタン（データ元サイトリンク）：カレンダーの説明欄に載せているものと同じURLを組み立てる。
    // GAS側 buildDataSourceUrl() と同一のロジック（受注媒体ごとのURLパターン＋システムID）をフロントでも再現する。
    const dataSourceUrl = buildDataSourceUrlFront(record.受注媒体, record.システムID);
    const webButtonHtml = dataSourceUrl ? `
    <a href="${escapeAttr(dataSourceUrl)}" target="_blank" rel="noopener noreferrer" class="drive-folder-link action-btn action-btn-blue" onclick="event.stopPropagation();">
      <span class="material-symbols-outlined" style="font-size:22px; color:#3b82f6">public</span><span style="font-weight:bold; color:#2563eb;">Web</span>
    </a>` : "";

    // メールボタン（データ元メール）：受注媒体に関係なく、メールIDに値があれば表示。
    // 【注記】以前、Android版Gmailアプリでのディープリンク不具合対策として
    // GAS側でパーマリンクを取得する方式を試みたが、この「メールID」列の値は
    // GmailのURLバーからコピーしたWeb画面専用の内部ID（FMfcg...形式）であり、
    // Gmail公式APIのメッセージID体系とは互換性が無く、GmailApp.getMessageById()
    // では使えないことが判明したため断念した。元の直接リンク方式に戻している。
    const dataSourceMailUrl = record.メールID
      ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(String(record.メールID).trim())}`
      : "";
    const mailButtonHtml = dataSourceMailUrl ? `
    <a href="${dataSourceMailUrl}" target="_blank" rel="noopener noreferrer" class="drive-folder-link action-btn action-btn-purple" onclick="event.stopPropagation();">
      <span class="material-symbols-outlined" style="font-size:22px; color:#a855f7">mail</span><span style="font-weight:bold; color:#9333ea;">mail</span>
    </a>` : "";

    // MAPボタン：カレンダーの説明欄に載せている現場MAPリンクと同じ行き先（現場緯度経度優先、無ければ現場住所）。
    const mapUrl = buildMapUrlFront(record.現場緯度経度, record.現場住所);
    const mapButtonHtml = mapUrl ? `
    <a href="${mapUrl}" target="_blank" rel="noopener noreferrer" class="drive-folder-link action-btn action-btn-red" onclick="event.stopPropagation();">
      <span class="material-symbols-outlined" style="font-size:22px; color:#ef4444">location_on</span><span style="font-weight:bold; color:#dc2626;">MAP</span>
    </a>` : "";

    let workScheduleHtml = '<div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">';
    let hasAnyWork = false;
    getRecordWorkSetIndices(record).forEach(i => {
      const wContent = record['工事内容' + i];
      const wStart = record['施工日' + i + '開始'];
      const wEnd = record['施工日' + i + '終了'];
      const wWorkerCsv = record['工事担当者' + i] || '';
      const wWorker = wWorkerCsv.split(',').map(s => s.trim()).filter(Boolean).join('、');
      if (wContent || wStart || wEnd || wWorkerCsv) {
        hasAnyWork = true;
        const fmt = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(String(d).split("T")[0])) ? String(d).split("T")[0].replace(/-/g, '/') : "";
        let dateLabel;
        if (wStart && wEnd && wStart !== wEnd) {
          dateLabel = `${fmt(wStart)}${getWeekday(wStart)} 〜 ${fmt(wEnd)}${getWeekday(wEnd)}`;
        } else if (wStart) {
          dateLabel = `${fmt(wStart)}${getWeekday(wStart)}`;
        } else {
          dateLabel = "未定";
        }
        workScheduleHtml += `
          <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:14px; align-items:center; background:#f1f5f9; padding:6px 12px; border-radius:6px; width:fit-content;">
            <span style="display:flex; align-items:center; gap:4px; color:#555;"><span class="material-symbols-outlined" style="font-size:16px;">calendar_month</span> ${dateLabel}</span>
            <span style="display:flex; align-items:center; gap:4px; font-weight:bold; color:#334155;"><span class="material-symbols-outlined" style="font-size:16px; color:var(--primary);">construction</span> ${escapeHtml(wContent) || "内容未定"}</span>
            ${wWorker ? `<span style="display:flex; align-items:center; gap:4px; color:#0284c7; background:#e0f2fe; padding:2px 8px; border-radius:4px; font-size:12px; font-weight:bold;"><span class="material-symbols-outlined" style="font-size:14px;">person</span> ${escapeHtml(wWorker)}</span>` : ''}
          </div>`;
      }
    });
    // 検査日の表示：工事日と紛れないよう、配色（オレンジ系）とアイコンを変えて一目で区別できるようにする
    const inspRaw = record['検査日'];
    if (inspRaw) {
      hasAnyWork = true;
      const inspDatePart = String(inspRaw).split('T')[0];
      const inspTimePart = String(inspRaw).includes('T') ? String(inspRaw).split('T')[1] : '';
      const fmtInsp = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d)) ? d.replace(/-/g, '/') : "";
      let inspLabel = `${fmtInsp(inspDatePart)}${getWeekday(inspDatePart)}`;
      if (inspTimePart) inspLabel += ` ${inspTimePart.substring(0, 5)}`;
      workScheduleHtml += `
        <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:14px; align-items:center; background:#fff7ed; padding:6px 12px; border-radius:6px; width:fit-content; border:1px solid #fed7aa;">
          <span style="display:flex; align-items:center; gap:4px; color:#c2410c; font-weight:bold;"><span class="material-symbols-outlined" style="font-size:16px;">fact_check</span> 検査日: ${inspLabel}</span>
        </div>`;
    }
    if(!hasAnyWork) workScheduleHtml += `<div style="font-size:14px; color:#94a3b8;">📅 工事予定なし</div>`;
    workScheduleHtml += '</div>';

    // 担当者セレクトボックスの生成（※初期化処理で上書きするためベースのみ生成）
    let staffOptionsHtml = '<option value="">選択してください</option>';

    item.innerHTML = `
      <div class="result-summary" onclick="toggleOuterAccordion(this)">
        <div class="summary-info" style="flex:1; padding-right:12px;">
          <div class="row-meta">
            <span class="badge-no">No.${record.No}</span>
            <span style="font-size:14px; color:var(--text-sub); font-weight:bold;">${escapeHtml(formatDisplayText(record.発注元))}</span>
            <span style="font-size:14px; color:#475569; font-weight:bold;">👤 ${escapeHtml(record.担当者) || '－'}</span>
            <span style="font-size:14px; color:#64748b; margin-left:auto; font-weight:bold; padding-right:10px;">受注媒体: ${escapeHtml(record.受注媒体) || '－'}</span>
          </div>
          <div class="anken-title">${escapeHtml(record.案件名)}</div>
          ${workScheduleHtml}
          ${badgeHtml}
          <div class="action-btn-row">
            ${driveLinkHtml}
            ${shareButtonHtml}
            ${webButtonHtml}
            ${mailButtonHtml}
            ${mapButtonHtml}
          </div>
        </div>
        <span class="material-symbols-outlined expand-icon" style="transition: transform 0.2s; color:#94a3b8; font-size:30px;">expand_more</span>
      </div>
      <div class="result-details">
        <div class="detail-card">

          <div class="field-row">

            <div class="data-row-input field-projecttype" style="flex:1;">
              <label>案件種別</label>
              <select id="addProjectTypeSelect_${record.No}" onchange="toggleNewInput(this, 'newProjectTypeInputGroup_${record.No}')">
                ${createOptionsHtml(appConfig.projectTypeList, record['案件種別'] || '', '案件種別')}
              </select>
              <div id="newProjectTypeInputGroup_${record.No}" style="display: none; margin-top: 3px;">
                <input type="text" id="newProjectTypeInput_${record.No}" placeholder="新規案件種別">
              </div>
            </div>
          </div>

          <div class="data-row-input">
            <label>施主名</label>
            <input type="text" id="施主名_${record.No}" value="${escapeAttr(record.施主名 || '')}">
          </div>

          <div class="data-row-input">
            <label>現場緯度経度</label>
            <input type="text" id="現場緯度経度_${record.No}" value="${escapeAttr(record.現場緯度経度 || '')}" style="width: 100%;">
          </div>

          <div class="data-row-input"><label>現場住所</label>
            <div class="voice-input-wrapper">
              <input type="text" id="現場住所_${record.No}" value="${escapeAttr(record.現場住所 || '')}">
              <button type="button" class="btn btn-sm" onclick="startVoiceInput(this)">
                <span class="material-symbols-outlined">mic</span>
              </button>
            </div>
          </div>

          <div class="inner-accordion" style="margin-top:4px; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden;">
            <div class="inner-accordion-summary" onclick="toggleInnerAccordion(this)" style="cursor:pointer; background:#e2e8f0; padding:12px; font-weight:bold; display:flex; justify-content:space-between; align-items:center; font-size:14px; color:#334155;">
              <span style="display:flex; align-items:center; gap:6px;"><span class="material-symbols-outlined" style="font-size:18px;">local_parking</span> 駐車場情報</span>
              <span class="material-symbols-outlined inner-expand-icon" style="transition:transform 0.2s;">expand_more</span>
            </div>
            <div class="inner-accordion-details" style="display:none; padding:16px; background:#f8fafc; border-top:1px solid #cbd5e1;">
              <div class="data-row-input" style="margin-bottom:14px;">
                <label>駐車場住所</label>
                <div class="voice-input-wrapper">
                  <input type="text" id="駐車場住所_${record.No}" value="${escapeAttr(record.駐車場住所 || '')}">
                  <button type="button" class="btn btn-sm" onclick="startVoiceInput(this)">
                    <span class="material-symbols-outlined">mic</span>
                  </button>
                </div>
              </div>
              <div class="data-row-input">
                <label>駐車場緯度経度</label>
                <input type="text" id="駐車場緯度経度_${record.No}" value="${escapeAttr(record.駐車場緯度経度 || '')}" style="width: 100%;">
              </div>
            </div>
          </div>

          <div class="field-row">
            <div class="data-row-input" style="flex: 1;"><label>延床面積</label>
              <input type="text" id="延床面積_${record.No}" value="${escapeAttr(record.延床面積 || '')}">
            </div>

            <div class="data-row-input" style="flex: 1;"><label>キーBOX</label>
              <input type="text" id="キーBOX_${record.No}" value="${escapeAttr(record.キーBOX || '')}">
            </div>
          </div>

          <div class="field-row">
            <div class="data-row-input" style="flex: 1;"><label>担当者</label>
              <select id="editStaffSelect_${record.No}" data-client="${escapeAttr(record.発注元)}" onchange="handleEditStaffChange(this, '${record.No}')">
                ${staffOptionsHtml}
              </select>
              <div id="newEditStaffGroup_${record.No}" style="display:none; margin-top:3px;">
                <input type="text" id="newEditStaffInput_${record.No}" placeholder="新規担当者名">
              </div>
            </div>

            <div class="data-row-input" style="flex: 1;"><label>連絡先</label>
              <input type="text" id="editPhoneInput_${record.No}" value="${escapeAttr(record.連絡先 || '')}">
            </div>
          </div>
        </div>

        <div>
          ${buildEditWorkFieldsContainerHtml(record)}
        </div>

        <div class="form-group" style="margin-top:14px;">
          <label style="font-weight:bold; font-size:14px; color:var(--text-sub);">検査日（時刻指定）</label>
          <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 8px;">
            <input type="date" id="検査日_${record.No}" value="${parseDate(record.検査日)}" onclick="this.showPicker?.()" style="cursor:pointer;">
            <select id="検査日時_${record.No}" onchange="handleInspectionHourChange(this, '検査日分_${record.No}')" style="padding: 10px; border: 2px solid var(--border); border-radius: 8px; box-sizing: border-box;">
              <option value="">時</option>
            </select>
            <select id="検査日分_${record.No}" style="padding: 10px; border: 2px solid var(--border); border-radius: 8px; box-sizing: border-box;">
              <option value="">分</option>
            </select>
          </div>
        </div>

        <div class="form-group" style="margin-top:14px;">
          <label style="font-weight:bold; font-size:14px; color:var(--text-sub);">備 考</label>
          <div class="voice-input-wrapper">
            <textarea id="備考_${record.No}" rows="3" style="width:100%; border:2px solid var(--border); border-radius:8px; padding:12px;">${escapeHtml(record.備考 || '')}</textarea>
            <button type="button" class="btn btn-sm" onclick="startVoiceInput(this)">
              <span class="material-symbols-outlined">mic</span>
            </button>
          </div>
        </div>

        <div class="inner-accordion" style="margin-top:16px; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden;">
          <div class="inner-accordion-summary" onclick="toggleInnerAccordion(this)" style="cursor:pointer; background:#e2e8f0; padding:12px; font-weight:bold; display:flex; justify-content:space-between; align-items:center; font-size:14px; color:#334155;">
            <span style="display:flex; align-items:center; gap:6px;"><span class="material-symbols-outlined" style="font-size:18px;">admin_panel_settings</span> システム管理項目他)</span>
            <span class="material-symbols-outlined inner-expand-icon" style="transition:transform 0.2s;">expand_more</span>
          </div>
          <div class="inner-accordion-details" style="display:none; padding:16px; background:#f8fafc; border-top:1px solid #cbd5e1;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="data-row-input"><label>システムID</label><input type="text" id="システムID_${record.No}" value="${escapeAttr(record.システムID || '')}"></div>
              <div class="data-row-input"><label>メールID</label><input type="text" id="メールID_${record.No}" value="${escapeAttr(record.メールID || '')}"></div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
              <div class="data-row-input"><label>着工日</label><input type="date" id="着工日_${record.No}" value="${parseDate(record.着工日)}"></div>
              <div class="data-row-input"><label>完成日</label><input type="date" id="完成日_${record.No}" value="${parseDate(record.完成日)}"></div>
              <div class="data-row-input"><label>引渡日</label><input type="date" id="引渡日_${record.No}" value="${parseDate(record.引渡日)}"></div>
            </div>
          </div>
        </div>

        <div class="uploadbox" id="uploadBox_${record.No}" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleFileDrop(event, '${record.No}')">
          <span class="material-symbols-outlined cloud-icon">cloud_upload</span>
          <div class="drag-drop-text" style="font-weight:bold; margin-top:6px;">ファイルをここにドラッグ＆ドロップ</div>
          <div class="drag-drop-text" style="font-size:12px; color:var(--text-sub); margin-bottom:10px;">または</div>
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('fileInput_${record.No}').click()">ファイルを選択</button>
          <input type="file" id="fileInput_${record.No}" multiple style="display:none;" onchange="handleFileSelect(event, '${record.No}')">
          <div id="fileList_${record.No}" style="margin-top:10px;"></div>
        </div>

        <div style="display:flex; gap:10px; margin-top:20px;">
          <button class="btn btn-success" onclick="saveRecord('${record.No}', ${record.rowNumber}, this)" style="padding: 10px 24px;">
            <span class="material-symbols-outlined">cloud_sync</span> 更新して保存
          </button>
        </div>
      </div>
    `;
    container.appendChild(item);

    // 工事担当者マルチセレクト（編集フォーム）を記録済みの値で初期化する
    initEditWorkFieldSelections(record);

    // 新規登録と同じ条件で担当者ドロップダウンを生成・初期化する処理
    const staffSelId = `editStaffSelect_${record.No}`;
    updateManagersByClient(record.発注元, staffSelId);

    const staffSelEl = document.getElementById(staffSelId);
    if (staffSelEl) {
      const currentStaff = (record.担当者 && record.担当者 !== "undefined" && record.担当者 !== "null") ? record.担当者 : "";

      if (currentStaff) {
        let hasOption = Array.from(staffSelEl.options).some(opt => opt.value === currentStaff);
        if (!hasOption) {
          const newOpt = document.createElement("option");
          newOpt.value = currentStaff;
          newOpt.textContent = currentStaff;
          staffSelEl.insertBefore(newOpt, staffSelEl.lastElementChild);
        }
        const originalOnchange = staffSelEl.onchange;
        staffSelEl.onchange = null;
        staffSelEl.value = currentStaff; // ここでは onchange が発火しない
        staffSelEl.onchange = originalOnchange; // 復元
      }
    }

    // 1. 先にドロップダウンの選択肢（00〜23時、00〜45分など）を確実に生成する
    initializeInspectionTimeSelectsForRecord(record.No);
    // 2. 選択肢が存在する状態で、安全に既存の時刻をセットする
    if (record.検査日 && typeof record.検査日 === "string" && record.検査日.includes('T')) {
      const timeParts = record.検査日.split('T')[1];
      if (timeParts) {
        const [hour, minute] = timeParts.split(':');
        const hourSel = document.getElementById(`検査日時_${record.No}`);
        const minuteSel = document.getElementById(`検査日分_${record.No}`);

        if (hourSel && hour) {
          // 選択肢のvalue形式に合わせてセット（数字2桁、または生成関数のvalue仕様に合わせる）
          const targetHour = String(hour).padStart(2, '0');
          hourSel.value = hourSel.querySelector(`option[value*="${targetHour}"]`) ? hourSel.querySelector(`option[value*="${targetHour}"]`).value : targetHour;
        }
        if (minuteSel && minute) {
          const minuteVal = minute.substring(0, 2);
          const roundedMinute = Math.round(parseInt(minuteVal) / 15) * 15;
          const normalizedMinute = roundedMinute === 60 ? '00' : String(roundedMinute).padStart(2, '0');

          minuteSel.value = minuteSel.querySelector(`option[value*="${normalizedMinute}"]`) ? minuteSel.querySelector(`option[value*="${normalizedMinute}"]`).value : normalizedMinute;
        }
      }
    }
  }

  if (totalPages > 1) {
    renderResultsPagination(totalPages, topPagerDiv);
    renderResultsPagination(totalPages, container);
  }
}

function renderResultsPagination(totalPages, targetContainer) {
  if (!targetContainer) return;
  _pagerInstanceCounter++;
  const prevId = `pagerPrevBtn_${_pagerInstanceCounter}`;
  const nextId = `pagerNextBtn_${_pagerInstanceCounter}`;
  const nav = document.createElement("div");
  nav.style.cssText = "display:flex; justify-content:center; align-items:center; gap:12px; margin:12px 0; flex-wrap:wrap;";
  nav.innerHTML = `
    <button type="button" class="btn btn-secondary" id="${prevId}" style="padding:10px 18px;">
      <span class="material-symbols-outlined">chevron_left</span> 前へ
    </button>
    <span style="font-weight:bold; color:#475569;">${currentSearchPage} / ${totalPages} ページ</span>
    <button type="button" class="btn btn-secondary" id="${nextId}" style="padding:10px 18px;">
      次へ <span class="material-symbols-outlined">chevron_right</span>
    </button>
  `;
  targetContainer.appendChild(nav);

  const prevBtn = document.getElementById(prevId);
  const nextBtn = document.getElementById(nextId);
  if (prevBtn) {
    if (currentSearchPage <= 1) { prevBtn.disabled = true; prevBtn.style.opacity = "0.5"; prevBtn.style.cursor = "default"; }
    prevBtn.onclick = () => goToSearchResultsPage(currentSearchPage - 1);
  }
  if (nextBtn) {
    if (currentSearchPage >= totalPages) { nextBtn.disabled = true; nextBtn.style.opacity = "0.5"; nextBtn.style.cursor = "default"; }
    nextBtn.onclick = () => goToSearchResultsPage(currentSearchPage + 1);
  }
}

// 指定ページへ移動して再描画し、結果の先頭が見える位置までスクロールする
function goToSearchResultsPage(page) {
  currentSearchPage = page;
  renderCurrentResultsPage();
  scrollToSearchResults();
}

// 検索条件をリセット
window.clearSearchFilters = function() {
  document.getElementById("filterClient").value = "";
  document.getElementById("filterStartDate").value = "";
  document.getElementById("filterEndDate").value = "";
  document.getElementById("searchValue").value = "";
  document.getElementById("filterUnscheduledOnly").checked = false;
  document.getElementById("filterStartDate").disabled = false;
  document.getElementById("filterEndDate").disabled = false;
  resetFilterMultiSelect("filterWorkContent");
  resetFilterMultiSelect("filterWorker");
  resetFilterMultiSelect("filterManager");

  currentSearchResults = [];
  currentSearchPage = 1;
  document.getElementById("results").innerHTML = "";
  document.getElementById("searchPagerTop").innerHTML = "";
  document.getElementById("searchCount").innerHTML = "";
};

// 詳細検索エリア（工事内容・工事担当者・施工日・施工日未設定）の開閉
window.toggleAdvancedSearch = function() {
  const area = document.getElementById("advancedSearchArea");
  const icon = document.getElementById("advancedSearchIcon");
  const btn = document.getElementById("toggleAdvancedSearchBtn");
  if (!area) return;
  const isOpen = area.style.display !== "none";
  area.style.display = isOpen ? "none" : "block";
  if (icon) icon.style.transform = isOpen ? "rotate(0deg)" : "rotate(180deg)";
  if (btn) {
    btn.style.background = isOpen ? "#f1f5f9" : "#e0edff";
    btn.style.color = isOpen ? "#475569" : "var(--primary)";
    btn.style.borderColor = isOpen ? "#cbd5e1" : "var(--primary)";
  }
};

// ：開始日が変更されたら終了日に自動代入
window.handleStartDateChange = function() {
  const startDate = document.getElementById("filterStartDate").value;
  const endDate = document.getElementById("filterEndDate").value;
  // 開始日が入力され、終了日が空の場合は開始日と同じ値を代入
  if (startDate && !endDate) {
    document.getElementById("filterEndDate").value = startDate;
  }
};

// 「施工日未設定の案件のみ表示」チェック時は日付範囲入力を無効化する
window.handleUnscheduledOnlyChange = function() {
  const checked = document.getElementById("filterUnscheduledOnly").checked;
  const startEl = document.getElementById("filterStartDate");
  const endEl = document.getElementById("filterEndDate");
  startEl.disabled = checked;
  endEl.disabled = checked;
  if (checked) {
    startEl.value = "";
    endEl.value = "";
  }
};

// 外側のアコーディオン：開いて画面の一番上まで引っ張り上げる
window.toggleOuterAccordion = function(el) {
  const item = el.parentElement;
  item.classList.toggle('is-open');

  if (item.classList.contains('is-open')) {
    setTimeout(() => {
      // タップされたカードの現在の位置を計算
      const rect = el.getBoundingClientRect();
      // 画面の最上部から200px下までスクロール
      const targetY = window.pageYOffset + rect.top + 200;
      window.scrollTo({
        top: targetY,
        behavior: "smooth" // 滑らかに動かします
      });
    }, 150);
  }
};

// 内側のアコーディオン
window.toggleInnerAccordion = function(el) {
  const details = el.nextElementSibling;
  const icon = el.querySelector('.inner-expand-icon');

  if (details.style.display === 'none' || !details.style.display) {
    details.style.display = 'block';
    if (icon) icon.style.transform = 'rotate(180deg)';
  } else {
    details.style.display = 'none';
    if (icon) icon.style.transform = 'rotate(0deg)';
  }
};
