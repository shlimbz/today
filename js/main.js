import { ensureNickname, updateNickname, todayLabel, showToast, fmtMs, fmtSec, getStars, grantDailyStarsIfNeeded, canAffordStars, spendStars } from "./utils.js";
import * as Reaction from "./games/reaction.js";
import * as Compat from "./games/compat.js";
import * as ColorGame from "./games/colormatch.js";
import * as Crop from "./games/crop.js";

let currentScreen = "main";
let nickname = { nickname: "불러오는 중", emoji: "🐱" };
let currentColorDiff = null;

const $ = (sel) => document.querySelector(sel);
const $id = (id) => document.getElementById(id);

// ============================================================
// 초기화
// ============================================================
async function init() {
  bindGlobalNav();
  bindReactionScreen();
  bindCompatScreen();
  bindColorScreens();
  bindCropScreen();

  nickname = await ensureNickname();
  Reaction.setNickname(nickname);
  ColorGame.setNickname(nickname);
  Crop.setNickname(nickname);
  renderNickname();

  const granted = grantDailyStarsIfNeeded();
  renderStars();
  if (granted > 0) showToast(`⭐ 오늘의 별 +${granted}개 지급!`);

  await renderMainTicket();
  showScreen("main");
}

function renderNickname() {
  $id("nicknameEmoji").textContent = nickname.emoji;
  $id("nicknameLabel").textContent = nickname.nickname;
}

function renderStars() {
  $id("starsBadge").textContent = `⭐ ${getStars()}`;
}

// ============================================================
// 화면 전환
// ============================================================
const SCREEN_IDS = ["main", "reaction", "compat", "colorgame", "colorpractice", "colorplay", "colorresult", "crop"];

function showScreen(name) {
  if (currentScreen === "colorplay" && name !== "colorplay") {
    ColorGame.cancelRound();
    practiceActive = false;
  }
  if (currentScreen === "crop" && name !== "crop") {
    stopCropTimer();
  }
  currentScreen = name;
  for (const id of SCREEN_IDS) {
    $id(`screen-${id}`).classList.toggle("hidden", id !== name);
  }
  $id("bottomNav").classList.toggle("hidden", name === "main");

  if (name === "reaction") Reaction.resetReactionScreen();
  if (name === "compat") resetCompatScreen();
  if (name === "colorgame") renderDiffSelect();
  if (name === "colorpractice") renderPracticeSelect();
  if (name === "crop") startCropScreen();
  if (name === "main") renderMainTicket();
}

function bindGlobalNav() {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => showScreen(el.dataset.nav));
  });

  $id("nicknameBtn").addEventListener("click", openNicknameModal);
  $id("navRank").addEventListener("click", openRankingModal);
  $id("navShare").addEventListener("click", handleShareClick);
}

function handleShareClick() {
  if (currentScreen === "reaction") Reaction.shareReactionResult();
  else if (currentScreen === "compat") Compat.shareCompatResult();
  else if (["colorgame", "colorpractice", "colorplay", "colorresult"].includes(currentScreen)) ColorGame.shareColorResult();
  else if (currentScreen === "crop") Crop.shareCropResult();
}

// ============================================================
// 메인 화면 티켓
// ============================================================
function recordLine(icon, label, top, valueText) {
  if (!top) {
    return `<div class="ticket-row"><span class="label">${icon} ${label}</span><span class="value empty">아직 기록 없음</span></div>`;
  }
  return `<div class="ticket-row"><span class="label">${icon} ${label}</span><span class="value">${valueText} <span style="color:var(--text-faint); font-size:10.5px;">${top.emoji || "🙂"}${top.nickname || "익명"}</span></span></div>`;
}

