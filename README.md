# 빗썸 대시보드

빗썸 거래소의 코인 데이터를 실시간으로 모니터링하는 대시보드입니다.

## 기능

- 실시간 코인 데이터 스트리밍
- 코인별 상세 정보 (클릭시 모달)
- 30분 단위 히스토리 데이터
- 가격 및 거래량 차트
- 정렬 및 검색 기능
- 페이지네이션

## 설치

```bash
# pnpm 설치 (없는 경우)
npm install -g pnpm

# 의존성 설치
pnpm install
```

## 실행 방법

### 방법 1: 개별 실행

```bash
# 터미널 1 - 백엔드 서버 실행 (포트 3001)
pnpm server

# 터미널 2 - 프론트엔드 실행 (포트 3000)
pnpm start
```

### 방법 2: 동시 실행 (추천)

```bash
# 백엔드와 프론트엔드 동시 실행
pnpm dev
```

### 방법 3: 개발 모드 (파일 변경 감지)

```bash
# nodemon으로 서버 자동 재시작
pnpm dev:watch
```

## 스크립트 명령어

- `pnpm start` - 프론트엔드 개발 서버 실행 (포트 3000)
- `pnpm server` - 백엔드 API 서버 실행 (포트 3001)
- `pnpm server:watch` - 백엔드 서버 실행 (자동 재시작)
- `pnpm dev` - 프론트엔드 + 백엔드 동시 실행
- `pnpm dev:watch` - 개발 모드로 동시 실행
- `pnpm build` - 프로덕션 빌드

## 접속 URL

- 프론트엔드: http://localhost:3000
- 백엔드 API: http://localhost:3001

## API 엔드포인트

- `GET /api/stream` - SSE 실시간 데이터 스트림
- `GET /api/coins` - 전체 코인 목록
- `GET /api/coin/:symbol` - 특정 코인 상세 정보

## 기술 스택

- **Frontend**: React, TypeScript, Recharts
- **Backend**: Node.js, Express
- **Package Manager**: pnpm
- **Data Source**: Bithumb API