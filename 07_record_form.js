// =====================================================================
// 07_record_form.js ― 案件の新規登録・編集フォーム
// ---------------------------------------------------------------------
// 新規登録モーダル、案件の保存（新規・更新の2段階処理）、工事予定・担当割当セットの入力フォーム
// （新規・編集共通）、外部データの貼り付け連携。
// 読み込み順：index.html の <script> タグの順（01 → 07）。通常の<script>のため、
// 各ファイルで宣言した変数・関数は、他のファイルからそのまま参照できる。
// =====================================================================

window.updateInputWeekday = function(inputEl, spanId) {
  const span = document.getElementById(spanId);
  if (span) span.textContent = getWeekday(inputEl.value);
};

// 施工予定日「開始」が変更されたときの処理（新規登録・編集フォーム共通）
// ・開始日の曜日表示を更新
// ・終了日が未入力（空欄）の場合のみ、終了日に開始日と同じ日付を自動セットする
//   （終了日に既に値が入っている場合は、ユーザーが意図して設定した値を上書きしない）
window.handleWorkStartDateChange = function(startEl, endElId, startSpanId, endSpanId) {
  updateInputWeekday(startEl, startSpanId);
  const endEl = document.getElementById(endElId);
  if (endEl && !endEl.value && startEl.value) {
    endEl.value = startEl.value;
    updateInputWeekday(endEl, endSpanId);
  }
};

// =================================================================
// 工事予定・担当割当セットのHTML生成（編集フォーム用）
// レコードに実際に値が入っているセット番号だけ初期表示し、
// 「追加」ボタンで無制限にセットを増やせる。
// =================================================================
const editWorkCounts = {}; // record.No -> 現在表示中の最大セット番号

// 描画した時点で存在していた最大セット番号。
// 「×」で削除されたセットに空値を送り、シート・カレンダーから消すために使う
const editWorkInitialMax = {};

function getRecordWorkSetIndices(record) {
  const indices = new Set();
  Object.keys(record).forEach(k => {
    const m = k.match(/^工事内容(\d+)$/);
    if (m) indices.add(parseInt(m[1], 10));
  });
  return Array.from(indices).sort((a, b) => a - b);
}

function getRecordActiveWorkSetIndices(record) {
  const all = getRecordWorkSetIndices(record);
  const active = all.filter(i => record[`工事内容${i}`] || record[`施工日${i}開始`] || record[`施工日${i}終了`] || record[`工事担当者${i}`]);
  return active.length ? active : [1];
}

// =================================================================
// 工事予定・担当割当セットの入力フォーム（新規登録・編集で共通）
// -----------------------------------------------------------------
// 「施工予定日（開始〜終了）」「工事内容」「工事担当者」の1セット分のHTMLを、
// 新規登録モーダルと案件の編集フォームの両方で、同じ見た目（新規登録の見た目）で生成する。
// セット数に上限は無い。追加・削除は、下の各ハンドラで行う。
// 新規登録と編集では「要素IDの付け方」だけが異なるため、IDは WORK_SET_ID_SCHEME で切り替える
// （保存処理 handleCreateSubmit / saveRecord がこのIDで値を読むため、変更時は両方を確認すること）。
// =================================================================
const WORK_SET_ID_SCHEME = {
  create: i => ({
    group: `addWorkGroup_${i}`,
    start: `newWorkStart_${i}`,
    end: `newWorkEnd_${i}`,
    startSpan: `newDaySpanStart_${i}`,
    endSpan: `newDaySpanEnd_${i}`,
    content: `newWorkContent_${i}`,
    contentNewGroup: `newWorkContentInputGroup_${i}`,
    contentNewInput: `newWorkContentInput_${i}`,
    workerUid: `new_${i}`
  }),
  edit: (recordNo, i) => ({
    group: `editWorkGroup_${recordNo}_${i}`,
    start: `editWorkStart_${recordNo}_${i}`,
    end: `editWorkEnd_${recordNo}_${i}`,
    startSpan: `editDaySpanStart_${recordNo}_${i}`,
    endSpan: `editDaySpanEnd_${recordNo}_${i}`,
    content: `editWorkContent_${recordNo}_${i}`,
    contentNewGroup: `newEditWorkContentGroup_${recordNo}_${i}`,
    contentNewInput: `newEditWorkContentInput_${recordNo}_${i}`,
    workerUid: `edit_${recordNo}_${i}`
  })
};