async function renderMainTicket() {
  $id("ticketDate").textContent = todayLabel();
  const rows = $id("ticketRows");

  const [reactionTop, easyTop, normalTop, hardTop, extremeTop, bestCompat, cropTop] = await Promise.all([
    Reaction.getTodayTop1(),
    ColorGame.getTodayTop1("easy"),
    ColorGame.getTodayTop1("normal"),
    ColorGame.getTodayTop1("hard"),
    ColorGame.getTodayTop1("extreme"),
    Compat.getTodayBestCompatForTicket(),
    Crop.getTodayTop1(),
  ]);

  const compatRow = bestCompat
    ? `<div class="ticket-row"><span class="label">💕 베스트 궁합</span><span class="value">${bestCompat.nameA}❤️${bestCompat.nameB} <span style="color:var(--text-faint); font-size:10.5px;">${bestCompat.score}점</span></span></div>`
    : `<div class="ticket-row"><span class="label">💕 베스트 궁합</span><span class="value empty">아직 기록 없음</span></div>`;

  const cropRow = cropTop
    ? `<div class="ticket-row"><span class="label">🫜 오늘의 무값!</span><span class="value">${cropTop.profitPct >= 0 ? "+" : ""}${cropTop.profitPct.toFixed(1)}% <span style="color:var(--text-faint); font-size:10.5px;">${cropTop.emoji || "🙂"}${cropTop.nickname || "익명"}</span></span></div>`
    : `<div class="ticket-row"><span class="label">🫜 오늘의 무값!</span><span class="value empty">아직 기록 없음</span></div>`;

  rows.innerHTML = `
    ${recordLine("⚡", "반응속도", reactionTop, reactionTop ? fmtMs(reactionTop.ms) : "")}
    ${recordLine("🎨", "초급", easyTop, easyTop ? fmtSec(easyTop.easyBestMs) : "")}
    ${recordLine("🎨", "중급", normalTop, normalTop ? fmtSec(normalTop.normalBestMs) : "")}
    ${recordLine("🎨", "고급", hardTop, hardTop ? fmtSec(hardTop.hardBestMs) : "")}
    ${recordLine("🎨", "익스트림", extremeTop, extremeTop ? fmtSec(extremeTop.extremeBestMs) : "")}
    ${compatRow}
    ${cropRow}
  `;
}

// ============================================================
// 반응속도 화면
// ============================================================
function bindReactionScreen() {
  $id("reactionStage").addEventListener("click", () => {
    Reaction.handleStageTap();
    renderStars();
  });
  $id("reactionSettingsBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    openReactionSettings();
  });
}

function openReactionSettings() {
  const current = Reaction.getColorMode();
  const optionsHtml = Reaction.COLOR_MODE_OPTIONS.map(
    (o) => `<button class="settings-option ${o.key === current ? "active" : ""}" data-mode="${o.key}" type="button">${o.label}</button>`
  ).join("");
  const { root, close } = modalShell("⚙️ 원 색상 설정", `<div class="settings-list">${optionsHtml}</div>`);
  root.querySelectorAll(".settings-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      Reaction.setColorMode(btn.dataset.mode);
      showToast("색상 설정을 저장했어요");
      close();
    });
  });
}

// ============================================================
// 궁합 화면
// ============================================================
function bindCompatScreen() {
  $id("compatSubmit").addEventListener("click", () => {
    const a = $id("compatNameA").value;
    const b = $id("compatNameB").value;
    const valid = Compat.validateNames(a, b);
    if (valid.error) {
      showToast(valid.error);
      return;
    }
    if (!canAffordStars(Compat.CHECK_COST)) {
      showToast(`⭐ 별이 부족해요 (${Compat.CHECK_COST}개 필요)`);
      return;
    }
    spendStars(Compat.CHECK_COST);
    renderStars();
    const result = Compat.computeCompat(valid.nameA, valid.nameB);
    $id("compatForm").classList.add("hidden");
    const panel = $id("compatResultPanel");
    panel.classList.remove("hidden");
    $id("compatNamesLine").textContent = `${result.nameA} ❤️ ${result.nameB}`;
    $id("compatScore").textContent = `${result.score}점`;
    $id("compatType").textContent = result.type.badge;
    $id("compatDesc").textContent = result.type.desc;
  });

  $id("compatRetry").addEventListener("click", resetCompatScreen);
}

