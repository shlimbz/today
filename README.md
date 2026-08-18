# 🎪 오늘의 놀이터

카카오톡으로 공유해서 즐기는 초경량 모바일 웹앱입니다.
빌드 도구 없이 순수 HTML + JS(ES 모듈) + Firebase(Firestore)만 사용합니다.

- ⚡ 반응속도 측정
- 💕 오늘의 친구 궁합 (날짜+이름 기반 결정적 해시, 서버 저장 없이도 항상 같은 결과)
- 🎨 틀린색상 찾기 (난이도별 하루 3회, 시간 기록)

## 폴더 구조

```
index.html
css/style.css
js/firebase-config.js   Firebase 초기화
js/utils.js             날짜/닉네임/해시/공유 등 공통 유틸
js/main.js              화면 라우팅 및 전체 조립
js/games/reaction.js    반응속도 로직
js/games/compat.js      궁합 로직
js/games/colormatch.js  틀린색상 찾기 로직
firestore.rules         Firestore 보안 규칙 (참고용)
```

## 1) Firebase 프로젝트 만들기

1. https://console.firebase.google.com 접속 → "프로젝트 추가"
2. 프로젝트 생성 후 왼쪽 메뉴 **Firestore Database** → "데이터베이스 만들기" → 위치는 `asia-northeast3(서울)` 권장
3. 처음엔 "테스트 모드"로 시작해도 되지만, 배포 전에는 이 프로젝트에 포함된 `firestore.rules` 내용을 Firestore > 규칙 탭에 붙여넣어 주세요.
4. 프로젝트 설정(⚙️) → "내 앱" → 웹 앱 추가(</> 아이콘) → 앱 닉네임 아무거나 입력 → **Firebase SDK 구성** 값 복사
5. `js/firebase-config.js` 파일의 `firebaseConfig` 객체를 복사한 값으로 교체

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

이 값을 넣지 않아도 앱 자체는 열리고 궁합 게임처럼 서버 저장이 필요 없는 기능은 동작하지만, 순위/기록 저장은 실패하고 안내 토스트가 표시됩니다.

## 2) 카카오톡 공유 연결 (선택)

1. https://developers.kakao.com → 애플리케이션 추가
2. 앱 키 중 **JavaScript 키** 복사
3. 플랫폼 설정에 배포할 도메인(예: `https://yourapp.web.app`) 등록
4. `js/utils.js` 상단의 `KAKAO_JS_KEY` 값을 교체

키를 넣지 않으면 자동으로 브라우저 기본 공유(Web Share API) 또는 클립보드 복사로 대체됩니다.

## 3) 로컬에서 확인하기

ES 모듈을 쓰기 때문에 `file://`로 직접 열면 CORS 문제로 동작하지 않습니다. 아래처럼 간단한 로컬 서버를 띄워주세요.

```bash
npx serve .
# 또는
python3 -m http.server 5173
```

## 4) 배포하기 (Firebase Hosting 예시)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # public 디렉터리를 프로젝트 루트로 지정, SPA 리라이트는 No 선택
firebase deploy
```

배포된 URL이 카카오톡 공유 링크가 됩니다. 카카오 개발자 콘솔의 플랫폼 도메인도 이 주소로 등록해주세요.

## Firestore 데이터 구조

```
users/{userId}                        { nickname, emoji, createdAt }
nicknames/{nickname}                  { userId, claimedAt }            // 닉네임 중복 방지용

reactionDaily/{date}/records/{userId} { userId, nickname, emoji, ms }  // 오늘자 개인 최고기록만 저장
reactionAllTime/{userId}              { userId, nickname, emoji, ms }  // 역대 개인 최고기록

compatDaily/{date}/records/{pairKey}  { nameA, nameB, score, typeBadge }  // pairKey = 정렬된 "이름A_이름B"

colorDaily/{date}/records/{userId}    {
  nickname, emoji,
  easyAttempts, normalAttempts, hardAttempts,   // 0~3
  easyBestMs, normalBestMs, hardBestMs,         // 성공한 회차 중 최고기록
  totalBestMs                                    // 세 난이도 모두 성공했을 때만 존재
}
```

`date`는 한국시간(KST) 기준 `yyyy-mm-dd` 문자열이며, 매일 새로운 문서 경로가 만들어지므로 자연스럽게 "일일 초기화"가 됩니다. 전체 누적 기록은 `reactionAllTime`처럼 날짜가 없는 컬렉션에 별도로 유지됩니다.

## 알아두면 좋은 점 / 한계

- 별도 로그인 없이 기기에 저장된 임의 ID로 사용자를 구분합니다. 브라우저 데이터를 지우면 새 사용자로 인식됩니다.
- 인증이 없기 때문에 `firestore.rules`는 "데이터 형태 검증" 수준의 최소 보호만 제공합니다. 악의적인 클라이언트의 순위 조작을 막으려면 Firebase Anonymous Auth + Cloud Functions로 서버 측 검증을 추가하는 것을 권장합니다.
- 틀린색상 찾기의 난이도별 제한시간(초급 6초 / 중급 9초 / 고급 12초)과 색 차이(delta)는 `js/games/colormatch.js` 상단 `DIFFICULTIES` 객체에서 바로 조정할 수 있습니다.
- 궁합 점수는 Firestore 없이도 항상 동일한 결과가 나오도록 설계되어 있고(같은 날짜 + 같은 두 이름 → 항상 같은 점수), Firestore 저장은 "오늘의 베스트 궁합" 랭킹 표시용으로만 쓰입니다.