// 工事セット1つ分のHTMLを返す。
//   i                  : セット番号（1始まり）
//   isFirst            : 1セット目か（1セット目は「×」削除ボタンと区切り線を付けない）
//   ids                : WORK_SET_ID_SCHEME で作った要素ID一式
//   useNames           : trueなら name 属性を付ける（新規登録フォームの FormData 送信用）
//   removeOnclick      : 「×」ボタンのonclick（JS文字列）
//   contentOptionsHtml : 工事内容セレクトの <option> 一覧
//   values             : 初期値 { start, end }（編集フォーム用。yyyy-MM-dd形式）
function buildWorkSetFormHtml({ i, isFirst, ids, useNames, removeOnclick, contentOptionsHtml, values = {} }) {
  const nameAttr = (name) => useNames ? ` name="${name}"` : "";
  const start = values.start || "";
  const end = values.end || "";

  const removeBtnHtml = isFirst ? '' : `
    <button type="button" onclick="${removeOnclick}" title="この工事予定を削除"
      style="position:absolute; top:14px; right:0; background:none; border:none; color:#ef4444; cursor:pointer; display:flex; align-items:center; padding:4px;">
      <span class="material-symbols-outlined" style="font-size:20px;">close</span>
    </button>`;
  const wrapperStyle = isFirst ? "" : "margin-top:20px; border-top:1px dashed #cbd5e1; padding-top:12px; position:relative;";

  // 横幅が半分になるため、ラベルは折り返しを許可する（共通CSSの nowrap を上書き）
  const labelStyle = "margin-bottom: 0px; align-items: center; gap: 2px; white-space: normal;";

  return `
    <div id="${ids.group}" class="work-input-group" style="${wrapperStyle} display:grid; grid-template-columns: 1fr; gap: 2px;">
      ${removeBtnHtml}
      <div class="form-group">
        <label style="margin-bottom: 0px; align-items: center; gap: 2px; margin-top:20px;">
          <span class="material-symbols-outlined" style="font-size: 18px;">calendar_month</span><span>施工予定日 ${i}（開始〜終了）</span>
        </label>
        <div style="display:flex; align-items:flex-start; gap:6px;">
          <div style="flex:1;">
            <input type="date"${nameAttr(`施工日${i}開始`)} id="${ids.start}" value="${start}" onchange="handleWorkStartDateChange(this, '${ids.end}', '${ids.startSpan}', '${ids.endSpan}')" onclick="this.showPicker && this.showPicker();" style="width:100%; margin-top: 2px; cursor:pointer;">
            <span id="${ids.startSpan}" style="font-size:12px; font-weight:bold; color:var(--primary);">${getWeekday(start)}</span>
          </div>
          <span style="color:#94a3b8; margin-top:12px;">〜</span>
          <div style="flex:1;">
            <input type="date"${nameAttr(`施工日${i}終了`)} id="${ids.end}" value="${end}" onchange="updateInputWeekday(this, '${ids.endSpan}')" onclick="this.showPicker && this.showPicker();" style="width:100%; margin-top: 2px; cursor:pointer;">
            <span id="${ids.endSpan}" style="font-size:12px; font-weight:bold; color:var(--primary);">${getWeekday(end)}</span>
          </div>
        </div>
      </div>

      <!-- 工事内容と工事担当者は横一列（画面幅に関わらず1:1） -->
      <div class="form-row-2col">
        <div class="form-group">
          <label style="${labelStyle}">
            <span class="material-symbols-outlined" style="font-size: 18px;">construction</span><span>工事内容 ${i}</span> <span class="badge-required">必須</span>
          </label>
          <select${nameAttr(`工事内容${i}`)} id="${ids.content}" required style="width:100%; margin-top: 2px;" onchange="toggleNewInput(this, '${ids.contentNewGroup}')">${contentOptionsHtml}</select>
          <div id="${ids.contentNewGroup}" style="display: none; margin-top: 2px;">
            <input type="text" id="${ids.contentNewInput}" placeholder="新規工事内容を入力" style="width:100%;">
          </div>
        </div>

        <div class="form-group">
          <label style="${labelStyle}">
            <span class="material-symbols-outlined" style="font-size: 18px;">supervisor_account</span><span>工事担当者 ${i}</span>
          </label>
          ${buildWorkerMultiSelectHtml(ids.workerUid, useNames ? `工事担当者${i}` : '')}
        </div>
      </div>
    </div>
  `;
}

// 新規登録モーダル用：工事セット1つ分
function buildCreateWorkSetHtml(i, isFirst) {
  return buildWorkSetFormHtml({
    i: i,
    isFirst: isFirst,
    ids: WORK_SET_ID_SCHEME.create(i),
    useNames: true,
    removeOnclick: "removeLastWorkField()",
    contentOptionsHtml: createOptionsHtml(appConfig.workContentList || [], "", "工事内容")
  });
}

// 編集フォーム用：工事セット1つ分（values: { content, start, end }）
function buildEditWorkSetHtml(recordNo, i, values, isFirst) {
  return buildWorkSetFormHtml({
    i: i,
    isFirst: isFirst,
    ids: WORK_SET_ID_SCHEME.edit(recordNo, i),
    useNames: false,
    removeOnclick: `removeEditWorkField('${recordNo}')`,
    contentOptionsHtml: createOptionsHtml(appConfig.workContentList || [], values.content || "", "工事内容"),
    values: values
  });
}