function resetCompatScreen() {
  $id("compatForm").classList.remove("hidden");
  $id("compatResultPanel").classList.add("hidden");
  $id("compatNameA").value = "";
  $id("compatNameB").value = "";
}

// ============================================================
// 틀린색상 찾기 화면
// ============================================================
async function renderDiffSelect() {
  const wrap = $id("diffSelect");
  wrap.innerHTML = `<p class="hint" style="text-align:center; padding:20px 0;"><span class="loading-spin"></span> 불러오는 중…</p>`;
  const progress = await ColorGame.getMyProgress();

  wrap.innerHTML = "";
  Object.values(ColorGame.DIFFICULTIES).forEach((cfg) => {
    const p = progress[cfg.key];
    const locked = p.attempts >= cfg.maxAttempts;
    const hearts = Array.from({ length: cfg.maxAttempts })
      .map((_, i) => `<span class="${i < p.attempts ? "used" : ""}">${i < p.attempts ? "🤍" : "❤️"}</span>`)
      .join("");
    const btn = document.createElement("button");
    btn.className = `diff-card${locked ? " locked" : ""}`;
    btn.type = "button";
    btn.innerHTML = `
      <div>
        <div class="diff-name">${cfg.label} · ${cfg.grid}×${cfg.grid}</div>
        <div class="diff-sub">${p.bestMs != null ? `오늘 최고 ${fmtSec(p.bestMs)}` : "기록 없음"} · 제한시간 ${(cfg.timeLimitMs / 1000).toFixed(0)}초</div>
      </div>
      <div class="hearts">${hearts}</div>
    `;
    btn.addEventListener("click", () => {
      if (locked) {
        showToast("오늘 도전 횟수를 모두 사용했어요 (3/3)");
        return;
      }
      beginColorRound(cfg.key, "ranked");
    });
    wrap.appendChild(btn);
  });

  if (progress.totalBestMs != null) {
    const summary = document.createElement("p");
    summary.className = "hint";
    summary.style.textAlign = "center";
    summary.style.marginTop = "6px";
    summary.textContent = `오늘 종합 기록: ${fmtSec(progress.totalBestMs)}`;
    wrap.appendChild(summary);
  }
}

function renderPracticeSelect() {
  const wrap = $id("diffSelectPractice");
  wrap.innerHTML = "";
  Object.values(ColorGame.DIFFICULTIES).forEach((cfg) => {
    const btn = document.createElement("button");
    btn.className = "diff-card";
    btn.type = "button";
    btn.innerHTML = `
      <div>
        <div class="diff-name">${cfg.label} · ${cfg.grid}×${cfg.grid}</div>
        <div class="diff-sub">제한시간 ${(cfg.timeLimitMs / 1000).toFixed(0)}초</div>
      </div>
      <div class="hearts">♾️ 무제한</div>
    `;
    btn.addEventListener("click", () => startPracticeSession(cfg.key));
    wrap.appendChild(btn);
  });
}

function bindColorScreens() {
  $id("colorPlayAgain").addEventListener("click", () => showScreen("colorgame"));
  $id("colorPracticeStop").addEventListener("click", () => {
    practiceActive = false;
    ColorGame.cancelRound();
    showScreen("colorpractice");
  });
}

let currentColorMode = "ranked";
let practiceActive = false;
let practiceStats = { rounds: 0, success: 0 };

function setColorBackTargets() {
  const target = currentColorMode === "practice" ? "colorpractice" : "colorgame";
  $id("colorPlayBack").dataset.nav = target;
  $id("colorResultBack").dataset.nav = target;
}

