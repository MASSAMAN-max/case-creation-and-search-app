// =====================================================================
// 04_form_parts.js ― 共通フォーム部品
// ---------------------------------------------------------------------
// セレクト（<option>生成）、複数選択トグル（工事担当者・検索フィルター）、担当者→連絡先の反映、
// 新規入力欄の出し入れ、検査日の時刻セレクト、音声入力など、新規登録・編集・検索で共用する入力部品。
// 読み込み順：index.html の <script> タグの順（01 → 07）。通常の<script>のため、
// 各ファイルで宣言した変数・関数は、他のファイルからそのまま参照できる。
// =====================================================================

// =================================================================
// 共通: 工事担当者・複数選択ドロップダウン（チェックボックス方式）
// uid: 要素IDに使う一意な文字列（例: "new_1" や "edit_123_2"）
// fieldName: 実際に送信する値を持つhidden inputのname属性（例: "工事担当者1"）
// =================================================================
// 複数選択ドロップダウンのHTML生成（工事担当者・検索フィルターで共用）
//   isFilter    : trueなら検索フィルター用（「新規追加」欄なし・hiddenにname無し）
//   fieldName   : 送信用hidden inputのname属性（工事担当者用。例："工事担当者1"）
//   placeholder : 未選択時の表示文字（検索フィルター用）
function buildMultiSelectHtml(uid, { isFilter = false, fieldName = "", placeholder = "選択してください" } = {}) {
  // 「選択」ボタン（押すと新規入力を確定してドロップダウンを閉じる）
  const confirmBtnHtml = `
    <button type="button" class="btn btn-sm" style="font-size:14px; padding:8px 18px;"
      onclick="event.stopPropagation(); closeWorkerDropdown('${uid}');">選択</button>`;

  // ヘッダー：検索フィルターは「選択」ボタンのみ。工事担当者は「選択」ボタン＋新規担当者の追加欄
  const headerHtml = isFilter ? `
        <div style="position:sticky; top:0; background:white; z-index:2; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; justify-content:flex-end; padding:8px 10px;">
          ${confirmBtnHtml}
        </div>` : `
        <div style="position:sticky; top:0; background:white; z-index:2; border-bottom:1px solid #e2e8f0;">
          <div style="display:flex; align-items:center; justify-content:flex-end; padding:8px 10px 4px 10px;">
            ${confirmBtnHtml}
          </div>
          <div style="padding:4px 10px 8px 10px; display:flex; gap:4px;">
            <input type="text" id="workerNewInput_${uid}" placeholder="新規担当者名を追加" autocomplete="off" style="flex:1; min-width:0; padding:8px;"
              onkeydown="handleWorkerNewInputKeydown(event, '${uid}')" onblur="commitWorkerNewInput('${uid}')" onclick="event.stopPropagation();">
          </div>
        </div>`;

  return `
    <div class="multi-select-wrapper" style="position:relative;">
      <button type="button" class="control-btn ${isFilter ? 'control-btn-filter ' : ''}multi-select-toggle" onclick="toggleWorkerDropdown('${uid}')" id="workerToggleBtn_${uid}"${isFilter ? '' : ' style="margin-top:2px;"'}>
        <span id="workerSummary_${uid}" style="color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${placeholder}</span>
        <span class="material-symbols-outlined" style="font-size:18px; color:#94a3b8; flex-shrink:0;">expand_more</span>
      </button>
      <div id="workerDropdown_${uid}" class="multi-select-dropdown"
        style="display:none; position:absolute; z-index:30; background:white; border:1px solid #cbd5e1; border-radius:8px;
               max-height:${isFilter ? 260 : 220}px; overflow-y:auto; width:100%; box-shadow:0 4px 14px rgba(0,0,0,0.15); margin-top:4px;">
        ${headerHtml}
        <div id="workerCheckboxList_${uid}"></div>
      </div>
      <input type="hidden" ${isFilter ? '' : `name="${fieldName}" `}id="workerHiddenInput_${uid}" value="">
    </div>`;
}

