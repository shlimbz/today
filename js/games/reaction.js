import { db, doc, getDoc, setDoc, collection, query, orderBy, limit, where, getDocs, getCountFromServer, serverTimestamp } from "../firebase-config.js";
import { todayKey, getUserId, showToast, shareText, fmtMs, withTimeout, spendStars, canAffordStars } from "../utils.js";

const ROUNDS = 5;
const TARGET_SIZE = 62; // css .reaction-target 기본 크기와 맞춰야 함
const FIRST_DELAY_RANGE = [600, 1400]; // 시작 후 첫 원이 뜨기까지 (더 스피디하게 단축)

// ------------------------------------------------------------
// 원 색상 설정 — 사용자가 고를 수 있는 프리셋 (localStorage에 저장)
// ------------------------------------------------------------
const COLOR_PRESETS = {
  yellow: { label: "🟡 노랑", make: () => "#FFB020" },
  red: { label: "🔴 빨강", make: () => "#F14747" },
  blue: { label: "🔵 파랑", make: () => "#3B82F6" },
  green: { label: "🟢 초록", make: () => "#22C55E" },
  black: { label: "⚫ 검정", make: () => "#232230" },
  random: { label: "🌈 매번 다른색", make: () => `hsl(${Math.floor(Math.random() * 360)} 78% 55%)` },
  multi: {
    label: "🎨 멀티컬러",
    make: () => {
      const h1 = Math.floor(Math.random() * 360);
      const h2 = (h1 + 110 + Math.floor(Math.random() * 140)) % 360;
      return `linear-gradient(135deg, hsl(${h1} 80% 55%), hsl(${h2} 80% 55%))`;
    },
  },
};
export const COLOR_MODE_OPTIONS = Object.entries(COLOR_PRESETS).map(([key, v]) => ({ key, label: v.label }));

let colorMode = localStorage.getItem("reactionColorMode") || "yellow";
export function getColorMode() { return colorMode; }
export function setColorMode(mode) {
  if (!COLOR_PRESETS[mode]) return;
  colorMode = mode;
  localStorage.setItem("reactionColorMode", mode);
}
function pickTargetColor() {
  return (COLOR_PRESETS[colorMode] || COLOR_PRESETS.yellow).make();
}

// 라운드가 진행될수록 다음 원이 더 빨리, 더 예측 불가능하게 등장 (속도감 강화)
function gapRangeForRound(nextRound) {
  const shrink = Math.min(350, (nextRound - 1) * 90);
  return [Math.max(160, 550 - shrink), Math.max(320, 950 - shrink)];
}
// 라운드가 진행될수록 원도 살짝 작아져서 마지막 라운드는 더 정교한 조준이 필요함 (최소 44px 유지)
function sizeForRound(r) {
  return Math.max(44, TARGET_SIZE - (r - 1) * 4);
}

const stageEl = () => document.getElementById("reactionStage");
const centerEl = () => document.getElementById("reactionCenter");
const msgEl = () => document.getElementById("reactionMsg");
const subEl = () => document.getElementById("reactionSub");
const targetEl = () => document.getElementById("reactionTarget");
const badgeEl = () => document.getElementById("reactionRoundBadge");

let state = "idle"; // idle | waiting | playing | fail | result
let spawnTimer = null;
let spawnAt = 0;
let round = 0;
let times = [];
let lastResultMs = null;
let todayBestMs = null;
let todayBestDate = null;

function trackLocalBest(ms) {
  const d = todayKey();
  if (todayBestDate !== d) {
    todayBestDate = d;
    todayBestMs = null;
  }
  if (todayBestMs == null || ms < todayBestMs) todayBestMs = ms;
}
let currentNickname = { nickname: "", emoji: "" };

export function setNickname(n) { currentNickname = n; }

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function setStageClass(cls) {
  stageEl().className = `reaction-stage state-${cls}`;
}

function showCenter(msgHtml, subHtml) {
  centerEl().classList.remove("hidden");
  msgEl().innerHTML = msgHtml;
  subEl().innerHTML = subHtml || "";
}
function hideCenter() {
  centerEl().classList.add("hidden");
}

export const PLAY_COST = 1;

export function resetReactionScreen() {
  clearTimeout(spawnTimer);
  state = "idle";
  round = 0;
  times = [];
  setStageClass("idle");
  targetEl().classList.add("hidden");
  badgeEl().classList.add("hidden");
  showCenter("탭해서 시작", `화면에 나타나는 원 5개를 최대한 빨리 터치하세요 · ⭐${PLAY_COST} 소모`);
}

function startGame() {
  if (!canAffordStars(PLAY_COST)) {
    showToast(`⭐ 별이 부족해요 (${PLAY_COST}개 필요)`);
    return;
  }
  spendStars(PLAY_COST);
  clearTimeout(spawnTimer);
  state = "waiting";
  round = 0;
  times = [];
  setStageClass("waiting");
  hideCenter();
  badgeEl().classList.remove("hidden");
  badgeEl().textContent = `0/${ROUNDS}`;
  const [min, max] = FIRST_DELAY_RANGE;
  spawnTimer = setTimeout(spawnTarget, randInt(min, max));
}

function spawnTarget() {
  round += 1;
  state = "playing";
  badgeEl().textContent = `${round}/${ROUNDS}`;

  const stage = stageEl();
  const rect = stage.getBoundingClientRect();
  const size = sizeForRound(round);
  const margin = size / 2 + 14;
  const x = randInt(margin, Math.max(margin, rect.width - margin));
  const y = randInt(margin, Math.max(margin, rect.height - margin));

  const t = targetEl();
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
  t.style.width = `${size}px`;
  t.style.height = `${size}px`;
  t.style.background = pickTargetColor();
  t.classList.remove("hidden");
  // 애니메이션 재시작을 위해 리플로우
  t.style.animation = "none";
  void t.offsetWidth;
  t.style.animation = "";

  spawnAt = performance.now();
  t.onclick = (e) => {
    e.stopPropagation();
    handleTargetTap();
  };
}