// 랭크(오늘의 도전) 모드: 한 라운드 플레이 후 결과 화면으로 이동
function beginColorRound(diffKey, mode) {
  currentColorDiff = diffKey;
  currentColorMode = mode;
  practiceActive = false;
  setColorBackTargets();
  $id("colorPracticeStop").classList.add("hidden");
  showScreen("colorplay");
  playColorRound(diffKey, mode, (result) => renderColorResult(result));
}

// 연습 모드: 사용자가 종료를 누를 때까지 자동으로 다음 라운드가 이어짐
function startPracticeSession(diffKey) {
  currentColorDiff = diffKey;
  currentColorMode = "practice";
  practiceActive = true;
  practiceStats = { rounds: 0, success: 0 };
  setColorBackTargets();
  $id("colorPracticeStop").classList.remove("hidden");
  showScreen("colorplay");
  loopPracticeRound(diffKey);
}

function loopPracticeRound(diffKey) {
  if (!practiceActive) return;
  playColorRound(diffKey, "practice", (result) => {
    practiceStats.rounds += 1;
    if (result.success) practiceStats.success += 1;
    if (!practiceActive) return;
    setTimeout(() => loopPracticeRound(diffKey), 220);
  });
}

// 한 라운드를 그리고, 끝나면 onRoundEnd(result)를 호출
function playColorRound(diffKey, mode, onRoundEnd) {
  const cfg = ColorGame.DIFFICULTIES[diffKey];
  $id("colorPlayTitle").textContent = `${mode === "practice" ? "🎯 연습" : "🎨"} · ${cfg.label}`;

  let cellEls = [];

  const { colors, grid, timeLimitMs } = ColorGame.startRound(diffKey, mode, {
    onTick: (remainMs) => {
      const timerEl = $id("colorTimer");
      const sec = remainMs / 1000;
      timerEl.textContent = sec.toFixed(1);
      timerEl.classList.toggle("warn", sec <= 2);
    },
    onResolved: ({ success, reason, oddIndex, tappedIndex }) => {
      // 정답/오답 여부와 실제 정답 위치를 바로 알려줌
      cellEls.forEach((el) => (el.disabled = true));
      if (cellEls[oddIndex]) cellEls[oddIndex].classList.add("reveal-correct");
      if (!success && reason === "wrong" && tappedIndex != null && cellEls[tappedIndex]) {
        cellEls[tappedIndex].classList.add("reveal-wrong");
        cellEls[tappedIndex].innerHTML = `<span class="mark">✕</span>`;
      }
      if (cellEls[oddIndex]) cellEls[oddIndex].innerHTML += `<span class="mark">✓</span>`;
      showToast(success ? "정답이에요! 🎉" : reason === "timeout" ? "시간 초과예요 ⏰" : "여기가 아니었어요");
    },
    onEnd: (result) => onRoundEnd(result),
  });

  const infoText =
    mode === "practice"
      ? `${cfg.label} ${grid}×${grid} · ${practiceStats.rounds + 1}번째 (정답 ${practiceStats.success}개)`
      : `${cfg.label} ${grid}×${grid}`;
  $id("colorPlayInfo").textContent = infoText;
  $id("colorTimer").textContent = (timeLimitMs / 1000).toFixed(1);
  $id("colorTimer").classList.remove("warn");

  const gridEl = $id("colorGrid");
  gridEl.style.gridTemplateColumns = `repeat(${grid}, 1fr)`;
  gridEl.innerHTML = "";
  cellEls = colors.map((color, i) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "color-cell";
    cell.style.background = color;
    cell.addEventListener("click", () => ColorGame.submitCellTap(i));
    gridEl.appendChild(cell);
    return cell;
  });
}