// 工事担当者（複数選択）用。fieldNameは送信用hiddenのname
function buildWorkerMultiSelectHtml(uid, fieldName) {
  return buildMultiSelectHtml(uid, { fieldName });
}

function initWorkerMultiSelect(uid, userList, existingCsv) {
  const listDiv = document.getElementById(`workerCheckboxList_${uid}`);
  if (!listDiv) return;
  const existing = String(existingCsv || "").split(",").map(s => s.trim()).filter(Boolean);
  const masterNames = (userList || []).map(v => extractValue(v)).filter(Boolean);
  // 既存データに含まれるが現在のマスタに無い名前（過去の登録等）も選べるように残す
  const allNames = Array.from(new Set([...masterNames, ...existing]));

  // 発注元セレクトと同様に、サーバー側(attachGyou)が付与した「行」情報があればグループ化する。
  // 工事内容リストのようにgyou情報を持たない（オブジェクトではなく文字列の）リストの場合は、
  // 見出し無しのフラットな一覧として表示する。
  const nameToGyou = {};
  let hasGyouInfo = false;
  (userList || []).forEach(v => {
    if (typeof v === 'object' && v !== null && v.name) {
      nameToGyou[v.name] = v.gyou || "その他";
      hasGyouInfo = true;
    }
  });
  if (hasGyouInfo) {
    existing.forEach(name => { if (!nameToGyou[name]) nameToGyou[name] = "その他"; });
  }

  let html = "";
  let currentGroup = null;
  allNames.forEach(name => {
    if (hasGyouInfo) {
      const gyou = nameToGyou[name] || "その他";
      if (gyou !== currentGroup) {
        if (currentGroup !== null) html += `</div>`;
        html += `<div class="worker-group-label">${escapeHtml(gyou)}</div><div class="worker-group-body">`;
        currentGroup = gyou;
      }
    }
    const checked = existing.includes(name) ? "checked" : "";
    html += `
      <label class="worker-toggle-row">
        <span class="toggle-switch">
          <input type="checkbox" value="${escapeAttr(name)}" ${checked} onchange="updateWorkerSelection('${uid}')">
          <span class="toggle-slider"></span>
        </span>
        <span class="worker-toggle-label">${escapeHtml(name)}</span>
      </label>`;
  });
  if (hasGyouInfo && currentGroup !== null) html += `</div>`;
  listDiv.innerHTML = html || '<div style="padding:10px; color:#94a3b8; font-size:13px;">候補がありません。下の欄から追加してください</div>';
  updateWorkerSelection(uid);
}

// 検索フィルター用など、「新規追加」欄を持たない多肢選択トグルUIを生成する。
// 内部のHTML構造・ID命名（workerXxx_${uid}）は工事担当者用と共通のため、
// updateWorkerSelection() や initWorkerMultiSelect() をそのまま流用できる。
function buildFilterMultiSelectHtml(uid, placeholderLabel) {
  return buildMultiSelectHtml(uid, { isFilter: true, placeholder: placeholderLabel });
}

// 検索フィルター用の多肢選択トグルを、選択状態をすべて未選択にリセットする
function resetFilterMultiSelect(uid) {
  const listDiv = document.getElementById(`workerCheckboxList_${uid}`);
  if (listDiv) {
    listDiv.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = false; });
  }
  if (typeof updateWorkerSelection === "function") updateWorkerSelection(uid);
}

// 検索フィルター用の多肢選択トグルの、現在選択されている値の配列を取得する
function getFilterMultiSelectValues(uid) {
  const hidden = document.getElementById(`workerHiddenInput_${uid}`);
  if (!hidden || !hidden.value) return [];
  return hidden.value.split(",").map(s => s.trim()).filter(Boolean);
}

