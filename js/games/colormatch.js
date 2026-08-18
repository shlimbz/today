import { db, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, serverTimestamp } from "../firebase-config.js";
import { todayKey, getUserId, djb2Hash, showToast, shareText, fmtSec, withTimeout } from "../utils.js";

// 난이도 설정 — 그리드 크기가 커질수록 색 차이(delta)는 줄이고, 제한시간은 넉넉히 늘림
export const DIFFICULTIES = {
  easy: { key: "easy", label: "초급", grid: 3, delta: 16, timeLimitMs: 6000, maxAttempts: 3 },
  normal: { key: "normal", label: "중급", grid: 4, delta: 10, timeLimitMs: 9000, maxAttempts: 3 },
  hard: { key: "hard", label: "고급", grid: 5, delta: 6, timeLimitMs: 12000, maxAttempts: 3 },
  extreme: { key: "extreme", label: "익스트림", grid: 6, delta: 4, timeLimitMs: 16000, maxAttempts: 3 },
};

const REVEAL_DELAY_MS = 900; // 정답 위치를 보여주는 시간

let currentNickname = { nickname: "", emoji: "" };
export function setNickname(n) { currentNickname = n; }

let round = null;
let lastResult = null;

// ------------------------------------------------------------
// 오늘자 내 진행상황(랭크 모드 전용) — localStorage를 1차 저장소로 사용해
// 즉시 반응하고, Firestore에는 순위표용으로 백그라운드에서만 동기화한다.
// 연습모드는 이 진행상황과 완전히 분리되어 횟수 제한이나 기록에 영향을 주지 않는다.
// ------------------------------------------------------------
function localKey() {
  return `colorProgress_${todayKey()}_${getUserId()}`;
}
function loadLocalDay() {
  try {
    const raw = localStorage.getItem(localKey());
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
function saveLocalDay(data) {
  try {
    localStorage.setItem(localKey(), JSON.stringify(data));
  } catch (e) {
    /* 저장 실패는 무시 (예: 프라이빗 모드) */
  }
}

export async function getMyProgress() {
  const data = loadLocalDay();
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

export function canPlay(diffKey, progress) {
  return (progress[diffKey]?.attempts || 0) < DIFFICULTIES[diffKey].maxAttempts;
}

// ------------------------------------------------------------
// 랜덤/시드 난수 생성기
//   - 연습모드: 매번 완전 무작위 (Math.random)
//   - 랭크(오늘의 도전)모드: "날짜 + 난이도 + 몇 번째 시도"로 시드를 고정해서
//     같은 날 같은 시도 차수라면 모든 사용자가 동일한 문제를 풉니다.
//     → 오늘의 최고기록끼리 진짜 실력 비교가 가능해짐.
// ------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seedStr) {
  if (!seedStr) return Math.random;
  return mulberry32(djb2Hash(seedStr));
}
function randIntWith(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function generateColors(diffKey, rng) {
  const cfg = DIFFICULTIES[diffKey];
  const cellCount = cfg.grid * cfg.grid;
  const hue = randIntWith(rng, 0, 359);
  const sat = randIntWith(rng, 62, 88);
  const baseLight = randIntWith(rng, 42, 58);
  const oddIndex = randIntWith(rng, 0, cellCount - 1);
  const sign = rng() < 0.5 ? -1 : 1;
  let oddLight = baseLight + sign * cfg.delta;
  oddLight = Math.max(8, Math.min(92, oddLight));

  const colors = new Array(cellCount).fill(`hsl(${hue} ${sat}% ${baseLight}%)`);
  colors[oddIndex] = `hsl(${hue} ${sat}% ${oddLight}%)`;
  return { colors, oddIndex, cellCount };
}

// ------------------------------------------------------------
// 라운드 시작 / 종료
//   mode: "ranked"(오늘의 도전, 횟수 제한 O, 기록 저장 O) | "practice"(무제한, 기록 미저장)
//   onTick(remainMs)                남은 시간 갱신
//   onResolved({success,...})       탭 직후 즉시 — 정답 칸 공개용
//   onEnd(finalResult)               결과 화면 전환용 (공개 딜레이 이후)
// ------------------------------------------------------------
export function startRound(diffKey, mode, { onTick, onResolved, onEnd }) {
  const cfg = DIFFICULTIES[diffKey];
  let seedStr = null;
  if (mode === "ranked") {
    const data = loadLocalDay();
    const attemptNumber = (data[`${diffKey}Attempts`] || 0) + 1;
    seedStr = `${todayKey()}|${diffKey}|${attemptNumber}`;
  }
  const rng = makeRng(seedStr);
  const { colors, oddIndex } = generateColors(diffKey, rng);
  const startAt = performance.now();

  round = { diffKey, mode, oddIndex, startAt, ended: false, onResolved, onEnd };

  const tickId = setInterval(() => {
    if (!round || round.ended) return;
    const elapsed = performance.now() - round.startAt;
    const remain = Math.max(0, cfg.timeLimitMs - elapsed);
    onTick(remain);
    if (remain <= 0) {
      resolveRound(false, "timeout", null);
    }
  }, 100);

  round.tickId = tickId;
  return { colors, oddIndex, grid: cfg.grid, timeLimitMs: cfg.timeLimitMs };
}

export function cancelRound() {
  if (round && !round.ended) {
    round.ended = true;
    clearInterval(round.tickId);
  }
}

export function submitCellTap(index) {
  if (!round || round.ended) return;
  const correct = index === round.oddIndex;
  resolveRound(correct, correct ? "correct" : "wrong", index);
}

function resolveRound(success, reason, tappedIndex) {
  if (!round || round.ended) return;
  round.ended = true;
  clearInterval(round.tickId);
  const elapsedMs = performance.now() - round.startAt;
  const diffKey = round.diffKey;
  const mode = round.mode;
  const oddIndex = round.oddIndex;
  const onResolved = round.onResolved;
  const onEnd = round.onEnd;

  // 1) 정답 위치를 즉시 알려준다 (저장을 기다리지 않음)
  onResolved({ success, reason, elapsedMs, oddIndex, tappedIndex });

  // 2) 랭크 모드만 진행상황을 로컬에 즉시 반영 (연습모드는 기록에 영향 없음)
  const progress = mode === "ranked" ? applyLocalResult(diffKey, success, elapsedMs) : null;

  // 3) 잠깐 정답을 보여준 뒤 결과 화면으로 전환
  setTimeout(() => {
    lastResult = { diffKey, mode, success, reason, elapsedMs, progress };
    onEnd(lastResult);
  }, REVEAL_DELAY_MS);

  // 4) 랭크 모드는 순위표용 데이터를 백그라운드에서 Firestore로 동기화
  if (mode === "ranked") {
    syncToFirestore(diffKey, progress).catch(() => {});
  }
}

function applyLocalResult(diffKey, success, elapsedMs) {
  const cfg = DIFFICULTIES[diffKey];
  const data = loadLocalDay();
  const attemptsField = `${diffKey}Attempts`;
  const bestField = `${diffKey}BestMs`;

  data[attemptsField] = (data[attemptsField] || 0) + 1;
  if (success && (data[bestField] == null || elapsedMs < data[bestField])) {
    data[bestField] = elapsedMs;
  }

  if (data.easyBestMs != null && data.normalBestMs != null && data.hardBestMs != null && data.extremeBestMs != null) {
    data.totalBestMs = data.easyBestMs + data.normalBestMs + data.hardBestMs + data.extremeBestMs;
  }

  saveLocalDay(data);

  return {
    attempts: data[attemptsField],
    maxAttempts: cfg.maxAttempts,
    bestMs: data[bestField] ?? null,
  };
}

async function syncToFirestore(diffKey, progress) {
  const date = todayKey();
  const userId = getUserId();
  const data = loadLocalDay();
  const payload = {
    userId,
    nickname: currentNickname.nickname,
    emoji: currentNickname.emoji,
    easyAttempts: data.easyAttempts || 0,
    normalAttempts: data.normalAttempts || 0,
    hardAttempts: data.hardAttempts || 0,
    extremeAttempts: data.extremeAttempts || 0,
    updatedAt: serverTimestamp(),
  };
  if (data.easyBestMs != null) payload.easyBestMs = data.easyBestMs;
  if (data.normalBestMs != null) payload.normalBestMs = data.normalBestMs;
  if (data.hardBestMs != null) payload.hardBestMs = data.hardBestMs;
  if (data.extremeBestMs != null) payload.extremeBestMs = data.extremeBestMs;
  if (data.totalBestMs != null) payload.totalBestMs = data.totalBestMs;

  try {
    const ref = doc(db, "colorDaily", date, "records", userId);
    await withTimeout(setDoc(ref, payload, { merge: true }), 4000);
  } catch (e) {
    // 순위표 반영만 실패, 플레이 자체에는 영향 없음
  }
}

// ------------------------------------------------------------
// 순위
// ------------------------------------------------------------
export async function getTodayRanking(diffKey) {
  const date = todayKey();
  try {
    const q = query(collection(db, "colorDaily", date, "records"), orderBy(`${diffKey}BestMs`, "asc"), limit(10));
    const snaps = await withTimeout(getDocs(q), 4000);
    if (!snaps) return [];
    return snaps.docs.map((d) => d.data()).filter((d) => d[`${diffKey}BestMs`] != null);
  } catch (e) {
    return [];
  }
}

export async function getTodayTotalRanking() {
  const date = todayKey();
  try {
    const q = query(collection(db, "colorDaily", date, "records"), orderBy("totalBestMs", "asc"), limit(10));
    const snaps = await withTimeout(getDocs(q), 4000);
    if (!snaps) return [];
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
  const modeLabel = lastResult.mode === "practice" ? " (연습)" : "";
  if (lastResult.success) {
    shareText({
      title: `🎨 틀린색상 찾기 · ${cfg.label}${modeLabel}`,
      description: `${fmtSec(lastResult.elapsedMs)} 만에 찾았어요!`,
      imageEmoji: "🎨",
    });
  } else {
    shareText({
      title: `🎨 틀린색상 찾기 · ${cfg.label}${modeLabel}`,
      description: `아깝게 실패! 오늘의 놀이터에서 같이 도전해요`,
      imageEmoji: "🎨",
    });
  }
}
