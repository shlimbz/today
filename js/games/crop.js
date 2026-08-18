import { db, doc, setDoc, collection, query, orderBy, limit, getDocs, serverTimestamp } from "../firebase-config.js";
import { todayKey, getUserId, makeSeededRng, spendStars, addStars, showToast, shareText, withTimeout } from "../utils.js";

// "오늘의 무값!" — 동물의숲 무 시세 느낌의 미니 트레이딩 게임
export const CROPS = [
  { key: "radish", label: "황금무", emoji: "🥬", baseRange: [2, 4] },
  { key: "potato", label: "왕감자", emoji: "🍠", baseRange: [1, 3] },
  { key: "onion", label: "황금양파", emoji: "🧅", baseRange: [2, 5] },
  { key: "tomato", label: "꿀토마토", emoji: "🍅", baseRange: [3, 6] },
  { key: "peach", label: "물렁복숭아", emoji: "🍑", baseRange: [4, 7] },
];

const TICK_MINUTES = 5;
const TICKS_PER_DAY = Math.floor((24 * 60) / TICK_MINUTES); // 288

// 가격 패턴 — 사용자가 준 예시 곡선을 첫 값 기준 배율로 정규화
const PATTERNS = {
  surge: [1, 0.875, 0.8125, 1.125, 1.875, 3.75, 6.5], // 대폭등형
  crash: [1, 0.9, 0.7, 0.5, 0.3, 0.15], // 폭락형
  stable: [1, 1.1, 1.05, 1.2, 1.15, 1.3], // 안정형
  rollercoaster: [1, 1.8, 0.7, 2.2, 0.5, 3.0], // 롤러코스터형
  disaster: [1, 0.8, 0.5, 0.3, 0.1, 0.01], // 극악형
};
const PATTERN_KEYS = Object.keys(PATTERNS);
export const PATTERN_LABELS = {
  surge: "📈 대폭등형",
  crash: "📉 폭락형",
  stable: "📊 안정형",
  rollercoaster: "🎢 롤러코스터형",
  disaster: "💀 극악형",
};

function lerp(a, b, t) { return a + (b - a) * t; }

// ------------------------------------------------------------
// 오늘자 각 농작물의 패턴/기준가 — 날짜+작물로 시드 고정 → 모두에게 동일
// ------------------------------------------------------------
const dayCache = new Map();
function getCropDayInfo(cropKey) {
  const cacheKey = `${todayKey()}_${cropKey}`;
  if (dayCache.has(cacheKey)) return dayCache.get(cacheKey);

  const crop = CROPS.find((c) => c.key === cropKey);
  const rngPattern = makeSeededRng(`${todayKey()}|${cropKey}|pattern`);
  const rngBase = makeSeededRng(`${todayKey()}|${cropKey}|base`);
  const patternKey = PATTERN_KEYS[Math.floor(rngPattern() * PATTERN_KEYS.length)];
  const [minB, maxB] = crop.baseRange;
  const basePrice = Math.floor(rngBase() * (maxB - minB + 1)) + minB;

  const info = { patternKey, pattern: PATTERNS[patternKey], basePrice };
  dayCache.set(cacheKey, info);
  return info;
}

export function getCurrentTick() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000);
  const minutesSinceMidnight = kst.getHours() * 60 + kst.getMinutes();
  return Math.min(TICKS_PER_DAY - 1, Math.floor(minutesSinceMidnight / TICK_MINUTES));
}

export function msUntilNextTick() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000);
  const msIntoTick = ((kst.getMinutes() % TICK_MINUTES) * 60 + kst.getSeconds()) * 1000 + kst.getMilliseconds();
  return TICK_MINUTES * 60 * 1000 - msIntoTick;
}

export function getPrice(cropKey, tick = getCurrentTick()) {
  const { pattern, basePrice } = getCropDayInfo(cropKey);
  const steps = pattern.length - 1;
  const pos = (tick / (TICKS_PER_DAY - 1)) * steps;
  const i0 = Math.min(steps, Math.floor(pos));
  const i1 = Math.min(steps, i0 + 1);
  const frac = pos - i0;
  const baseMul = lerp(pattern[i0], pattern[i1], frac);

  const rngJitter = makeSeededRng(`${todayKey()}|${cropKey}|tick|${tick}`);
  const jitter = (rngJitter() - 0.5) * 0.08; // ±4%
  const price = Math.round(basePrice * baseMul * (1 + jitter));
  return Math.max(1, price);
}