window.updateWorkerSelection = function(uid) {
  const listDiv = document.getElementById(`workerCheckboxList_${uid}`);
  const hidden = document.getElementById(`workerHiddenInput_${uid}`);
  const summary = document.getElementById(`workerSummary_${uid}`);
  if (!listDiv || !hidden || !summary) return;
  const checked = Array.from(listDiv.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
  hidden.value = checked.join(",");
  if (checked.length) {
    summary.textContent = checked.join("、");
    summary.style.color = "#1e293b";
  } else {
    summary.textContent = "選択してください";
    summary.style.color = "#94a3b8";
  }
};

window.toggleWorkerDropdown = function(uid) {
  document.querySelectorAll('.multi-select-dropdown').forEach(d => {
    if (d.id !== `workerDropdown_${uid}`) d.style.display = 'none';
  });
  const dd = document.getElementById(`workerDropdown_${uid}`);
  if (!dd) return;
  dd.style.display = (dd.style.display === 'none' || !dd.style.display) ? 'block' : 'none';
};

// 右上の「選択」ボタン押下時の処理：
// ・新規担当者入力欄にまだ確定していない文字列が残っていれば、まず選択リストへ反映する
// ・そのうえでドロップダウンを閉じて元の画面（フォーム）に戻す
// これにより、リスト外の狭い余白をタップしなくても確実に閉じられるようになる。
window.closeWorkerDropdown = function(uid) {
  commitWorkerNewInput(uid);
  const dd = document.getElementById(`workerDropdown_${uid}`);
  if (dd) dd.style.display = 'none';
};

// 新規担当者入力欄でのEnterキーは何もしない（登録も画面移動も行わない）。
// 以前はEnterで登録・確定を行っていたが、IMEやブラウザのオートフィルとの相性で
// 意図せず他の入力欄へフォーカスが移ってしまう不具合が繰り返し発生していたため廃止し、
// 確定操作は右上の「選択」ボタン（closeWorkerDropdown）に一本化した。
// ここではEnterによるフォーム送信・フォーカス移動だけを確実に防止する。
window.handleWorkerNewInputKeydown = function(event, uid) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  event.stopPropagation();
};

// 新規担当者入力欄の内容を選択リストへ反映する共通処理。
// 入力欄からフォーカスが外れた時（他をタップした場合）と、
// 「選択」ボタン押下時（closeWorkerDropdown経由）の両方から呼ばれる。
window.commitWorkerNewInput = function(uid) {
  const input = document.getElementById(`workerNewInput_${uid}`);
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  const listDiv = document.getElementById(`workerCheckboxList_${uid}`);
  if (!listDiv) return;
  const existingCheckbox = Array.from(listDiv.querySelectorAll('input[type="checkbox"]')).find(c => c.value === name);
  if (existingCheckbox) {
    existingCheckbox.checked = true;
  } else {
    if (listDiv.querySelector('input[type="checkbox"]') === null) listDiv.innerHTML = ""; // 「候補がありません」の表示を消す
    const wrap = document.createElement('label');
    wrap.className = 'worker-toggle-row';
    wrap.innerHTML = `
      <span class="toggle-switch">
        <input type="checkbox" value="${escapeAttr(name)}" checked onchange="updateWorkerSelection('${uid}')">
        <span class="toggle-slider"></span>
      </span>
      <span class="worker-toggle-label">${escapeHtml(name)}</span>`;
    listDiv.appendChild(wrap);
  }
  input.value = "";
  updateWorkerSelection(uid);
};

// ドロップダウンの外側をクリックしたら閉じる（全ウィジェット共通・1回だけ登録）
document.addEventListener('click', (e) => {
  document.querySelectorAll('.multi-select-wrapper').forEach(wrap => {
    if (!wrap.contains(e.target)) {
      const dd = wrap.querySelector('.multi-select-dropdown');
      if (dd) dd.style.display = 'none';
    }
  });
});

// 検査日の「時」「分」セレクトの選択肢を生成する共通関数（新規登録用・編集用で共用）
function buildInspectionTimeOptions() {
  const pad = n => String(n).padStart(2, '0');
  const hours = ['<option value="">時</option>'];
  for (let h = 0; h < 24; h++) hours.push(`<option value="${pad(h)}">${pad(h)}</option>`);
  const minutes = ['<option value="">分</option>'];
  for (let m = 0; m < 60; m += 15) minutes.push(`<option value="${pad(m)}">${pad(m)}</option>`);
  return { hours, minutes };
}