// 「工事予定・担当割当」の枠（見出し＋セット一覧＋追加ボタン）。新規登録・編集で共通。
//   containerId : セット一覧を入れる要素のID（追加・削除時にここへ出し入れする）
//   bodyHtml    : 初期表示するセットのHTML
//   addOnclick  : 「追加」ボタンのonclick（JS文字列）
function buildWorkSetsPanelHtml({ containerId, bodyHtml, addOnclick }) {
  return `
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <h3 style="margin: 0 0 12px 0; font-size: 18px; color: #475569; display: flex; align-items: center; gap: 6px;">
        工事予定・担当割当
      </h3>
      <div id="${containerId}">${bodyHtml}</div>
      <button type="button" class="btn" style="margin-top:16px; background:#e2e8f0; color:#334155; width:100%; border:1px dashed #cbd5e1; display:flex; align-items:center; justify-content:center; gap:4px; padding:8px;" onclick="${addOnclick}">
        <span class="material-symbols-outlined" style="font-size:18px;">add_circle</span> 施工日・工事内容・担当を追加
      </button>
    </div>
  `;
}

// ---- 新規登録モーダル：セットの追加・削除 ----

// 工事日程・内容・担当のセットを1つ追加する（上限なし）
window.showNextWorkField = function() {
  currentWorkCount++;
  const container = document.getElementById("dynamicWorkFieldsContainer");
  container.insertAdjacentHTML('beforeend', buildCreateWorkSetHtml(currentWorkCount, false));
  initWorkerMultiSelect(`new_${currentWorkCount}`, appConfig.userList, "");
};

// 直前に追加したセットを1つ削除する（1セット目は削除不可）
window.removeLastWorkField = function() {
  if (currentWorkCount <= 1) return;
  const group = document.getElementById(WORK_SET_ID_SCHEME.create(currentWorkCount).group);
  if (group) group.remove();
  currentWorkCount--;
};

// ---- 編集フォーム：セット一覧の生成・追加・削除 ----

// 編集フォームの「工事予定・担当割当」枠のHTMLを返す（値の入っているセットだけ初期表示する）
function buildEditWorkFieldsContainerHtml(record) {
  const indices = getRecordActiveWorkSetIndices(record);
  editWorkCounts[record.No] = indices[indices.length - 1];
  editWorkInitialMax[record.No] = indices[indices.length - 1];

  const bodyHtml = indices.map((i, idx) => buildEditWorkSetHtml(record.No, i, {
    content: record['工事内容' + i] || '',
    start: parseDateForInput(record['施工日' + i + '開始']),
    end: parseDateForInput(record['施工日' + i + '終了'])
  }, idx === 0)).join('');

  return buildWorkSetsPanelHtml({
    containerId: `editWorkFieldsContainer_${record.No}`,
    bodyHtml: bodyHtml,
    addOnclick: `addEditWorkField('${record.No}')`
  });
}

// 編集フォーム内の工事担当者マルチセレクトを、記録済みの選択値で初期化する
function initEditWorkFieldSelections(record) {
  getRecordActiveWorkSetIndices(record).forEach(i => {
    const cWorkerCsv = record['工事担当者' + i] || '';
    initWorkerMultiSelect(`edit_${record.No}_${i}`, appConfig.userList, cWorkerCsv);
  });
}

window.addEditWorkField = function(recordNo) {
  editWorkCounts[recordNo] = (editWorkCounts[recordNo] || 1) + 1;
  const i = editWorkCounts[recordNo];
  const container = document.getElementById(`editWorkFieldsContainer_${recordNo}`);
  if (!container) return;
  container.insertAdjacentHTML('beforeend', buildEditWorkSetHtml(recordNo, i, {}, false));
  initWorkerMultiSelect(`edit_${recordNo}_${i}`, appConfig.userList, '');
};

window.removeEditWorkField = function(recordNo) {
  const i = editWorkCounts[recordNo];
  if (!i || i <= 1) return;
  const group = document.getElementById(WORK_SET_ID_SCHEME.edit(recordNo, i).group);
  if (group) group.remove();
  editWorkCounts[recordNo] = i - 1;
};

