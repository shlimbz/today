import { db, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, serverTimestamp } from "../firebase-config.js";
import { todayKey, getUserId, showToast, shareText, fmtSec } from "../utils.js";

// 난이도 설정 — 그리드 크기가 커질수록 색 차이(delta)는 줄이고, 제한시간은 넉넉히 늘림
export const DIFFICULTIES = {
  easy: { key: "easy", label: "초급", grid: 3, delta: 16, timeLimitMs: 6000, maxAttempts: 3 },
  normal: { key: "normal", label: "중급", grid: 4, delta: 10, timeLimitMs: 9000, maxAttempts: 3 },
  hard: { key: "hard", label: "고급", grid: 5, delta: 6, timeLimitMs: 12000, maxAttempts: 3 },
};

let currentNickname = { nickname: "", emoji: "" };
export function setNickname(n) { currentNickname = n; }

let round = null; // { diffKey, oddIndex, startAt, timerId, tickId, ended }
let lastResult = null;

// ------------------------------------------------------------
// 오늘자 내 진행상황 (attempts / bestMs)
// ------------------------------------------------------------
async function getMyDayDoc() {
  const date = todayKey();
  const userId = getUserId();
  const ref = doc(db, "colorDaily", date, "records", userId);
  try {
    const snap = await getDoc(ref);
    return { ref, data: snap.exists() ? snap.data() : {} };
  } catch (e) {
    return { ref: null, data: {} };
  }
}

export async function getMyProgress() {
  const { data } = await getMyDayDoc();
  const out = {};
  for (const key of Object.keys(DIFFICULTIES)) {
    out[key] = {
      attempts: data[`${key}Attempts`] || 0,
      bestMs: data[`${key}BestMs`] ?? null,
    };
  }
  out.totalBestMs = data.totalBestMs ?? null;
  return out;
}

// ------------------------------------------------------------
// 라운드 생성
// ------------------------------------------------------------
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generateColors(diffKey) {
  const cfg = DIFFICULTIES[diffKey];
  const cellCount = cfg.grid * cfg.grid;
  const hue = randInt(0, 359);
  const sat = randInt(52, 68);
  const baseLight = randInt(42, 58);
  const oddIndex = randInt(0, cellCount - 1);
  const sign = Math.random() < 0.5 ? -1 : 1;
  let oddLight = baseLight + sign * cfg.delta;
  oddLight = Math.max(8, Math.min(92, oddLight));

  const colors = new Array(cellCount).fill(`hsl(${hue} ${sat}% ${baseLight}%)`);
  colors[oddIndex] = `hsl(${hue} ${sat}% ${oddLight}%)`;
  return { colors, oddIndex, cellCount };
}

export function canPlay(diffKey, progress) {
  return (progress[diffKey]?.attempts || 0) < DIFFICULTIES[diffKey].maxAttempts;
}

// ------------------------------------------------------------
// 라운드 시작 / 종료 (main.js 가 DOM 렌더 및 콜백 연결을 담당)
// ------------------------------------------------------------
export function startRound(diffKey, { onTick, onEnd }) {
  const cfg = DIFFICULTIES[diffKey];
  const { colors, oddIndex } = generateColors(diffKey);
  const startAt = performance.now();

  round = { diffKey, oddIndex, startAt, ended: false, onEnd };

  const tickId = setInterval(() => {
    if (!round || round.ended) return;
    const elapsed = performance.now() - round.startAt;
    const remain = Math.max(0, cfg.timeLimitMs - elapsed);
    onTick(remain);
    if (remain <= 0) {
      endRound(false, "timeout");
    }
  }, 100);

  round.tickId = tickId;
  return { colors, oddIndex, grid: cfg.grid, timeLimitMs: cfg.timeLimitMs };
}

// 결과를 저장하지 않고 진행 중인 라운드만 정리 (뒤로가기 등으로 이탈할 때 사용)
export function cancelRound() {
  if (round && !round.ended) {
    round.ended = true;
    clearInterval(round.tickId);
  }
}

