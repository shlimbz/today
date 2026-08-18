import { db, doc, getDoc, setDoc, collection, query, orderBy, limit, where, getDocs, getCountFromServer, serverTimestamp } from "../firebase-config.js";
import { todayKey, getUserId, showToast, shareText, fmtMs } from "../utils.js";

const stage = () => document.getElementById("reactionStage");
const msgEl = () => document.getElementById("reactionMsg");
const subEl = () => document.getElementById("reactionSub");

let state = "idle"; // idle | wait | go | fail | result
let waitTimer = null;
let goAt = 0;
let lastResultMs = null;
let currentNickname = { nickname: "", emoji: "" };

export function setNickname(n) { currentNickname = n; }

function setStage(next, msgHtml, subHtml) {
  state = next;
  const el = stage();
  el.className = `reaction-stage state-${next}`;
  msgEl().innerHTML = msgHtml;
  subEl().innerHTML = subHtml || "";
}

export function resetReactionScreen() {
  clearTimeout(waitTimer);
  setStage("idle", "탭해서 시작", "초록색으로 바뀌는 순간 화면을 터치하세요");
}

function beginWait() {
  clearTimeout(waitTimer);
  setStage("wait", "기다리세요…", "곧 초록색으로 바뀝니다");
  const delay = 3000 + Math.random() * 7000; // 3~10초
  waitTimer = setTimeout(() => {
    goAt = performance.now();
    setStage("go", "지금 터치!", "");
  }, delay);
}

async function handleFail() {
  clearTimeout(waitTimer);
  setStage("fail", "너무 빨랐어요! 🙈", "다시 탭해서 도전하세요");
}

async function handleSuccess() {
  const ms = performance.now() - goAt;
  lastResultMs = ms;
  setStage(
    "result",
    `<div class="big-num">${Math.round(ms)}<span style="font-size:22px;">ms</span></div>`,
    "다시 탭하면 재도전!"
  );
  await saveRecord(ms);
}

export function handleStageTap() {
  if (state === "idle" || state === "fail" || state === "result") {
    beginWait();
  } else if (state === "wait") {
    handleFail();
  } else if (state === "go") {
    handleSuccess();
  }
}

async function saveRecord(ms) {
  const userId = getUserId();
  const date = todayKey();
  try {
    const dailyRef = doc(db, "reactionDaily", date, "records", userId);
    const snap = await getDoc(dailyRef);
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
    const allSnap = await getDoc(allTimeRef);
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
    showToast("기록 저장에 실패했어요 (Firebase 설정을 확인하세요)");
  }
}

export async function getTodayRanking() {
  const date = todayKey();
  try {
    const q = query(collection(db, "reactionDaily", date, "records"), orderBy("ms", "asc"), limit(10));
    const snaps = await getDocs(q);
    return snaps.docs.map((d) => d.data());
  } catch (e) {
    return [];
  }
}

export async function getAllTimeRanking() {
  try {
    const q = query(collection(db, "reactionAllTime"), orderBy("ms", "asc"), limit(10));
    const snaps = await getDocs(q);
    return snaps.docs.map((d) => d.data());
  } catch (e) {
    return [];
  }
}

// 메인 화면 "오늘의 기록" 티켓용 — 내 오늘 기록 + 대략적인 순위
export async function getMySummaryToday() {
  const date = todayKey();
  const userId = getUserId();
  try {
    const mineRef = doc(db, "reactionDaily", date, "records", userId);
    const mineSnap = await getDoc(mineRef);
    if (!mineSnap.exists()) return null;
    const ms = mineSnap.data().ms;

    const col = collection(db, "reactionDaily", date, "records");
    const betterQ = query(col, where("ms", "<", ms));
    const totalSnap = await getCountFromServer(col);
    const betterSnap = await getCountFromServer(betterQ);
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
    title: `⚡ 반응속도 ${fmtMs(lastResultMs)}`,
    description: `오늘의 놀이터에서 ${Math.round(lastResultMs)}ms를 기록했어요!`,
    imageEmoji: "⚡",
  });
}
