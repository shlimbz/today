import { db, doc, getDoc, setDoc, collection, query, orderBy, limit, where, getDocs, getCountFromServer, serverTimestamp } from "../firebase-config.js";
import { todayKey, getUserId, showToast, shareText, fmtMs, withTimeout } from "../utils.js";

const ROUNDS = 5;
const TARGET_SIZE = 62; // css .reaction-target 크기와 맞춰야 함
const FIRST_DELAY_RANGE = [800, 1800]; // 시작 후 첫 원이 뜨기까지
const GAP_RANGE = [350, 800]; // 원을 맞춘 뒤 다음 원이 뜨기까지

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

export function resetReactionScreen() {
  clearTimeout(spawnTimer);
  state = "idle";
  round = 0;
  times = [];
  setStageClass("idle");
  targetEl().classList.add("hidden");
  badgeEl().classList.add("hidden");
  showCenter("탭해서 시작", "화면에 나타나는 원 5개를 최대한 빨리 터치하세요");
}

function startGame() {
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
  const margin = TARGET_SIZE / 2 + 14;
  const x = randInt(margin, Math.max(margin, rect.width - margin));
  const y = randInt(margin, Math.max(margin, rect.height - margin));

  const t = targetEl();
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
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
    const [min, max] = GAP_RANGE;
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
  shareText({
    title: `⚡ 반응속도 평균 ${fmtMs(lastResultMs)}`,
    description: `오늘의 놀이터에서 5라운드 평균 ${Math.round(lastResultMs)}ms를 기록했어요!`,
    imageEmoji: "⚡",
  });
}