function handleTargetTap() {
  if (state !== "playing") return;
  const elapsed = performance.now() - spawnAt;
  times.push(elapsed);
  targetEl().classList.add("hidden");
  targetEl().onclick = null;

  if (round >= ROUNDS) {
    finishGame();
  } else {
    state = "waiting";
    const [min, max] = gapRangeForRound(round + 1);
    spawnTimer = setTimeout(spawnTarget, randInt(min, max));
  }
}

function finishGame() {
  clearTimeout(spawnTimer);
  state = "result";
  badgeEl().classList.add("hidden");
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  lastResultMs = avg;
  setStageClass("result");
  const breakdown = times.map((t, i) => `R${i + 1} ${Math.round(t)}ms`).join(" · ");
  showCenter(
    `<div class="big-num">${Math.round(avg)}<span style="font-size:20px;">ms 평균</span></div>`,
    `다시 탭하면 재도전! <div class="round-times">${breakdown}</div>`
  );
  saveRecord(avg);
}

function falseStart() {
  clearTimeout(spawnTimer);
  state = "fail";
  round = 0;
  times = [];
  targetEl().classList.add("hidden");
  badgeEl().classList.add("hidden");
  setStageClass("fail");
  showCenter("너무 성급했어요! 🙈", "원이 뜨기 전엔 화면을 누르지 마세요. 다시 탭해서 도전!");
}

// 스테이지(원이 아닌 배경) 탭 처리
export function handleStageTap() {
  if (state === "idle" || state === "fail" || state === "result") {
    startGame();
  } else if (state === "waiting") {
    falseStart();
  }
  // state === "playing" 인 경우 배경 탭은 무시 (원을 정확히 눌러야 함)
}

async function saveRecord(ms) {
  trackLocalBest(ms);
  const userId = getUserId();
  const date = todayKey();
  try {
    const dailyRef = doc(db, "reactionDaily", date, "records", userId);
    const snap = await withTimeout(getDoc(dailyRef), 4000);
    if (snap === null) return;
    const prevBest = snap.exists() ? snap.data().ms : null;
    if (prevBest == null || ms < prevBest) {
      await setDoc(dailyRef, {
        userId,
        nickname: currentNickname.nickname,
        emoji: currentNickname.emoji,
        ms,
        updatedAt: serverTimestamp(),
      });
    }

    const allTimeRef = doc(db, "reactionAllTime", userId);
    const allSnap = await withTimeout(getDoc(allTimeRef), 4000);
    if (allSnap === null) return;
    const prevAll = allSnap.exists() ? allSnap.data().ms : null;
    if (prevAll == null || ms < prevAll) {
      await setDoc(allTimeRef, {
        userId,
        nickname: currentNickname.nickname,
        emoji: currentNickname.emoji,
        ms,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (e) {
    // 순위표 반영만 실패, 게임 결과 자체엔 영향 없음
  }
}

export async function getTodayRanking() {
  const date = todayKey();
  try {
    const q = query(collection(db, "reactionDaily", date, "records"), orderBy("ms", "asc"), limit(10));
    const snaps = await withTimeout(getDocs(q), 4000);
    return snaps ? snaps.docs.map((d) => d.data()) : [];
  } catch (e) {
    return [];
  }
}

export async function getTodayTop1() {
  const list = await getTodayRanking();
  return list[0] || null;
}

export async function getAllTimeRanking() {
  try {
    const q = query(collection(db, "reactionAllTime"), orderBy("ms", "asc"), limit(10));
    const snaps = await withTimeout(getDocs(q), 4000);
    return snaps ? snaps.docs.map((d) => d.data()) : [];
  } catch (e) {
    return [];
  }
}

// 메인 화면 "오늘의 기록" 티켓용 — 내 오늘 평균 기록 + 대략적인 순위
export async function getMySummaryToday() {
  const date = todayKey();
  const userId = getUserId();
  try {
    const mineRef = doc(db, "reactionDaily", date, "records", userId);
    const mineSnap = await withTimeout(getDoc(mineRef), 3500);
    if (!mineSnap) return null;
    if (!mineSnap.exists()) return null;
    const ms = mineSnap.data().ms;

    const col = collection(db, "reactionDaily", date, "records");
    const betterQ = query(col, where("ms", "<", ms));
    const totalSnap = await withTimeout(getCountFromServer(col), 3500);
    const betterSnap = await withTimeout(getCountFromServer(betterQ), 3500);
    if (!totalSnap || !betterSnap) return { ms, rank: null, total: null };
    const rank = betterSnap.data().count + 1;
    const total = totalSnap.data().count;
    return { ms, rank, total };
  } catch (e) {
    return null;
  }
}

export function shareReactionResult() {
  if (lastResultMs == null) {
    showToast("먼저 기록을 측정해보세요!");
    return;
  }
  const best = todayBestDate === todayKey() && todayBestMs != null ? todayBestMs : lastResultMs;
  shareText({
    title: `⚡ 오늘 최고 반응속도 평균 ${fmtMs(best)}`,
    description: `오늘의 놀이터에서 5라운드 평균 ${Math.round(best)}ms를 기록했어요!`,
    imageEmoji: "⚡",
  });
}
