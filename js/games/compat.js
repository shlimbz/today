import { db, doc, setDoc, collection, query, orderBy, limit, getDocs, serverTimestamp } from "../firebase-config.js";
import { todayKey, djb2Hash, showToast, shareText } from "../utils.js";

const TYPES = [
  { min: 95, max: 100, badge: "🔥 불타는 우정형", desc: "서로 만나면 이상하게 일이 커지는 사이. 오늘도 사고 한 번 치겠네요." },
  { min: 85, max: 94, badge: "💛 찰떡궁합형", desc: "말 안 해도 통하는 케미. 오늘 뭘 해도 잘 맞을 거예요." },
  { min: 70, max: 84, badge: "😊 편안한 사이형", desc: "부담 없이 편안한 관계. 있는 그대로가 제일 좋아요." },
  { min: 55, max: 69, badge: "🙂 무난한 케미형", desc: "특별할 건 없지만 딱히 부딪힐 일도 없는 무난한 조합." },
  { min: 40, max: 54, badge: "😅 티키타카 부족형", desc: "가끔 대화가 산으로 가지만 그마저도 재밌는 사이." },
  { min: 20, max: 39, badge: "🧊 어색한 평행선형", desc: "묘하게 안 겹치는 타이밍. 오늘은 리액션을 조금 더 크게!" },
  { min: 0, max: 19, badge: "⚡ 밀당 폭발형", desc: "티격태격하지만 은근 끌리는 사이. 그게 매력 포인트." },
];

function getType(score) {
  return TYPES.find((t) => score >= t.min && score <= t.max) || TYPES[TYPES.length - 1];
}

function sanitizeName(name) {
  return name.trim().replace(/\s+/g, " ").slice(0, 10);
}

let lastResult = null;

export function computeCompat(nameARaw, nameBRaw) {
  const nameA = sanitizeName(nameARaw);
  const nameB = sanitizeName(nameBRaw);
  if (!nameA || !nameB) return { error: "이름 두 개를 모두 입력해주세요" };
  if (nameA.toLowerCase() === nameB.toLowerCase()) return { error: "서로 다른 이름을 입력해주세요" };

  const sorted = [nameA, nameB].sort((a, b) => a.localeCompare(b, "ko"));
  const date = todayKey();
  const key = `${date}|${sorted[0]}|${sorted[1]}`;
  const score = djb2Hash(key) % 101; // 0~100, 날짜+정렬된 이름쌍에 대해 항상 동일
  const type = getType(score);

  lastResult = { nameA, nameB, sortedKey: `${sorted[0]}_${sorted[1]}`, score, type, date };
  saveCompatRecord(lastResult);
  return lastResult;
}

async function saveCompatRecord({ nameA, nameB, sortedKey, score, type, date }) {
  try {
    const ref = doc(db, "compatDaily", date, "records", sortedKey);
    await setDoc(ref, {
      nameA,
      nameB,
      score,
      typeBadge: type.badge,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    // Firebase 미설정이어도 결과 표시 자체는 항상 동작 (결정적 해시라 저장 불필요)
  }
}

export async function getTodayCompatRanking() {
  const date = todayKey();
  try {
    const q = query(collection(db, "compatDaily", date, "records"), orderBy("score", "desc"), limit(10));
    const snaps = await getDocs(q);
    return snaps.docs.map((d) => d.data());
  } catch (e) {
    return [];
  }
}

export async function getTodayBestCompatForTicket() {
  const list = await getTodayCompatRanking();
  return list[0] || null;
}

export function shareCompatResult() {
  if (!lastResult) {
    showToast("먼저 궁합을 확인해보세요!");
    return;
  }
  shareText({
    title: `💕 ${lastResult.nameA} × ${lastResult.nameB} 궁합 ${lastResult.score}점`,
    description: `${lastResult.type.badge} — ${lastResult.type.desc}`,
    imageEmoji: "💕",
  });
}