// 検査日の「時」を選んだとき、「分」が未選択なら自動で「00」にする（新規登録・編集で共用）
// （時だけ選んで分が空のままだと、時刻なしの日付のみとして保存されてしまうのを防ぐ）
window.handleInspectionHourChange = function(hourSel, minuteSelId) {
  const minuteSel = document.getElementById(minuteSelId);
  if (hourSel.value !== "" && minuteSel && minuteSel.value === "") {
    minuteSel.value = "00";
  }
};

// 新規関数：時刻セレクトボックスを初期化
window.initializeInspectionTimeSelects = function() {
  const { hours, minutes } = buildInspectionTimeOptions();

  // 新規登録モーダル内のセレクトに設定
  const newHourSel = document.getElementById("newInspectionHour");
  const newMinuteSel = document.getElementById("newInspectionMinute");
  if (newHourSel) newHourSel.innerHTML = hours.join('');
  if (newMinuteSel) newMinuteSel.innerHTML = minutes.join('');
};

// 時刻値を保持
window.initializeInspectionTimeSelectsForRecord = function(recordNo) {
  const { hours, minutes } = buildInspectionTimeOptions();

  const hourSel = document.getElementById(`検査日時_${recordNo}`);
  const minuteSel = document.getElementById(`検査日分_${recordNo}`);

  // 既存値を保存してからHTMLを更新
  const existingHour = hourSel ? hourSel.value : '';
  const existingMinute = minuteSel ? minuteSel.value : '';

  if (hourSel) hourSel.innerHTML = hours.join('');
  if (minuteSel) minuteSel.innerHTML = minutes.join('');

  // 既存値を復元
  if (hourSel && existingHour) hourSel.value = existingHour;
  if (minuteSel && existingMinute) minuteSel.value = existingMinute;
};

// =================================================================
// 共通: <option>HTML生成（optgroup自動生成対応）
// initSelectWithOptions（セレクトの初期化）と createOptionsHtml（編集フォームの
// テンプレート埋め込み）の両方から使う。
//   defaultLabel : 先頭の選択肢の表示文字（例："選択してください" / "すべて"）
//   newSuffix    : 指定時のみ「(新規○○を登録)」の選択肢を先頭に付ける
//   formatClient : trueなら「株式会社」等を除去して表示する（発注元用）
//   currentVal   : 選択状態にする値。リストに無い場合も末尾に追加して選択する
// =================================================================
function buildOptionsHtml(dataList, { defaultLabel = "選択してください", newSuffix = "", formatClient = false, currentVal = "" } = {}) {
  let html = `<option value="">${defaultLabel}</option>`;

  if (newSuffix) {
    html += `
      <option value="(新規${newSuffix})" style="color:var(--primary); font-weight:bold;">(新規${newSuffix}を登録)</option>
      <option disabled>────────────</option>
    `;
  }

  let currentGroup = null;
  let exist = false;

  (dataList || []).forEach(v => {
    const val = extractValue(v);
    if (!val) return;

    // 見出し判定：
    //   1) GASの attachGyou() が付与する gyou プロパティ（現行のマスタ形式）
    //   2) 旧形式（isHeaderフラグ、または "--- あ行 ---" のようなダミー行）との互換性も維持
    const gyou = (typeof v === 'object' && v !== null) ? v.gyou : null;
    const isLegacyHeader = (typeof v === 'object' && v !== null && v.isHeader) || (typeof val === 'string' && val.startsWith('---'));

    if (isLegacyHeader) {
      if (currentGroup !== null) html += `</optgroup>`;
      const labelText = String(val).replace(/^---\s*|\s*---$/g, ''); // "--- あ行 ---" から "あ行" を抽出
      html += `<optgroup label="${escapeAttr(labelText)}">`;
      currentGroup = labelText;
      return;
    }

    if (gyou && gyou !== currentGroup) {
      if (currentGroup !== null) html += `</optgroup>`;
      html += `<optgroup label="${escapeAttr(gyou)}">`;
      currentGroup = gyou;
    }

    const text = formatClient ? formatDisplayText(val) : val;
    const isSelected = !!currentVal && val === currentVal;
    if (isSelected) exist = true;

    html += `<option value="${escapeAttr(val)}"${isSelected ? ' selected' : ''}>${escapeHtml(text)}</option>`;
  });

  if (currentGroup !== null) html += `</optgroup>`; // 最後にグループを閉じる

  // 編集フォーム等：現在値がマスタ内に存在しない場合のフォールバック
  if (currentVal && !exist) {
    const text = formatClient ? formatDisplayText(currentVal) : currentVal;
    html += `<option value="${escapeAttr(currentVal)}" selected>${escapeHtml(text)}</option>`;
  }

  return html;
}

