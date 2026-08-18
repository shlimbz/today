import { db, doc, setDoc, collection, query, orderBy, limit, getDocs, serverTimestamp } from "../firebase-config.js";
import { todayKey, getUserId, makeSeededRng, spendStars, addStars, showToast, shareText, withTimeout } from "../utils.js";

// "오늘의 무값!" — 동물의숲 무 시세 느낌의 미니 트레이딩 게임
export const CROPS = [
  { key: "radish", label: "황금무", emoji: "🫜", baseRange: [2, 4] },
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

// 패턴 하나가 하루(288틱) 전체에 걸쳐 완만하게 퍼지면 스릴이 없어서,
// "1시간(12틱)" 단위로 패턴 전체가 반복되도록 압축했습니다.
// 매 시간마다 진폭도 살짝 다르게 줘서 매번 똑같이 반복되는 느낌을 줄였어요.
const CYCLE_TICKS = 12; // 5분 × 12 = 1시간

function getPriceMultiplier(cropKey, dateStr, tick) {
  const { pattern } = getCropDayInfo(cropKey, dateStr);
  const cycleIndex = Math.floor(tick / CYCLE_TICKS);
  const posInCycle = tick % CYCLE_TICKS;
  const steps = pattern.length - 1;
  const pos = (posInCycle / (CYCLE_TICKS - 1)) * steps;
  const i0 = Math.min(steps, Math.floor(pos));
  const i1 = Math.min(steps, i0 + 1);
  const frac = pos - i0;
  const rawMul = lerp(pattern[i0], pattern[i1], frac);

  const rngAmp = makeSeededRng(`${dateStr}|${cropKey}|cycle|${cycleIndex}`);
  const ampScale = 0.7 + rngAmp() * 0.7; // 이번 시간대는 평소보다 세거나 약하게 (0.7~1.4배)
  return 1 + (rawMul - 1) * ampScale;
}

// ------------------------------------------------------------
// 특정 날짜(date) 기준 각 농작물의 패턴/기준가
// — 날짜+작물로 시드가 고정되어 같은 날엔 모두에게 동일한 시세가 나오고,
//   각 작물은 서로 독립적으로 패턴이 랜덤 선택됩니다.
// ------------------------------------------------------------
const dayCache = new Map();
function getCropDayInfo(cropKey, dateStr) {
  const cacheKey = `${dateStr}_${cropKey}`;
  if (dayCache.has(cacheKey)) return dayCache.get(cacheKey);

  const crop = CROPS.find((c) => c.key === cropKey);
  const rngPattern = makeSeededRng(`${dateStr}|${cropKey}|pattern`);
  const rngBase = makeSeededRng(`${dateStr}|${cropKey}|base`);
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

// dateStr을 넘기면 그 날짜 기준 가격(정산 등에 사용), 기본은 오늘
export function getPrice(cropKey, tick = getCurrentTick(), dateStr = todayKey()) {
  const { basePrice } = getCropDayInfo(cropKey, dateStr);
  const baseMul = getPriceMultiplier(cropKey, dateStr, tick);
  const smoothPrice = basePrice * baseMul;

  // 매 틱(5분)마다 눈에 보이는 변화가 생기도록, 가격 규모에 비례한 정수 단위
  // 노이즈를 더한다 (기준가가 낮아도 매번 가격이 멈춰있지 않도록).
  const rngJitter = makeSeededRng(`${dateStr}|${cropKey}|tick|${tick}`);
  const noiseUnits = Math.max(1, Math.round(smoothPrice * 0.18));
  const delta = Math.floor(rngJitter() * (noiseUnits * 2 + 1)) - noiseUnits;
  const price = Math.round(smoothPrice) + delta;
  return Math.max(1, price);
}

// 최근 N틱의 가격 이력 (그래프/추세 표시용)
export function getPriceHistory(cropKey, count = 6, dateStr = todayKey(), currentTick = getCurrentTick()) {
  const out = [];
  for (let t = Math.max(0, currentTick - count + 1); t <= currentTick; t++) {
    out.push({ tick: t, price: getPrice(cropKey, t, dateStr) });
  }
  return out;
}

export function getPatternLabel(cropKey, dateStr = todayKey()) {
  return PATTERN_LABELS[getCropDayInfo(cropKey, dateStr).patternKey];
}

// ------------------------------------------------------------
// 인벤토리 (보유 수량 + 매입원가) — { cropKey: { qty, cost } }
//   cost는 현재 보유 중인 수량의 누적 매입금액(가중평균 매입원가 계산용)
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
function getPosition(inv, cropKey) {
  return inv[cropKey] || { qty: 0, cost: 0 };
}

// ------------------------------------------------------------
// 날짜 변경 감지 & 자동 정산
//   자정이 지나면 전날 보유 재고는 "전날 마지막 시세(종가)"로 자동 판매되어
//   별로 전환되고, 오늘은 완전히 새로운(작물별 독립 랜덤) 시세로 시작합니다.
//   → 애니모크 무값처럼 "팔지 않고 넘기면 그 가격 그대로 굳는" 방식이 아니라
//     자동 정산되므로 하루 넘겨도 손해가 무한정 커지진 않습니다.
// ------------------------------------------------------------
function lastActiveDateKeyName() { return `cropLastActiveDate_${getUserId()}`; }

export function checkDayRolloverAndSettle() {
  const last = localStorage.getItem(lastActiveDateKeyName());
  const today = todayKey();
  if (!last) {
    localStorage.setItem(lastActiveDateKeyName(), today);
    return { settled: [], totalCredited: 0 };
  }
  if (last === today) return { settled: [], totalCredited: 0 };

  const inv = getInventory();
  const settled = [];
  let totalCredited = 0;
  for (const c of CROPS) {
    const pos = getPosition(inv, c.key);
    if (pos.qty > 0) {
      const closingPrice = getPrice(c.key, TICKS_PER_DAY - 1, last);
      const revenue = pos.qty * closingPrice;
      totalCredited += revenue;
      settled.push({ crop: c, qty: pos.qty, price: closingPrice, revenue });
    }
  }
  if (totalCredited > 0) addStars(totalCredited);
  saveInventory({});
  localStorage.setItem(lastActiveDateKeyName(), today);
  return { settled, totalCredited };
}

// ------------------------------------------------------------
// 오늘의 매매 실적 — 시가평가(마크투마켓) 기준 수익률
//   실현손익(sellRevenue - buyCost)만 보면 "사기만 하고 안 팔았을 때" 항상
//   -100%로 보이는 착시가 생기므로, 아직 팔지 않은 보유 재고도 현재 시세로
//   평가해 함께 반영합니다.
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

function getHoldingsValue() {
  const inv = getInventory();
  let value = 0;
  for (const c of CROPS) {
    const pos = getPosition(inv, c.key);
    if (pos.qty > 0) value += pos.qty * getPrice(c.key);
  }
  return value;
}

export function getTodayStats() {
  const s = loadStats();
  const buyCost = s.buyCost || 0;
  const sellRevenue = s.sellRevenue || 0;
  const holdingsValue = getHoldingsValue();
  const totalValue = sellRevenue + holdingsValue;
  const profitPct = buyCost > 0 ? ((totalValue - buyCost) / buyCost) * 100 : null;
  const profitAmount = buyCost > 0 ? totalValue - buyCost : 0;
  return { buyCost, sellRevenue, holdingsValue, totalValue, profitPct, profitAmount };
}

// 토스 주식창처럼 "보유 종목" 한 줄씩 — 평단가/평가금액/평가손익 포함
export function getPositions() {
  const inv = getInventory();
  const out = [];
  for (const c of CROPS) {
    const pos = getPosition(inv, c.key);
    if (pos.qty > 0) {
      const avgCost = pos.cost / pos.qty;
      const price = getPrice(c.key);
      const evalValue = pos.qty * price;
      const plAmount = evalValue - pos.cost;
      const plPct = pos.cost > 0 ? (plAmount / pos.cost) * 100 : 0;
      out.push({ crop: c, qty: pos.qty, avgCost, price, evalValue, plAmount, plPct });
    }
  }
  return out;
}

let currentNickname = { nickname: "", emoji: "" };
export function setNickname(n) { currentNickname = n; }

// 닉네임을 바꿨을 때 오늘 이미 저장된 무값 거래 기록의 닉네임 표시도 최신화
export async function refreshNicknameOnRecords() {
  const payload = { nickname: currentNickname.nickname, emoji: currentNickname.emoji };
  try {
    const ref = doc(db, "cropDaily", todayKey(), "records", getUserId());
    await withTimeout(setDoc(ref, payload, { merge: true }), 3000);
  } catch (e) {}
}

export function buyCrop(cropKey, qty) {
  qty = Math.max(1, Math.floor(qty));
  const price = getPrice(cropKey);
  const cost = price * qty;
  if (!spendStars(cost)) return { ok: false, reason: "stars", cost };
  const inv = getInventory();
  const pos = getPosition(inv, cropKey);
  pos.qty += qty;
  pos.cost += cost;
  inv[cropKey] = pos;
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
  const pos = getPosition(inv, cropKey);
  if (pos.qty < qty) return { ok: false, reason: "inventory" };
  const price = getPrice(cropKey);
  const revenue = price * qty;
  const avgCost = pos.qty > 0 ? pos.cost / pos.qty : 0;
  const costRemoved = avgCost * qty;

  pos.qty -= qty;
  pos.cost = Math.max(0, pos.cost - costRemoved);
  if (pos.qty <= 0) { pos.qty = 0; pos.cost = 0; }
  inv[cropKey] = pos;
  saveInventory(inv);

  addStars(revenue);
  const s = loadStats();
  s.sellRevenue = (s.sellRevenue || 0) + revenue;
  saveStats(s);
  syncToFirestore();
  return { ok: true, revenue, price, realizedPL: revenue - costRemoved };
}

async function syncToFirestore() {
  const date = todayKey();
  const userId = getUserId();
  const { buyCost, sellRevenue, profitPct } = getTodayStats();
  if (profitPct == null) return; // 아직 한 번도 안 샀으면 순위표엔 반영 안 함
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

// 가격이 바뀌었을 때(틱 변경 시) 보유 재고 평가액 기준 수익률을 순위표에 갱신
export function syncNow() {
  return syncToFirestore();
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
  const date = todayKey();
  try {
    const q = query(collection(db, "cropDaily", date, "records"), orderBy("profitPct", "desc"), limit(1));
    const snaps = await withTimeout(getDocs(q), 4000);
    return snaps && snaps.docs.length ? snaps.docs[0].data() : null;
  } catch (e) {
    return null;
  }
}

export function shareCropResult() {
  const { profitPct } = getTodayStats();
  if (profitPct == null) {
    showToast("먼저 한 번 이상 사고팔아보세요!");
    return;
  }
  const sign = profitPct >= 0 ? "+" : "";
  shareText({
    title: `🫜 오늘의 무값! 수익률 ${sign}${profitPct.toFixed(1)}%`,
    description: `오늘의 놀이터에서 농작물 매매로 ${sign}${profitPct.toFixed(1)}% 수익을 냈어요!`,
    imageEmoji: "🫜",
  });
}