export function getPatternLabel(cropKey) {
  return PATTERN_LABELS[getCropDayInfo(cropKey).patternKey];
}

// ------------------------------------------------------------
// 인벤토리 (보유 수량) — 날짜와 무관하게 유지 (팔기 전까진 계속 보유)
// ------------------------------------------------------------
function invKey() { return `cropInventory_${getUserId()}`; }
export function getInventory() {
  try {
    return JSON.parse(localStorage.getItem(invKey()) || "{}");
  } catch (e) {
    return {};
  }
}
function saveInventory(inv) {
  try { localStorage.setItem(invKey(), JSON.stringify(inv)); } catch (e) {}
}

// ------------------------------------------------------------
// 오늘의 매매 실적 (실현 손익 기준 수익률)
// ------------------------------------------------------------
function statsKey() { return `cropStats_${todayKey()}_${getUserId()}`; }
function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(statsKey()) || "{}");
  } catch (e) {
    return {};
  }
}
function saveStats(s) {
  try { localStorage.setItem(statsKey(), JSON.stringify(s)); } catch (e) {}
}
export function getTodayStats() {
  const s = loadStats();
  const buyCost = s.buyCost || 0;
  const sellRevenue = s.sellRevenue || 0;
  const profitPct = buyCost > 0 ? ((sellRevenue - buyCost) / buyCost) * 100 : null;
  return { buyCost, sellRevenue, profitPct };
}

let currentNickname = { nickname: "", emoji: "" };
export function setNickname(n) { currentNickname = n; }

export function buyCrop(cropKey, qty) {
  qty = Math.max(1, Math.floor(qty));
  const price = getPrice(cropKey);
  const cost = price * qty;
  if (!spendStars(cost)) return { ok: false, reason: "stars", cost };
  const inv = getInventory();
  inv[cropKey] = (inv[cropKey] || 0) + qty;
  saveInventory(inv);
  const s = loadStats();
  s.buyCost = (s.buyCost || 0) + cost;
  saveStats(s);
  syncToFirestore();
  return { ok: true, cost, price };
}

export function sellCrop(cropKey, qty) {
  qty = Math.max(1, Math.floor(qty));
  const inv = getInventory();
  const have = inv[cropKey] || 0;
  if (have < qty) return { ok: false, reason: "inventory" };
  const price = getPrice(cropKey);
  const revenue = price * qty;
  inv[cropKey] = have - qty;
  saveInventory(inv);
  addStars(revenue);
  const s = loadStats();
  s.sellRevenue = (s.sellRevenue || 0) + revenue;
  saveStats(s);
  syncToFirestore();
  return { ok: true, revenue, price };
}

async function syncToFirestore() {
  const date = todayKey();
  const userId = getUserId();
  const { buyCost, sellRevenue, profitPct } = getTodayStats();
  if (profitPct == null) return; // 아직 매수만 하고 매도 실적이 없으면 순위표엔 반영 안 함
  try {
    const ref = doc(db, "cropDaily", date, "records", userId);
    await withTimeout(
      setDoc(
        ref,
        {
          userId,
          nickname: currentNickname.nickname,
          emoji: currentNickname.emoji,
          buyCost,
          sellRevenue,
          profitPct,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      4000
    );
  } catch (e) {
    /* 순위표 반영만 실패, 게임 자체엔 영향 없음 */
  }
}

export async function getTodayRanking() {
  const date = todayKey();
  try {
    const q = query(collection(db, "cropDaily", date, "records"), orderBy("profitPct", "desc"), limit(10));
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

export function shareCropResult() {
  const { profitPct } = getTodayStats();
  if (profitPct == null) {
    showToast("먼저 한 번 이상 사고팔아보세요!");
    return;
  }
  const sign = profitPct >= 0 ? "+" : "";
  shareText({
    title: `🥬 오늘의 무값! 수익률 ${sign}${profitPct.toFixed(1)}%`,
    description: `오늘의 놀이터에서 농작물 매매로 ${sign}${profitPct.toFixed(1)}% 수익을 냈어요!`,
    imageEmoji: "🥬",
  });
}