// セレクトボックスを初期化する（検索フィルタ「filterClient」には「＋新規登録」を付けない）
function initSelectWithOptions(elementId, dataList, suffix, defaultLabel = "選択してください") {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = buildOptionsHtml(dataList, {
    defaultLabel: defaultLabel,
    newSuffix: (elementId !== "filterClient" && suffix) ? suffix : "",
    formatClient: elementId === "filterClient" || elementId === "addClientSelect" || (!!suffix && suffix.includes("発注元"))
  });
}

// 編集フォームのテンプレートに埋め込む <option> 一覧を返す（currentValを選択状態にする）
function createOptionsHtml(masterList, currentVal = "", suffix = "") {
  return buildOptionsHtml(masterList, {
    newSuffix: suffix,
    formatClient: !!suffix && suffix.includes("発注元"),
    currentVal: currentVal
  });
}

// 「(新規○○)」が選ばれた時だけ、新規入力欄を表示する（新規登録・編集フォーム共通）
window.toggleNewInput = function(selectEl, groupId) {
  const group = document.getElementById(groupId);
  const input = group.querySelector("input");
  if (selectEl.value.startsWith("(新規")) {
    group.style.display = "block";
    if(input) input.required = true;
  } else {
    group.style.display = "none";
    if(input) { input.required = false; input.value = ""; }
  }
};

// 発注元と担当者名から、マスタ上の担当者（連絡先付き）を探す。見つからなければnull
function findManagerInMaster(clientName, staffName) {
  const list = (clientName && appConfig.managerByClient) ? appConfig.managerByClient[clientName] : null;
  if (!list) return null;
  return list.find(m => ((m && typeof m === 'object') ? m.name : m) === staffName) || null;
}

// 担当者を選んだ時の連絡先の反映（新規登録・編集フォーム共通）
//   ・(新規担当者)         ：連絡先を空にして手入力可にする
//   ・マスタにある担当者   ：連絡先を自動入力し、読み取り専用にする
//   ・マスタに無い名前     ：手入力可にする// 担当者を選んだ時の連絡先の反映（新規登録・編集フォーム共通）
//   ・(新規担当者)         ：連絡先を空にする
//   ・マスタにある担当者   ：連絡先を自動入力する（その後に編集してもよい）
//   ・マスタに無い名前     ：clearIfUnmatchedがtrueなら連絡先を空にする
//     （新規登録は空にする／編集は既存の連絡先を残す、という従来の挙動の違いを維持している）
// 連絡先欄は常に編集可能。変更した場合のマスタ上書きはGAS側（addClientStaffGroup）で行う。
function applyManagerPhone(selectEl, phoneInput, clientName, clearIfUnmatched) {
  if (!phoneInput) return; // 安全対策：要素が見つからない場合はスキップ

  phoneInput.readOnly = false; // 常に編集可能

  if (selectEl.value === "(新規担当者)") {
    phoneInput.value = "";
    return;
  }

  const matched = findManagerInMaster(clientName, selectEl.value);
  if (matched && typeof matched === 'object') {
    phoneInput.value = matched.phone || matched.連絡先 || "";
  } else if (clearIfUnmatched) {
    phoneInput.value = "";
  }
}