// 新規登録モーダル初期展開
window.openCreateModal = function() {
  document.getElementById("createModal").style.display = "flex";
  // モーダル本体を必ず一番上からスタートさせる（前回のスクロール位置を引き継がない）
  const modalBody = document.getElementById("createModalBody");
  if (modalBody) modalBody.scrollTop = 0;
  document.getElementById("createProjectForm").reset();
  document.getElementById("createSubmitBtn").disabled = false;
  selectedFilesMap["NEW_PROJECT"] = [];
  document.getElementById("createFileList").innerHTML = "";

  // 駐車場情報セクションを毎回閉じた状態から開始する（前回開いたままの状態を引き継がない）
  document.querySelectorAll("#createProjectForm .inner-accordion-details").forEach(el => { el.style.display = "none"; });
  document.querySelectorAll("#createProjectForm .inner-expand-icon").forEach(el => { el.style.transform = "rotate(0deg)"; });

  initSelectWithOptions("addMediaSelect", appConfig.mediaList || [], "受注媒体");
  initSelectWithOptions("addProjectTypeSelect", appConfig.projectTypeList || [], "案件種別");
  initSelectWithOptions("addClientSelect", appConfig.clientList, "発注元");

  // 工事予定・担当割当セットを1セット目だけにリセットしてから初期化する
  currentWorkCount = 1;
  document.getElementById("createWorkSetsPanel").innerHTML = buildWorkSetsPanelHtml({
    containerId: "dynamicWorkFieldsContainer",
    bodyHtml: buildCreateWorkSetHtml(1, true),
    addOnclick: "showNextWorkField()"
  });
  initWorkerMultiSelect('new_1', appConfig.userList, "");

  //  新規登録モーダル内の担当者マスタ展開（ヘルパー適用版）
  const staffSel = document.getElementById("addStaffSelect");
  staffSel.innerHTML = '<option value="">選択してください</option>';
  (appConfig.managerList || []).forEach(s => {
    const sName = getStaffName(s);
    if (sName) staffSel.innerHTML += `<option value="${escapeAttr(sName)}">${escapeHtml(sName)}</option>`;
  });
  staffSel.innerHTML += `<option value="(新規担当者)" style="color:var(--primary); font-weight:bold;">(新規担当者)</option>`;

  document.getElementById("newMediaInputGroup").style.display = "none";
  document.getElementById("newProjectTypeInputGroup").style.display = "none";
  document.getElementById("newClientInputGroup").style.display = "none";
  document.getElementById("newStaffInputGroup").style.display = "none";

  // 外部データの貼り付け連携：このモーダルを開いている間だけ有効化する
  window.addEventListener('paste', handleProjectPaste);
};

window.closeCreateModal = function() {
  document.getElementById("createModal").style.display = "none";
  // 外部データの貼り付け連携：モーダルを閉じたら必ず無効化する
  window.removeEventListener('paste', handleProjectPaste);
};

