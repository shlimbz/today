import { db, doc, getDoc, setDoc, serverTimestamp } from "./firebase-config.js";

// ------------------------------------------------------------
// Firebase 설정이 아직 안 되어 있거나 네트워크가 느릴 때 화면이
// "불러오는 중"에 무한정 멈춰있지 않도록, 일정 시간이 지나면
// 실패로 간주하고 넘어가게 해주는 헬퍼.
// ------------------------------------------------------------
export function withTimeout(promise, ms = 3500, fallback = null) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve(fallback); }
    }, ms);
    promise.then(
      (val) => { if (!done) { done = true; clearTimeout(timer); resolve(val); } },
      () => { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } }
    );
  });
}

// ------------------------------------------------------------
// 카카오 공유: developers.kakao.com 에서 발급받은 JavaScript 키로 교체하세요.
// 키를 넣지 않으면 자동으로 웹 공유 / 클립보드 복사로 대체됩니다.
// ------------------------------------------------------------
export const KAKAO_JS_KEY = "YOUR_KAKAO_JS_KEY";

let kakaoReady = false;
try {
  if (window.Kakao && KAKAO_JS_KEY && !KAKAO_JS_KEY.startsWith("YOUR_")) {
    window.Kakao.init(KAKAO_JS_KEY);
    kakaoReady = window.Kakao.isInitialized();
  }
} catch (e) {
  kakaoReady = false;
}

