// ============================================================
// Firebase 설정
// Firebase 콘솔 > 프로젝트 설정 > 일반 > 내 앱 에서 config 값을 복사해
// 아래 firebaseConfig 객체를 교체하세요. (README.md 참고)
// Firestore 를 "테스트 모드"가 아닌 firestore.rules 파일 규칙으로 설정해주세요.
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  orderBy,
  limit,
  where,
  getDocs,
  getCountFromServer,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB2dbwawtS8fAsZI-TEmpv8bI_g2pJgh6s",
  authDomain: "today-2162b.firebaseapp.com",
  projectId: "today-2162b",
  storageBucket: "today-2162b.firebasestorage.app",
  messagingSenderId: "620018434701",
  appId: "1:620018434701:web:36d9c7b034f7b58a6518c4",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  orderBy,
  limit,
  where,
  getDocs,
  getCountFromServer,
  serverTimestamp,
};