// =================================================================
// 新規登録データ送信処理（完全自動ヨミ生成＆2段階レスポンス統合版）
// =================================================================
async function handleCreateSubmit(event) {
  event.preventDefault();
  const submitBtn = document.getElementById("createSubmitBtn");
  submitBtn.disabled = true; // 二重送信防止（連打対策）

  const form = event.target;
  const formData = new FormData(form);
  const payload = {};
  formData.forEach((value, key) => { payload[key] = value; });

  // -------------------------------------------------------------
  // 新規入力項目の取得・補正
  // 【ヨミ自動生成について】GAS側（updateMasterListGeneric・addClientStaffGroup）は
  // このisNewXxxのようなフラグには一切頼らず、マスタシートの既存データと照合して
  // 「本当に新規の値か」を自前で判定し、新規と判定した場合にのみヨミを自動生成する。
  // そのため、ここでは新規入力欄の値をpayloadへ差し替えるだけでよい。
  // -------------------------------------------------------------
  if (payload["受注媒体"] === "(新規受注媒体)") {
    payload["受注媒体"] = document.getElementById("newMediaInput").value.trim();
  }

  if (payload["案件種別"] === "(新規案件種別)") {
    payload["案件種別"] = document.getElementById("newProjectTypeInput").value.trim();
  }

  if (payload["発注元"] === "(新規発注元)") {
    payload["発注元"] = document.getElementById("newClientInput").value.trim();
  }

  if (payload["担当者"] === "(新規担当者)") {
    payload["担当者"] = document.getElementById("newStaffInput").value.trim();
  }

  // 工事担当者は複数選択ウィジェットのhidden inputに既にカンマ区切りで値が入っているため、
  // FormDataの時点で payload["工事担当者{i}"] に正しい値が入っている（追加の処理は不要）。
  for (let i = 1; i <= currentWorkCount; i++) {
    if (payload["工事内容" + i] === "(新規工事内容)") {
      payload["工事内容" + i] = document.getElementById(`newWorkContentInput_${i}`).value.trim();
    }
    // 施工予定日：終了日が開始日より前になっている場合は入れ替えて補正する
    const sVal = payload["施工日" + i + "開始"];
    const eVal = payload["施工日" + i + "終了"];
    if (sVal && eVal && eVal < sVal) {
      payload["施工日" + i + "開始"] = eVal;
      payload["施工日" + i + "終了"] = sVal;
    }
  }

  // -------------------------------------------------------------
  // 検査日＋時刻の結合処理
  // -------------------------------------------------------------
  const inspectionDate = document.getElementById("newInspectionDate").value;
  const inspectionHour = document.getElementById("newInspectionHour").value;
  const inspectionMinute = document.getElementById("newInspectionMinute").value;

  if (inspectionDate) {
    if (inspectionHour !== "" && inspectionMinute !== "") {
      const cleanHour = String(inspectionHour).replace(/[^0-9]/g, '').padStart(2, '0');
      const cleanMinute = String(inspectionMinute).replace(/[^0-9]/g, '').padStart(2, '0');
      payload["検査日"] = `${inspectionDate}T${cleanHour}:${cleanMinute}`;
    } else {
      payload["検査日"] = inspectionDate;
    }
  } else {
    payload["検査日"] = "";
  }

  // -------------------------------------------------------------
  // 添付ファイルの準備
  // ※ チャンク分割方式（PDF等）はrowNumberが確定してから実行する必要があるため、
  //   ここではBase64化等の事前変換は行わず、選択されたファイルの一覧だけを保持しておく。
  // -------------------------------------------------------------
  const files = selectedFilesMap["NEW_PROJECT"] || [];
  const loader = document.getElementById("initLoader");

  loader.style.display = "flex";
  document.getElementById("loaderText").textContent = "新規案件を登録中...";

  // =================================================================
  // 【1段目】シート高速追加処理
  // =================================================================
  try {
    const fDataForSheetOnly = Object.assign({}, payload);
    delete fDataForSheetOnly.files; // 高速な1段目にはファイルの重いデータを含めない

    const response = await Api.createRecordSheetOnly(fDataForSheetOnly);

    // 1. ローダー解除＆新規モーダルを閉じる
    loader.style.display = "none";
    if (typeof closeCreateModal === "function") closeCreateModal();

    // 2. 状態のクリア
    selectedFilesMap["NEW_PROJECT"] = [];
    form.reset();

    // 3. 軽量なトースト通知（1段目完了）※2段目完了の通知が出るまで表示し続ける
    if (typeof showToast === "function") {
      showToast("データ登録が完了しました。その他カレンダー、ファイル登録等処理中...", false, true);
    }

    // =================================================================
    // 【2段目】バックグラウンド処理（Drive保存/カレンダー同期/マスタ＆ヨミ更新）
    // 413エラー対策：添付ファイルは processBackgroundTasks には含めず、
    // uploadAllAttachedFiles() で種別ごとに適切な方式（画像=Base64、PDF等=チャンク分割方式）
    // で個別に送信する。
    // =================================================================
    const newRowNumber = response.rowNumber;
    const flags = { isNew: true };
    const payloadWithoutFiles = Object.assign({}, payload);
    delete payloadWithoutFiles.files;

    try {
      await Api.processBackgroundTasks(payloadWithoutFiles, newRowNumber, flags);

      // ここまで（カレンダー登録・マスタ更新）が完了した時点で完了通知に切り替える。
      // 添付ファイルのアップロードはこの後も裏側で継続し、完了を待たずに一覧を更新する。
      if (typeof showToast === "function") {
        showToast("最新の情報を一覧に反映しました。");
      }

      // バックグラウンドでマスタデータを再取得・更新
      Api.loadAppDataMaster().then(data => {
        if (data && typeof appConfig !== "undefined") {
          appConfig = data;
          applySharedMasterData(data);
        }
      }).catch(console.error);

      // カレンダー登録まで完了した時点で、リロードせず一覧をリアルタイムに最新化
      if (typeof refreshListAfterAllProcessing === "function") {
        await refreshListAfterAllProcessing();
      }

      // 添付ファイルのアップロードは完了を待たず裏側で継続する（awaitしない）。
      // 失敗した場合もファイル部分のエラーとして案内し、案件登録自体の完了通知は妨げない。
      if (files && files.length > 0) {
        uploadAllAttachedFiles(newRowNumber, files).catch(fileErr => {
          console.error("❌ 添付ファイルのアップロードでエラーが発生しました:", fileErr);
        });
      }

    } catch (bgErr) {
      console.error("❌ バックグラウンド処理エラー(新規登録):", bgErr);
      // 持続表示中の「処理中...」トーストをここで消す（エラー内容はSwalダイアログで案内する）
      const toastEl = document.getElementById("toastNotification");
      if (toastEl) toastEl.classList.remove("show");
      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: 'error',
          title: '背景処理でエラーが発生しました',
          html: `<strong>${bgErr.message}</strong><br><br><small>カレンダー同期でエラーが発生した可能性があります。詳細はコンソール（F12）を確認してください。</small>`,
          confirmButtonText: '了解'
        });
      }
    }

  } catch (err) {
    // 1段目失敗時も必ずローダーを消し、再入力できるようボタンを戻す
    loader.style.display = "none";
    console.error("❌ 新規登録エラー:", err);

    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: 'error',
        title: '登録エラーが発生しました',
        html: `<strong>${err.message}</strong><br><br><small>詳細はコンソール（F12）を確認してください</small>`,
        confirmButtonText: '了解'
      });
    }
  } finally {
    submitBtn.disabled = false;
  }
}

