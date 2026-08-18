import { ensureNickname, updateNickname, todayLabel, showToast, fmtMs, fmtSec } from "./utils.js";
import * as Reaction from "./games/reaction.js";
import * as Compat from "./games/compat.js";
import * as ColorGame from "./games/colormatch.js";

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

  nickname = await ensureNickname();
  Reaction.setNickname(nickname);
  ColorGame.setNickname(nickname);
  renderNickname();

  await renderMainTicket();
  showScreen("main");
}

function renderNickname() {
  $id("nicknameEmoji").textContent = nickname.emoji;
  $id("nicknameLabel").textContent = nickname.nickname;
}

// ============================================================
// 화면 전환
// ============================================================
const SCREEN_IDS = ["main", "reaction", "compat", "colorgame", "colorplay", "colorresult"];

function showScreen(name) {
  if (currentScreen === "colorplay" && name !== "colorplay") {
    ColorGame.cancelRound();
  }
  currentScreen = name;
  for (const id of SCREEN_IDS) {
    $id(`screen-${id}`).classList.toggle("hidden", id !== name);
  }
  $id("bottomNav").classList.toggle("hidden", name === "main");

  if (name === "reaction") Reaction.resetReactionScreen();
  if (name === "compat") resetCompatScreen();
  if (name === "colorgame") renderDiffSelect();
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
  else if (currentScreen === "colorgame" || currentScreen === "colorplay" || currentScreen === "colorresult") ColorGame.shareColorResult();
}

// ============================================================
// 메인 화면 티켓
// ============================================================
async function renderMainTicket() {
  $id("ticketDate").textContent = todayLabel();
  const rows = $id("ticketRows");

  const [reactionSummary, colorProgress, bestCompat] = await Promise.all([
    Reaction.getMySummaryToday(),
    ColorGame.getMyProgress(),
    Compat.getTodayBestCompatForTicket(),
  ]);

  const reactionRow = reactionSummary
    ? `<span class="value">${fmtMs(reactionSummary.ms)} <span style="color:var(--text-faint); font-size:11px;">(${reactionSummary.rank}/${reactionSummary.total}위)</span></span>`
    : `<span class="value empty">아직 기록 없음</span>`;

  const colorParts = [];
  if (colorProgress.easy.bestMs != null) colorParts.push(`초${fmtSec(colorProgress.easy.bestMs)}`);
  if (colorProgress.normal.bestMs != null) colorParts.push(`중${fmtSec(colorProgress.normal.bestMs)}`);
  if (colorProgress.hard.bestMs != null) colorParts.push(`고${fmtSec(colorProgress.hard.bestMs)}`);
  const colorRow = colorParts.length
    ? `<span class="value">${colorParts.join(" · ")}</span>`
    : `<span class="value empty">아직 기록 없음</span>`;

  const compatRow = bestCompat
    ? `<span class="value">${bestCompat.nameA}❤️${bestCompat.nameB} ${bestCompat.score}점</span>`
    : `<span class="value empty">아직 기록 없음</span>`;

  rows.innerHTML = `
    <div class="ticket-row"><span class="label">⚡ 반응속도</span>${reactionRow}</div>
    <div class="ticket-row"><span class="label">🎨 틀린색상</span>${colorRow}</div>
    <div class="ticket-row"><span class="label">💕 베스트 궁합</span>${compatRow}</div>
  `;
}

// ============================================================
// 반응속도 화면
// ============================================================
function bindReactionScreen() {
  $id("reactionStage").addEventListener("click", () => {
    Reaction.handleStageTap();
  });
}

// ============================================================
// 궁합 화면
// ============================================================
function bindCompatScreen() {
  $id("compatSubmit").addEventListener("click", () => {
    const a = $id("compatNameA").value;
    const b = $id("compatNameB").value;
    const result = Compat.computeCompat(a, b);
    if (result.error) {
      showToast(result.error);
      return;
    }
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
      beginColorRound(cfg.key);
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

function bindColorScreens() {
  $id("colorPlayAgain").addEventListener("click", () => showScreen("colorgame"));
}

function beginColorRound(diffKey) {
  currentColorDiff = diffKey;
  const cfg = ColorGame.DIFFICULTIES[diffKey];
  showScreen("colorplay");
  $id("colorPlayTitle").textContent = `🎨 틀린색상 찾기 · ${cfg.label}`;

  const { colors, grid, timeLimitMs } = ColorGame.startRound(diffKey, {
    onTick: (remainMs) => {
      const timerEl = $id("colorTimer");
      const sec = remainMs / 1000;
      timerEl.textContent = sec.toFixed(1);
      timerEl.classList.toggle("warn", sec <= 2);
    },
    onEnd: (result) => renderColorResult(result),
  });

  $id("colorPlayInfo").textContent = `${cfg.label} ${grid}×${grid}`;
  $id("colorTimer").textContent = (timeLimitMs / 1000).toFixed(1);
  $id("colorTimer").classList.remove("warn");

  const gridEl = $id("colorGrid");
  gridEl.style.gridTemplateColumns = `repeat(${grid}, 1fr)`;
  gridEl.innerHTML = "";
  colors.forEach((color, i) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "color-cell";
    cell.style.background = color;
    cell.addEventListener("click", () => ColorGame.submitCellTap(i));
    gridEl.appendChild(cell);
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
    renderNickname();
    showToast("닉네임을 변경했어요!");
    close();
  });
}

init();