function renderColorResult(result) {
  const cfg = ColorGame.DIFFICULTIES[result.diffKey];
  showScreen("colorresult");
  const badge = $id("colorResultBadge");
  badge.className = `result-badge ${result.success ? "win" : "lose"}`;
  badge.textContent = result.success ? `🎉 성공! ${fmtSec(result.elapsedMs)}` : result.reason === "timeout" ? "⏰ 시간 초과!" : "❌ 다른 칸이었어요";

  const remain = result.progress.maxAttempts - result.progress.attempts;
  $id("colorResultPanel").innerHTML = `
    <div class="ticket-row"><span class="label">${cfg.label} 오늘 최고 기록</span><span class="value">${result.progress.bestMs != null ? fmtSec(result.progress.bestMs) : "-"}</span></div>
    <div class="ticket-row"><span class="label">남은 도전 횟수</span><span class="value">${Math.max(0, remain)}/${result.progress.maxAttempts}</span></div>
  `;
}

// ============================================================
// 랭킹 모달
// ============================================================
async function openRankingModal() {
  if (currentScreen === "reaction") return openReactionRanking();
  if (currentScreen === "compat") return openCompatRanking();
  if (currentScreen === "crop") return openCropRanking();
  return openColorRanking();
}

function modalShell(titleHtml, bodyHtml) {
  const root = $id("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop" id="modalBackdrop">
      <div class="modal-sheet">
        <div class="modal-sheet-inner">
          <button class="modal-close" id="modalCloseBtn">✕</button>
          <h2>${titleHtml}</h2>
          ${bodyHtml}
        </div>
      </div>
    </div>
  `;
  const close = () => (root.innerHTML = "");
  $id("modalCloseBtn").addEventListener("click", close);
  $id("modalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "modalBackdrop") close();
  });
  return { close, root };
}

function rankListHtml(list, formatFn) {
  if (!list.length) return `<div class="rank-empty">아직 오늘의 기록이 없어요.<br/>첫 번째 도전자가 되어보세요!</div>`;
  const medalClass = (i) => (i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "");
  return `<div class="rank-list">${list
    .map(
      (item, i) => `
      <div class="rank-row">
        <span class="pos ${medalClass(i)}">${i + 1}</span>
        <span class="name">${item.emoji || "🙂"} ${item.nickname || item.nameA + " & " + item.nameB || "익명"}</span>
        <span class="score">${formatFn(item)}</span>
      </div>`
    )
    .join("")}</div>`;
}

async function openReactionRanking() {
  const { root } = modalShell(
    "🏆 반응속도 순위",
    `<div class="tabs">
      <button class="tab-btn active" id="tabToday" type="button">오늘의 기록</button>
      <button class="tab-btn" id="tabAll" type="button">전체 최고기록</button>
    </div>
    <div id="rankBody"><span class="loading-spin"></span></div>`
  );
  const body = () => root.querySelector("#rankBody");

  async function loadToday() {
    body().innerHTML = `<span class="loading-spin"></span>`;
    const list = await Reaction.getTodayRanking();
    body().innerHTML = rankListHtml(list, (item) => fmtMs(item.ms));
  }
  async function loadAll() {
    body().innerHTML = `<span class="loading-spin"></span>`;
    const list = await Reaction.getAllTimeRanking();
    body().innerHTML = rankListHtml(list, (item) => fmtMs(item.ms));
  }
  root.querySelector("#tabToday").addEventListener("click", (e) => {
    root.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    loadToday();
  });
  root.querySelector("#tabAll").addEventListener("click", (e) => {
    root.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    loadAll();
  });
  loadToday();
}

async function openCompatRanking() {
  const { root } = modalShell("🏆 오늘의 베스트 궁합", `<div id="rankBody"><span class="loading-spin"></span></div>`);
  const list = await Compat.getTodayCompatRanking();
  root.querySelector("#rankBody").innerHTML = rankListHtml(list, (item) => `${item.score}점`);
}

async function openColorRanking() {
  const diffKey = currentColorDiff || "easy";
  const { root } = modalShell(
    "🏆 틀린색상 찾기 순위",
    `<div class="tabs">
      <button class="tab-btn active" data-diff="easy" type="button">초급</button>
      <button class="tab-btn" data-diff="normal" type="button">중급</button>
      <button class="tab-btn" data-diff="hard" type="button">고급</button>
      <button class="tab-btn" data-diff="extreme" type="button">익스트림</button>
      <button class="tab-btn" data-diff="total" type="button">종합</button>
    </div>
    <div id="rankBody"><span class="loading-spin"></span></div>`
  );
  const body = () => root.querySelector("#rankBody");

  async function load(key) {
    body().innerHTML = `<span class="loading-spin"></span>`;
    const list = key === "total" ? await ColorGame.getTodayTotalRanking() : await ColorGame.getTodayRanking(key);
    const field = key === "total" ? "totalBestMs" : `${key}BestMs`;
    body().innerHTML = rankListHtml(list, (item) => fmtSec(item[field]));
  }
  root.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      load(btn.dataset.diff);
    });
  });
  load(diffKey === "total" ? "easy" : diffKey);
}

// ============================================================
// 닉네임 편집 모달
// ============================================================
function openNicknameModal() {
  const { root, close } = modalShell(
    "✏️ 닉네임 바꾸기",
    `<input class="field" id="nicknameInput" maxlength="12" placeholder="새 닉네임" value="${nickname.nickname}" />
     <button class="btn primary reaction" id="nicknameSaveBtn" type="button">저장하기</button>`
  );
  root.querySelector("#nicknameSaveBtn").addEventListener("click", async () => {
    const val = root.querySelector("#nicknameInput").value.trim();
    if (!val) return showToast("닉네임을 입력해주세요");
    const res = await updateNickname(val, nickname.emoji);
    if (!res.ok) return showToast("이미 사용 중인 닉네임이에요");
    nickname = { nickname: val, emoji: nickname.emoji };
    Reaction.setNickname(nickname);
    ColorGame.setNickname(nickname);
    Crop.setNickname(nickname);
    renderNickname();
    showToast("닉네임을 변경했어요!");
    close();
    // 오늘 이미 저장된 순위 기록이 있다면 닉네임 표시도 함께 갱신 (실패해도 무시)
    Reaction.refreshNicknameOnRecords();
    ColorGame.refreshNicknameOnRecords();
    Crop.refreshNicknameOnRecords();
  });
}

// ============================================================
// 🫜 오늘의 무값! (농작물 거래)
// ============================================================
let cropTimerId = null;
const cropQty = {}; // cropKey -> 현재 입력된 수량

function startCropScreen() {
  Crop.CROPS.forEach((c) => { if (!(c.key in cropQty)) cropQty[c.key] = 1; });

  const { settled, totalCredited } = Crop.checkDayRolloverAndSettle();
  if (settled.length > 0) {
    const parts = settled.map((s) => `${s.crop.emoji}${s.qty}개`).join(", ");
    showToast(`어제 남은 ${parts} → 종가로 자동 정산, ⭐${totalCredited} 지급!`);
    renderStars();
  }

  renderCropList();
  renderCropSummary();
  clearInterval(cropTimerId);
  let lastTick = Crop.getCurrentTick();
  cropTimerId = setInterval(() => {
    const remain = Crop.msUntilNextTick();
    const mm = Math.floor(remain / 60000);
    const ss = Math.floor((remain % 60000) / 1000);
    $id("cropCountdown").textContent = `${mm}:${String(ss).padStart(2, "0")}`;
    const tick = Crop.getCurrentTick();
    if (tick !== lastTick) {
      lastTick = tick;
      renderCropList();
      renderCropSummary();
      Crop.syncNow(); // 보유 재고 평가액이 바뀌었으니 순위표도 최신화
    }
  }, 1000);
}

function stopCropTimer() {
  clearInterval(cropTimerId);
  cropTimerId = null;
}

function renderCropSummary() {
  const { profitPct, buyCost, holdingsValue, sellRevenue } = Crop.getTodayStats();
  const el = $id("cropProfit");
  if (profitPct == null) {
    el.textContent = "아직 거래 없음";
    el.style.color = "var(--text-faint)";
  } else {
    const sign = profitPct >= 0 ? "+" : "";
    el.textContent = `${sign}${profitPct.toFixed(1)}%`;
    el.style.color = profitPct >= 0 ? "var(--success)" : "var(--danger)";
  }
  $id("cropHoldingsInfo").textContent = `보유 평가액 ⭐${holdingsValue} · 누적 매수 ⭐${buyCost} · 누적 매도 ⭐${sellRevenue}`;
}

function renderCropList() {
  const wrap = $id("cropList");
  const inv = Crop.getInventory();
  const tick = Crop.getCurrentTick();
  wrap.innerHTML = "";

  Crop.CROPS.forEach((c) => {
    const price = Crop.getPrice(c.key, tick);
    const prevPrice = tick > 0 ? Crop.getPrice(c.key, tick - 1) : price;
    const diff = price - prevPrice;
    const trendClass = diff > 0 ? "crop-trend-up" : diff < 0 ? "crop-trend-down" : "crop-trend-flat";
    const trendIcon = diff > 0 ? "▲" : diff < 0 ? "▼" : "―";
    const diffText = diff !== 0 ? `${diff > 0 ? "+" : ""}${diff}` : "변동없음";
    const owned = inv[c.key] || 0;

    const row = document.createElement("div");
    row.className = "crop-row";
    row.innerHTML = `
      <div class="crop-row-top">
        <span class="crop-row-name">${c.emoji} ${c.label}</span>
        <span class="crop-row-price-block">
          <span class="crop-row-price">⭐${price}</span>
          <span class="crop-row-trend ${trendClass}">${trendIcon} ${diffText}</span>
        </span>
      </div>
      <div class="crop-row-sub">보유 ${owned}개 · 평가액 ⭐${owned * price} · 이전가 ⭐${prevPrice}</div>
      <div class="crop-row-controls">
        <input type="number" min="1" value="${cropQty[c.key]}" class="crop-qty" data-crop="${c.key}" />
        <button class="crop-btn buy" data-action="buy" data-crop="${c.key}" type="button">구매 ⭐${price}</button>
        <button class="crop-btn sell${owned > 0 ? " sell-active" : ""}" data-action="sell" data-crop="${c.key}" type="button" ${owned <= 0 ? "disabled" : ""}>판매</button>
      </div>
    `;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll(".crop-qty").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.crop;
      const v = Math.max(1, parseInt(input.value, 10) || 1);
      cropQty[key] = v;
      input.value = v;
    });
  });
  wrap.querySelectorAll(".crop-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.crop;
      const qty = cropQty[key] || 1;
      if (btn.dataset.action === "buy") {
        const res = Crop.buyCrop(key, qty);
        if (!res.ok) {
          showToast(`⭐ 별이 부족해요 (${res.cost}개 필요)`);
          return;
        }
        showToast(`${qty}개 구매! ⭐${res.cost} 사용`);
      } else {
        const res = Crop.sellCrop(key, qty);
        if (!res.ok) {
          showToast("보유한 수량보다 많이 팔 수 없어요");
          return;
        }
        showToast(`${qty}개 판매! ⭐${res.revenue} 획득`);
      }
      renderStars();
      renderCropList();
      renderCropSummary();
    });
  });
}

function bindCropScreen() {
  // 리스트/버튼은 매 렌더링마다 동적으로 바인딩됨 (renderCropList 참고)
}

async function openCropRanking() {
  const { root } = modalShell("🏆 오늘의 무값! 수익률 순위", `<div id="rankBody"><span class="loading-spin"></span></div>`);
  const list = await Crop.getTodayRanking();
  root.querySelector("#rankBody").innerHTML = rankListHtml(list, (item) => `${item.profitPct >= 0 ? "+" : ""}${item.profitPct.toFixed(1)}%`);
}

init();