// =================================================================
// 詳細データ修正保存処理
// =================================================================
window.saveRecord = async function(rNum, rowNumber, btnEl) {
  if (btnEl) btnEl.disabled = true; // 二重送信防止
  const loader = document.getElementById("initLoader");
  loader.style.display = "flex";
  document.getElementById("loaderText").textContent = "データを更新中";

  // 1. フォームデータの収集
  const fData = {
    現場住所: document.getElementById(`現場住所_${rNum}`).value,
    現場緯度経度: document.getElementById(`現場緯度経度_${rNum}`).value.replace(/\s+/g, ""),
    駐車場住所: document.getElementById(`駐車場住所_${rNum}`).value,
    駐車場緯度経度: document.getElementById(`駐車場緯度経度_${rNum}`).value.replace(/\s+/g, ""),
    延床面積: document.getElementById(`延床面積_${rNum}`).value,
    キーBOX: document.getElementById(`キーBOX_${rNum}`).value,
    備考: document.getElementById(`備考_${rNum}`).value,
    システムID: document.getElementById(`システムID_${rNum}`).value,
    メールID: document.getElementById(`メールID_${rNum}`).value,
    着工日: document.getElementById(`着工日_${rNum}`).value,
    完成日: document.getElementById(`完成日_${rNum}`).value,
    引渡日: document.getElementById(`引渡日_${rNum}`).value
  };

  // 施主名：変更されている場合のみ送信する。
  // 施主名が変わった場合、GAS側で「施主名よみ」を自動生成するため、
  // ここでは施主名だけを送る（よみは元々表示していない＝ユーザーが直接編集する項目ではないため）。
  const clientNameEl = document.getElementById(`施主名_${rNum}`);
  if (clientNameEl) {
    fData["施主名"] = clientNameEl.value;
  }

  const projectTypeSel = document.getElementById(`addProjectTypeSelect_${rNum}`);
  if (projectTypeSel && projectTypeSel.value === "(新規案件種別)") {
    fData["案件種別"] = document.getElementById(`newProjectTypeInput_${rNum}`).value.trim();
  } else if (projectTypeSel) {
    fData["案件種別"] = projectTypeSel.value;
  }

  // 検査日＋時刻の結合
  const inspectionDate = document.getElementById(`検査日_${rNum}`).value;
  const inspectionHourSel = document.getElementById(`検査日時_${rNum}`);
  const inspectionMinuteSel = document.getElementById(`検査日分_${rNum}`);

  if (inspectionDate) {
    const hourVal = inspectionHourSel ? inspectionHourSel.value : "";
    const minuteVal = inspectionMinuteSel ? inspectionMinuteSel.value : "";

    if (hourVal && minuteVal) {
      const cleanHour = String(hourVal).replace(/[^0-9]/g, '').padStart(2, '0');
      const cleanMinute = String(minuteVal).replace(/[^0-9]/g, '').padStart(2, '0');
      fData["検査日"] = `${inspectionDate}T${cleanHour}:${cleanMinute}`;
    } else {
      fData["検査日"] = inspectionDate;
    }
  } else {
    fData["検査日"] = "";
  }

  // 工事日程・内容・担当者（セット数は無制限）
  // 描画時に存在したセット、または追加されたセットの大きい方まで処理する
  const initialMax = editWorkInitialMax[rNum] || 1;
  const maxWorkIndex = Math.max(editWorkCounts[rNum] || 1, initialMax);
  for (let i = 1; i <= maxWorkIndex; i++) {
    const startEl = document.getElementById(`editWorkStart_${rNum}_${i}`);
    const endEl = document.getElementById(`editWorkEnd_${rNum}_${i}`);
    if (!startEl) {
      // 「×」で削除されたセット：元々存在した番号なら空値を送り、
      // シートの値とカレンダー予定を消す（追加後すぐ削除した番号は送らない）
      if (i <= initialMax) {
        fData["施工日" + i + "開始"] = "";
        fData["施工日" + i + "終了"] = "";
        fData["工事内容" + i] = "";
        fData["工事担当者" + i] = "";
      }
      continue;
    }

    let startVal = startEl.value;
    let endVal = endEl ? endEl.value : "";
    if (startVal && endVal && endVal < startVal) { // 開始・終了が逆転していたら入れ替えて補正
      const tmp = startVal; startVal = endVal; endVal = tmp;
    }
    fData["施工日" + i + "開始"] = startVal;
    fData["施工日" + i + "終了"] = endVal;

    const cSel = document.getElementById(`editWorkContent_${rNum}_${i}`);
    if (cSel.value === "(新規工事内容)") {
      fData["工事内容" + i] = document.getElementById(`newEditWorkContentInput_${rNum}_${i}`).value.trim();
    } else {
      fData["工事内容" + i] = cSel.value;
    }

    // 工事担当者は複数選択ウィジェットのhidden inputにカンマ区切りで格納されている
    const workerHidden = document.getElementById(`workerHiddenInput_edit_${rNum}_${i}`);
    fData["工事担当者" + i] = workerHidden ? workerHidden.value : "";
  }

  const staffSel = document.getElementById(`editStaffSelect_${rNum}`);
  if (staffSel && staffSel.value === "(新規担当者)") {
    fData["担当者"] = document.getElementById(`newEditStaffInput_${rNum}`).value.trim();
  } else if (staffSel) {
    fData["担当者"] = staffSel.value;
  }

  const phoneInput = document.getElementById(`editPhoneInput_${rNum}`);
  if (phoneInput) {
    fData["連絡先"] = phoneInput.value.trim();
  }

  // 連絡先が、この案件の元の値から変更されたか（マスタの連絡先を上書きするかの判定に使う）
  const originalRecord = (allRecordsCache || []).find(r => r.rowNumber === rowNumber);
  const originalPhone = originalRecord ? String(originalRecord["連絡先"] || "").trim() : "";
  const phoneChanged = (fData["連絡先"] !== undefined) && (fData["連絡先"] !== originalPhone);
	
  // 添付ファイル
  // ※ チャンク分割方式（PDF等）の対象があるため、ここでは事前変換は行わず、
  //   選択されたファイルの一覧をそのまま保持しておく。
  const files = selectedFilesMap[rNum] || [];
  fData.files = []; // 1段目・2段目のfDataには重いファイルデータを含めない（後段で種別ごとに個別送信する）

  // =================================================================
  // 【1段目】シート書き込み処理
  // =================================================================
  try {
    document.getElementById("loaderText").textContent = "データを更新中";
    const fDataForSheetOnly = Object.assign({}, fData);
    delete fDataForSheetOnly.files;
    const response = await Api.updateRecordSheetOnly(fDataForSheetOnly, rowNumber);

    // 1. ローダーを消して画面を解放
    loader.style.display = "none";

    // 2. UIの更新・元の画面（一覧）に戻す（再検索は挟まない）
    selectedFilesMap[rNum] = [];
    if (typeof renderFileList === 'function') renderFileList(rNum);
    if (btnEl) btnEl.disabled = false;
    const itemEl = document.getElementById(`現場住所_${rNum}`)?.closest('.result-item');
    if (itemEl) itemEl.classList.remove('is-open');

    // 変更が1件も無い場合は、カレンダー同期・通知メール・マスタ更新を行わない。
    // 添付ファイルだけ追加されている可能性があるため、アップロードのみ続行する。
    if (response && response.isDataChanged === false) {
      showToast("変更箇所はありませんでした。");
      if (files.length > 0) {
        uploadAllAttachedFiles(rowNumber, files).catch(fileErr => {
          console.error("❌ 添付ファイルのアップロードでエラーが発生しました:", fileErr);
        });
      }
      return;
    }

    // 3. 軽量なトースト通知（1段目完了）※2段目完了の通知が出るまで表示し続ける
    showToast("データ登録が完了しました。その他カレンダー、ファイル登録等処理中...", false, true);

    // =================================================================
    // 【2段目】重い処理を実行し、完了したらリロードせず一覧をリアルタイムに最新化する
    // 413エラー対策：添付ファイルは processBackgroundTasks には含めず、
    // uploadAllAttachedFiles() で種別ごとに適切な方式（画像=Base64、PDF等=チャンク分割方式）
    // で個別に送信する。
    // =================================================================
    const fDataForBackgroundTasks = Object.assign({}, fData);
    delete fDataForBackgroundTasks.files;

    try {
      await Api.processBackgroundTasks(fDataForBackgroundTasks, rowNumber, { phoneChanged: phoneChanged });

      // マスタ（担当者・連絡先の候補）を再取得して、次回の選択に最新の連絡先が出るようにする
      Api.loadAppDataMaster().then(data => {
        if (data && typeof appConfig !== "undefined") {
          appConfig = data;
          applySharedMasterData(data);
        }
      }).catch(console.error);

      // すべての処理完了 → 一覧を自動的に最新化（ここでトースト表示も更新される）
      await refreshListAfterAllProcessing();

      // 添付ファイルのアップロードは完了を待たず裏側で継続する（awaitしない）。
      if (files && files.length > 0) {
        uploadAllAttachedFiles(rowNumber, files).catch(fileErr => {
          console.error("❌ 添付ファイルのアップロードでエラーが発生しました:", fileErr);
        });
      }
    } catch (bgErr) {
      console.error("❌ バックグラウンド処理エラー:", bgErr);
      // 持続表示中の「処理中...」トーストをここで消す（エラー内容はSwalダイアログで案内する）
      const toastEl = document.getElementById("toastNotification");
      if (toastEl) toastEl.classList.remove("show");
      Swal.fire({
        icon: 'error',
        title: '背景処理でエラーが発生しました',
        html: `<strong>${bgErr.message}</strong><br><br><small>カレンダー同期でエラーが発生した可能性があります。詳細はコンソール（F12）を確認してください。</small>`,
        confirmButtonText: '了解'
      });
    }

  } catch (err) {
    // 1段目（シート書き込み失敗）のときも必ずローダーを消し、ボタンを戻す
    loader.style.display = "none";
    if (btnEl) btnEl.disabled = false;

    console.error("❌ シート書き込みエラー:", err);
    Swal.fire({
      icon: 'error',
      title: '保存エラーが発生しました',
      html: `<strong>${err.message}</strong><br><br><small>詳細はコンソール（F12）を確認してください</small>`,
      confirmButtonText: '了解'
    });
  }
};

