import { db, doc, setDoc, collection, query, orderBy, limit, getDocs, serverTimestamp } from "../firebase-config.js";
import { todayKey, djb2Hash, showToast, shareText, withTimeout } from "../utils.js";

const TYPES = [
  { min: 96, max: 100, badge: "🔥 운명의 상대형", desc: "오늘 만나면 인생네컷이라도 찍어야 할 조합. 뭘 해도 합이 완벽해요." },
  { min: 90, max: 95, badge: "💛 찰떡궁합형", desc: "말 안 해도 통하는 케미. 오늘 뭘 해도 잘 맞을 거예요." },
  { min: 83, max: 89, badge: "🌟 든든한 파트너형", desc: "서로를 잘 챙겨주는 관계. 급한 일 생기면 제일 먼저 떠오르는 사이." },
  { min: 76, max: 82, badge: "😊 편안한 사이형", desc: "부담 없이 편안한 관계. 있는 그대로가 제일 좋아요." },
  { min: 68, max: 75, badge: "🍀 잔잔한 케미형", desc: "튀지는 않지만 은근히 오래가는 사이. 소소한 대화가 즐거워요." },
  { min: 60, max: 67, badge: "🙂 무난한 케미형", desc: "특별할 건 없지만 딱히 부딪힐 일도 없는 무난한 조합." },
  { min: 52, max: 59, badge: "🌗 애매모호형", desc: "가까운 듯 먼 듯 알 수 없는 사이. 오늘은 먼저 말 걸어보는 건 어때요?" },
  { min: 44, max: 51, badge: "😅 티키타카 부족형", desc: "가끔 대화가 산으로 가지만 그마저도 재밌는 사이." },
  { min: 36, max: 43, badge: "🎭 정반대 매력형", desc: "취향도 성격도 정반대라 오히려 신기하게 끌리는 조합." },
  { min: 28, max: 35, badge: "🧊 어색한 평행선형", desc: "묘하게 안 겹치는 타이밍. 오늘은 리액션을 조금 더 크게!" },
  { min: 20, max: 27, badge: "⚡ 밀당 폭발형", desc: "티격태격하지만 은근 끌리는 사이. 그게 매력 포인트." },
  { min: 10, max: 19, badge: "🌪️ 좌충우돌형", desc: "만나기만 하면 예상 못한 사건사고가 생기는 다이나믹 듀오." },
  { min: 0, max: 9, badge: "🌊 마이웨이형", desc: "서로 각자의 길을 가는 쿨한 사이. 안 맞아도 그게 매력이에요." },
];

function getType(score) {
  return TYPES.find((t) => score >= t.min && score <= t.max) || TYPES[TYPES.length - 1];
}

function sanitizeName(name) {
  return name.trim().replace(/\s+/g, " ").slice(0, 10);
}

let lastResult = null;
let todayBest = null; // { nameA, nameB, score, type } — 오늘 체크한 것 중 최고점
let todayBestDate = null;

export const CHECK_COST = 1;

// 별 소모 전에 먼저 이름만 검증 (검증 실패 시엔 별을 쓰지 않기 위해 분리)
export function validateNames(nameARaw, nameBRaw) {
  const nameA = sanitizeName(nameARaw);
  const nameB = sanitizeName(nameBRaw);
  if (!nameA || !nameB) return { error: "이름 두 개를 모두 입력해주세요" };
  if (nameA.toLowerCase() === nameB.toLowerCase()) return { error: "서로 다른 이름을 입력해주세요" };
  return { nameA, nameB };
}

export function computeCompat(nameA, nameB) {
  const sorted = [nameA, nameB].sort((a, b) => a.localeCompare(b, "ko"));
  const date = todayKey();
  const key = `${date}|${sorted[0]}|${sorted[1]}`;
  const score = djb2Hash(key) % 101; // 0~100, 날짜+정렬된 이름쌍에 대해 항상 동일
  const type = getType(score);

  lastResult = { nameA, nameB, sortedKey: `${sorted[0]}_${sorted[1]}`, score, type, date };

  if (todayBestDate !== date) { todayBestDate = date; todayBest = null; }
  if (todayBest == null || score > todayBest.score) todayBest = lastResult;

  saveCompatRecord(lastResult);
  return lastResult;
}

async function saveCompatRecord({ nameA, nameB, sortedKey, score, type, date }) {
  try {
    const ref = doc(db, "compatDaily", date, "records", sortedKey);
    await withTimeout(setDoc(ref, {
      nameA,
      nameB,
      score,
      typeBadge: type.badge,
      updatedAt: serverTimestamp(),
    }), 3500);
  } catch (e) {
    // Firebase 미설정이어도 결과 표시 자체는 항상 동작 (결정적 해시라 저장 불필요)
  }
}

export async function getTodayCompatRanking() {
  const date = todayKey();
  try {
    const q = query(collection(db, "compatDaily", date, "records"), orderBy("score", "desc"), limit(10));
    const snaps = await withTimeout(getDocs(q), 3500);
    return snaps ? snaps.docs.map((d) => d.data()) : [];
  } catch (e) {
    return [];
  }
}

export async function getTodayBestCompatForTicket() {
  const date = todayKey();
  try {
    const q = query(collection(db, "compatDaily", date, "records"), orderBy("score", "desc"), limit(1));
    const snaps = await withTimeout(getDocs(q), 3500);
    return snaps && snaps.docs.length ? snaps.docs[0].data() : null;
  } catch (e) {
    return null;
  }
}

export function shareCompatResult() {
  if (!lastResult) {
    showToast("먼저 궁합을 확인해보세요!");
    return;
  }
  const best = todayBestDate === todayKey() && todayBest ? todayBest : lastResult;
  shareText({
    title: `💕 ${best.nameA} × ${best.nameB} 오늘 최고 궁합 ${best.score}점`,
    description: `${best.type.badge} — ${best.type.desc}`,
    imageEmoji: "💕",
  });
}