export function submitCellTap(index) {
  if (!round || round.ended) return;
  const correct = index === round.oddIndex;
  endRound(correct, correct ? "correct" : "wrong");
}

function endRound(success, reason) {
  if (!round || round.ended) return;
  round.ended = true;
  clearInterval(round.tickId);
  const elapsedMs = performance.now() - round.startAt;
  const diffKey = round.diffKey;
  const onEnd = round.onEnd;
  saveRoundResult(diffKey, success, elapsedMs).then((progress) => {
    lastResult = { diffKey, success, reason, elapsedMs, progress };
    onEnd(lastResult);
  });
}

async function saveRoundResult(diffKey, success, elapsedMs) {
  const cfg = DIFFICULTIES[diffKey];
  const { ref, data } = await getMyDayDoc();
  const attemptsField = `${diffKey}Attempts`;
  const bestField = `${diffKey}BestMs`;

  const nextAttempts = (data[attemptsField] || 0) + 1;
  let nextBest = data[bestField] ?? null;
  if (success && (nextBest == null || elapsedMs < nextBest)) {
    nextBest = elapsedMs;
  }

  const payload = {
    userId: getUserId(),
    nickname: currentNickname.nickname,
    emoji: currentNickname.emoji,
    [attemptsField]: nextAttempts,
    updatedAt: serverTimestamp(),
  };
  if (nextBest != null) payload[bestField] = nextBest;

  const easyBest = diffKey === "easy" ? nextBest : data.easyBestMs;
  const normalBest = diffKey === "normal" ? nextBest : data.normalBestMs;
  const hardBest = diffKey === "hard" ? nextBest : data.hardBestMs;
  if (easyBest != null && normalBest != null && hardBest != null) {
    payload.totalBestMs = easyBest + normalBest + hardBest;
  }

  try {
    if (ref) await setDoc(ref, payload, { merge: true });
  } catch (e) {
    showToast("기록 저장에 실패했어요 (Firebase 설정을 확인하세요)");
  }

  cfg.maxAttempts; // no-op reference to keep cfg used
  return {
    attempts: nextAttempts,
    maxAttempts: cfg.maxAttempts,
    bestMs: nextBest,
  };
}

// ------------------------------------------------------------
// 순위
// ------------------------------------------------------------
export async function getTodayRanking(diffKey) {
  const date = todayKey();
  try {
    const q = query(collection(db, "colorDaily", date, "records"), orderBy(`${diffKey}BestMs`, "asc"), limit(10));
    const snaps = await getDocs(q);
    return snaps.docs.map((d) => d.data()).filter((d) => d[`${diffKey}BestMs`] != null);
  } catch (e) {
    return [];
  }
}

export async function getTodayTotalRanking() {
  const date = todayKey();
  try {
    const q = query(collection(db, "colorDaily", date, "records"), orderBy("totalBestMs", "asc"), limit(10));
    const snaps = await getDocs(q);
    return snaps.docs.map((d) => d.data()).filter((d) => d.totalBestMs != null);
  } catch (e) {
    return [];
  }
}

export function shareColorResult() {
  if (!lastResult) {
    showToast("먼저 게임을 플레이해보세요!");
    return;
  }
  const cfg = DIFFICULTIES[lastResult.diffKey];
  if (lastResult.success) {
    shareText({
      title: `🎨 틀린색상 찾기 · ${cfg.label}`,
      description: `${fmtSec(lastResult.elapsedMs)} 만에 찾았어요!`,
      imageEmoji: "🎨",
    });
  } else {
    shareText({
      title: `🎨 틀린색상 찾기 · ${cfg.label}`,
      description: `아깝게 실패! 오늘의 놀이터에서 같이 도전해요`,
      imageEmoji: "🎨",
    });
  }
}