// 新規登録フォーム：担当者変更時
window.handleStaffChange = function(selectEl, phoneInputId, groupId) {
  toggleNewInput(selectEl, groupId);
  const clientSel = document.getElementById("addClientSelect");
  applyManagerPhone(selectEl, document.getElementById(phoneInputId), clientSel ? clientSel.value : null, true);
};

// 編集フォーム：担当者変更時（発注元はHTMLのdata-client属性から取得）
window.handleEditStaffChange = function(selectEl, rNum) {
  toggleNewInput(selectEl, `newEditStaffGroup_${rNum}`);
  applyManagerPhone(selectEl, document.getElementById(`editPhoneInput_${rNum}`), selectEl.dataset.client || null, false);
};

/* 発注元に基づいて担当者リストを動的に更新 */
window.updateManagersByClient = function(selectedClient, staffSelectId) {
  const staffSel = document.getElementById(staffSelectId);
  if (!staffSel) return;

  // ✅ innerHTML の複数回更新を避ける（DocumentFragment を使用）
  const fragment = document.createDocumentFragment();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "選択してください";
  fragment.appendChild(defaultOption);

  if (selectedClient && appConfig.managerByClient && appConfig.managerByClient[selectedClient]) {
    appConfig.managerByClient[selectedClient].forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.name;
      opt.textContent = m.name;
      fragment.appendChild(opt);
    });
  } else {
    (appConfig.managerList || []).forEach(s => {
      const sName = (s && typeof s === 'object') ? s.name : s;
      if (sName) {
        const opt = document.createElement("option");
        opt.value = sName;
        opt.textContent = sName;
        fragment.appendChild(opt);
      }
    });
  }

  const newOption = document.createElement("option");
  newOption.value = "(新規担当者)";
  newOption.textContent = "(新規担当者)";
  newOption.style.color = "var(--primary)";
  newOption.style.fontWeight = "bold";
  fragment.appendChild(newOption);

  // ✅ 一度だけ DOM に追加（最後に一回の DOM操作）
  staffSel.innerHTML = '';
  staffSel.appendChild(fragment);
};

// 音声入力関数
function startVoiceInput(button) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    Swal.fire({
      icon: 'warning',
      title: '非対応',
      text: 'お使いのブラウザは音声入力に対応していません。',
      confirmButtonText: '了解'
    });
    return;
  }

  // ★修正: 備考欄は<textarea>のため、inputだけでなくtextareaも検索対象に含める
  //   （これが無いと備考欄では input が null になり、直後の input.style... でエラーになって
  //    recognition.start() まで到達せず、マイクが反応していないように見えていた）
  const input = button.closest('.voice-input-wrapper').querySelector('input, textarea');
  const recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.continuous = false;
  recognition.interimResults = true;

  // 背景色などの変更はクリック直後でOK
  input.style.backgroundColor = '#FFF3E0';
  input.style.borderColor = '#FF9800';

  // ★ 変更点1: 音声認識が「実際に始まってから」ボタンを無効化する
  recognition.onstart = () => {
    button.classList.add('recording');
    button.innerHTML = '<span class="material-symbols-outlined" style="animation: blink 1s infinite;">mic</span> 聴取中...';
    button.disabled = true;
  };

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        transcript += event.results[i][0].transcript;
      }
    }
    if (transcript) {
      input.value = (input.value + transcript).trim();
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error); // 原因調査用にコンソールにログを出す
    button.classList.remove('recording');
    input.style.backgroundColor = '';
    input.style.borderColor = '';
    Swal.fire({
      icon: 'error',
      title: '音声認識失敗',
      text: 'もう一度お試しください。',
      confirmButtonText: '了解'
    });
  };

  recognition.onend = () => {
    button.classList.remove('recording');
    button.innerHTML = '<span class="material-symbols-outlined">mic</span>';
    button.disabled = false;
    input.style.backgroundColor = '';
    input.style.borderColor = '';
  };

  recognition.start();
}