// すべての処理（1段目＋2段目）完了後、ページをリロードせずに一覧データを裏で再取得し、
// 現在の検索条件を保ったまま一覧をリアルタイムに最新化する。完了したらトースト通知で知らせる。
async function refreshListAfterAllProcessing() {
  try {
    allRecordsCache = await Api.loadAllRecords();
    // 現在の絞り込み条件を維持したまま再描画（search()はDOM上の現在のフィルタ値を読んで再描画する）
    // 保存後の自動更新であり、ユーザーが自ら検索した訳ではないため画面はスクロールさせない
    search(false);
    showToast("最新の情報を一覧に反映しました。");
  } catch (e) {
    console.error("❌ 一覧の自動更新に失敗しました:", e);
    showToast("一覧の自動更新に失敗しました。お手数ですが検索ボタンを押して最新化してください。", true);
  }
}

// =================================================================
// 📋 外部データの貼り付け連携（新規登録モーダル専用）
// -----------------------------------------------------------------------
// 【スコープ限定について】
// 以前は window 全体に常時貼り付けイベントを張っていたが、新規登録モーダルを
// 開いていない場面（検索キーワード欄への通常のペースト等）でも常に発火し、
// 貼り付けた文字列がたまたまJSONとして解釈できる場合に意図せず反応してしまう
// リスクがあった。そのため、新規登録モーダルを開いている間だけ
// （openCreateModal〜closeCreateModalの間だけ）リスナーを有効にする方式に変更した。
// =================================================================
async function handleProjectPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData('text');
  try {
    const data = JSON.parse(text);
    // フィールドマッピング定義
    const fieldMapping = {
      'システムID': 	       'system_id',
      'メールID': 		   'property_id',
      '受注媒体': 		   'addMediaSelect',
      '案件種別': 		   'addProjectTypeSelect',
      '発注元': 		       'addClientSelect',
      '担当者': 		       'addStaffSelect',
      '案件名': 		       'project_name',
      '施主名': 		       'client_name',
	      '施主名よみ': 	   	   'client_name_yomi',
      '住所': 		       'address',
      '現場緯度経度': 	　 'Latitude_longitude',
      '専有面積・延床面積': 'room_area',
      'キーBOX': 		   'key_box',
      '着工日': 		       'construction_start_date',
      '完成日': 		       'completion_date',
      '引渡日': 		       'delivery_date',
      '備考': 		       'remarks'
    };
    // 日付フィールドのリスト
    const dateFields = ['着工日', '完成日', '引渡日'];
    // マッピングを元にデータを流し込み
    Object.entries(data).forEach(([key, value]) => {
      const targetId = fieldMapping[key];
      if (!targetId) return;

      const inputElement = document.getElementById(targetId);
      if (!inputElement) return;

      let processedValue = value;

      // 日付処理
      if (dateFields.includes(key) && value) {
        processedValue = formatDateToYYYYMMDD(value);
      }
      // 発注元の括弧内抽出
      if (key === '発注元' && value) {
        processedValue = extractTextInParentheses(value);
      }

      inputElement.value = processedValue;
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    });

    alert('データを各入力欄に展開しました！');
  } catch (err) {
    // JSONではない場合は通常のブラウザ挙動に任せる
  }
}

/** 日付をyyyy-mm-dd形式に変換 */
function formatDateToYYYYMMDD(dateValue) {
  if (!dateValue) return '';
  const dateStr = String(dateValue).trim();
  // すでにyyyy-mm-dd形式の場合
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  // 日本語の日付フォーマット（例：2024年1月15日）
  const japaneseMatch = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (japaneseMatch) {
    const year = japaneseMatch[1];
    const month = String(japaneseMatch[2]).padStart(2, '0');
    const day = String(japaneseMatch[3]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  // スラッシュ形式（例：2024/1/15）
  const slashMatch = dateStr.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slashMatch) {
    const year = slashMatch[1];
    const month = String(slashMatch[2]).padStart(2, '0');
    const day = String(slashMatch[3]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  // その他の形式はそのまま返す
  return dateValue;
}

/** 新規関数：括弧内のテキストを抽出 */
function extractTextInParentheses(text) {
  if (!text) return '';
  const textStr = String(text).trim();
  // 「（）」または「()」の両方に対応
  const match = textStr.match(/[（(]([^）)]+)[）)]/);
  if (match && match[1]) {
    return match[1].trim();
  }
  // 括弧がない場合はそのまま返す
  return textStr;
}