// ------------------------------------------------------------
// 날짜 (한국 시간 기준 yyyy-mm-dd)
// ------------------------------------------------------------
export function todayKey() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayLabel() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${kst.getMonth() + 1}월 ${kst.getDate()}일 ${days[kst.getDay()]}요일`;
}

// ------------------------------------------------------------
// 문자열 해시 (djb2) — 궁합 점수처럼 완전히 결정적인 값이 필요할 때 사용
// ------------------------------------------------------------
export function djb2Hash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash >>> 0);
}

// ------------------------------------------------------------
// 익명 사용자 ID (기기별 로컬 저장)
// ------------------------------------------------------------
export function getUserId() {
  let id = localStorage.getItem("playground_userId");
  if (!id) {
    id = "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("playground_userId", id);
  }
  return id;
}

// ------------------------------------------------------------
// 랜덤 닉네임 생성 (중복 방지: Firestore nicknames/{nickname} 문서 선점)
// ------------------------------------------------------------
const ADJECTIVES = ["빠른", "졸린", "용감한", "수줍은", "상큼한", "씩씩한", "느긋한", "반짝이는", "포근한", "엉뚱한", "새침한", "든든한"];
const ANIMALS = [
  { word: "고양이", emoji: "🐱" },
  { word: "식빵", emoji: "🍞" },
  { word: "개구리", emoji: "🐸" },
  { word: "여우", emoji: "🦊" },
  { word: "다람쥐", emoji: "🐿️" },
  { word: "펭귄", emoji: "🐧" },
  { word: "토끼", emoji: "🐰" },
  { word: "수달", emoji: "🦦" },
  { word: "고슴도치", emoji: "🦔" },
  { word: "부엉이", emoji: "🦉" },
];

function randomNicknameCandidate(withSuffix) {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const ani = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const suffix = withSuffix ? String(Math.floor(Math.random() * 90) + 10) : "";
  return { text: `${adj}${ani.word}${suffix}`, emoji: ani.emoji };
}

export async function ensureNickname() {
  const userId = getUserId();
  const userRef = doc(db, "users", userId);
  try {
    const snap = await withTimeout(getDoc(userRef), 3000);
    if (snap && snap.exists() && snap.data().nickname) {
      return { nickname: snap.data().nickname, emoji: snap.data().emoji || "🐱" };
    }
  } catch (e) {
    // Firebase 미설정 등으로 실패해도 로컬 대체값으로 계속 진행
  }

  // 로컬 캐시 확인 (오프라인/Firebase 미설정 대비)
  const cached = localStorage.getItem("playground_nickname");
  const cachedEmoji = localStorage.getItem("playground_nickname_emoji");
  if (cached) return { nickname: cached, emoji: cachedEmoji || "🐱" };

  let picked = null;
  for (let i = 0; i < 8; i++) {
    const candidate = randomNicknameCandidate(i > 4);
    try {
      const nickRef = doc(db, "nicknames", candidate.text);
      const nickSnap = await withTimeout(getDoc(nickRef), 3000);
      if (!nickSnap || !nickSnap.exists()) {
        await withTimeout(setDoc(nickRef, { userId, claimedAt: Date.now() }), 3000);
        await withTimeout(setDoc(userRef, { nickname: candidate.text, emoji: candidate.emoji, createdAt: Date.now() }, { merge: true }), 3000);
        picked = candidate;
        break;
      }
    } catch (e) {
      picked = candidate; // Firebase 연결 실패 시 로컬로만 사용
      break;
    }
  }
  if (!picked) picked = randomNicknameCandidate(true);

  localStorage.setItem("playground_nickname", picked.text);
  localStorage.setItem("playground_nickname_emoji", picked.emoji);
  return { nickname: picked.text, emoji: picked.emoji };
}

// 닉네임 변경: 이미 다른 사람이 쓰고 있으면 실패를 반환 (중복 방지)
export async function updateNickname(newNickname, emoji) {
  const userId = getUserId();
  try {
    const nickRef = doc(db, "nicknames", newNickname);
    const snap = await getDoc(nickRef);
    if (snap.exists() && snap.data().userId !== userId) {
      return { ok: false, reason: "taken" };
    }
    await setDoc(nickRef, { userId, claimedAt: Date.now() });
    await setDoc(doc(db, "users", userId), { nickname: newNickname, emoji, createdAt: Date.now() }, { merge: true });
  } catch (e) {
    // Firebase 미설정이어도 로컬은 갱신하고 성공으로 처리
  }
  localStorage.setItem("playground_nickname", newNickname);
  localStorage.setItem("playground_nickname_emoji", emoji);
  return { ok: true };
}

// ------------------------------------------------------------
// ⭐ 별 (공용 재화)
//   - 최초 접속 시 10개 지급, 매일(자정 기준) 10개 추가 지급
//     → 처음 접속한 날은 10+10=20개
//   - 기기(localStorage)를 1차 저장소로 사용해 즉시 반응하고,
//     Firestore users/{userId}.stars 에는 참고용으로만 동기화한다.
// ------------------------------------------------------------
const STARS_KEY = "playground_stars";
const STARS_META_KEY = "playground_stars_meta"; // { signupBonusGiven, lastDailyGrant }

export function getStars() {
  const raw = localStorage.getItem(STARS_KEY);
  return raw ? parseInt(raw, 10) || 0 : 0;
}

function setStarsRaw(n) {
  const val = Math.max(0, Math.round(n));
  localStorage.setItem(STARS_KEY, String(val));
  syncStarsToFirestore(val);
  return val;
}

export function addStars(n) {
  return setStarsRaw(getStars() + n);
}

export function canAffordStars(n) {
  return getStars() >= n;
}

// 성공 시 별을 차감하고 true, 부족하면 아무것도 하지 않고 false
export function spendStars(n) {
  const cur = getStars();
  if (cur < n) return false;
  setStarsRaw(cur - n);
  return true;
}

// 앱 시작 시 1회 호출 — 지급된 별 개수(0이면 지급 없음)를 반환
export function grantDailyStarsIfNeeded() {
  let meta = {};
  try {
    meta = JSON.parse(localStorage.getItem(STARS_META_KEY) || "{}");
  } catch (e) {
    meta = {};
  }
  const today = todayKey();
  let granted = 0;

  if (!meta.signupBonusGiven) {
    granted += 10;
    meta.signupBonusGiven = true;
  }
  if (meta.lastDailyGrant !== today) {
    granted += 10;
    meta.lastDailyGrant = today;
  }

  localStorage.setItem(STARS_META_KEY, JSON.stringify(meta));
  if (granted > 0) addStars(granted);
  return granted;
}

async function syncStarsToFirestore(n) {
  try {
    await withTimeout(
      setDoc(doc(db, "users", getUserId()), { stars: n, updatedAt: serverTimestamp() }, { merge: true }),
      3000
    );
  } catch (e) {
    /* 참고용 동기화 실패는 무시 — 게임 진행엔 영향 없음 */
  }
}

// ------------------------------------------------------------
// 시드 기반 결정적 난수 (같은 시드 → 항상 같은 결과)
// ------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeSeededRng(seedStr) {
  return mulberry32(djb2Hash(seedStr));
}

// ------------------------------------------------------------
// 토스트
// ------------------------------------------------------------
let toastTimer = null;
export function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ------------------------------------------------------------
// 공유하기: 카카오 SDK → Web Share API → 클립보드 순으로 대체
// ------------------------------------------------------------
export async function shareText({ title, description, imageEmoji = "🎪" }) {
  const shareBody = `${imageEmoji} ${title}\n${description}\n\n👉 오늘의 놀이터에서 확인해보세요!`;

  if (kakaoReady && window.Kakao?.Share) {
    try {
      window.Kakao.Share.sendDefault({
        objectType: "text",
        text: `${imageEmoji} ${title}\n${description}`,
        link: {
          mobileWebUrl: location.href,
          webUrl: location.href,
        },
        buttonTitle: "나도 도전하기",
      });
      return;
    } catch (e) {
      // 실패 시 아래 폴백으로 진행
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title, text: shareBody, url: location.href });
      return;
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
  }

  try {
    await navigator.clipboard.writeText(`${shareBody}\n${location.href}`);
    showToast("결과를 클립보드에 복사했어요 📋");
  } catch (e) {
    showToast("공유하기를 사용할 수 없는 환경이에요");
  }
}

// ------------------------------------------------------------
// ms 포맷
// ------------------------------------------------------------
export function fmtMs(ms) {
  if (ms == null) return "-";
  return `${Math.round(ms)}ms`;
}
export function fmtSec(ms) {
  if (ms == null) return "-";
  return `${(ms / 1000).toFixed(2)}초`;
}
