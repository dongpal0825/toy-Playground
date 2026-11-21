# 프로젝트: 장난감 놀이터 (Toy Playground)

## 개요
회원가입/로그인 후 서버(1, 2, 3) 중 하나를 골라 입장하고, 장난감 캐릭터(공룡, 곰인형, 로봇, 고무 오리, 펭귄) 중 하나로 3D 놀이터 맵에서 키보드로 움직이며 같은 서버의 유저들과 실시간 채팅하는 웹 게임 (로블록스 스타일). 대학 기말 과제(AI 바이브 코딩 발표)이며 혼자 개발한다.

## 과제 필수 조건
- AWS EC2 서버에서 Node.js + Express + EJS + MySQL2를 사용한 앱이어야 함
- 반드시 데이터베이스를 사용해야 함
- 평가 기준: 내가 주도적으로 한 것, 독창성
- 제출(11/27까지): EC2 화면 UI 캡처 + DB ERD + GitHub 저장소 캡처 -> 학번_이름.pdf / 소스 압축 -> 학번_이름_소스.zip
- 발표(11/30, 12/1, 12/2 중 수업시간): 5분 (프로그램 화면 설명 + DB ERD 설명)

## 기술 스택
- 서버: Node.js 22, Express, EJS, mysql2, socket.io, express-session, bcrypt
- 클라이언트: Three.js + GLTFLoader (모델은 GLB), 순수 JavaScript
- DB: MariaDB (mysql2 패키지로 접속)
- 배포: AWS EC2 (서울, Ubuntu 26.04, t3.micro 1GiB), pm2, 3000번 포트 (WebSocket도 같은 포트 사용)
- 에셋: Blender + Blender MCP로 직접 제작(도형 조합) -> GLB 내보내기. 외부 에셋/AI 모델 생성 서비스는 사용하지 않음

## 화면 흐름
1. 메인 화면 (Toy Playground): 로그인 / 회원가입
2. 로그인 후 서버 선택 화면: 서버 1, 서버 2, 서버 3 중 선택 (서버별 현재 인원 표시), 캐릭터와 색상 선택
3. 놀이터 3D 화면: 이동, 시점 조작, 채팅
(서버 1~3은 같은 놀이터 맵을 공유하고, 접속한 유저끼리만 채팅/이동이 동기화됨. 구현은 Node 서버 1개 안의 방(room) 3개)

## 기능 (우선순위 순)
1. [필수] 회원가입 / 로그인 / 로그아웃 (비밀번호 bcrypt 해시, 세션)
2. [필수] 메인 화면에서 로그인/회원가입 후 서버 1, 2, 3 선택 입장, 서버별 인원 표시
3. [필수] 실시간 채팅 + DB 저장 + 입장 시 최근 채팅 불러오기
   - 채팅 내용은 화면 왼쪽 상단에 모아서 표시 (스크롤 가능한 채팅 로그 패널)
   - 채팅을 치면 해당 캐릭터 머리 위에 말풍선이 뜨고 몇 초 뒤 사라짐 (같은 서버의 모든 유저 화면에 표시)
   - Enter 키로 채팅 입력창 포커스, 입력 중에는 캐릭터 이동 키가 동작하지 않게 처리
4. [필수] 3D 놀이터에서 WASD 이동, 같은 서버 유저에게 실시간 동기화
   - 로블록스 스타일 시점 조작: 마우스 우클릭 드래그로 시점 회전, 마우스 휠로 확대/축소, 캐릭터를 따라다니는 3인칭 카메라
   - WASD 이동 방향은 현재 카메라가 보는 방향 기준
5. 캐릭터 5종 선택 + 색상 선택, 머리 위 닉네임 표시
6. 접속/퇴장 기록(play_logs), 마지막 위치 저장
7. 꾸미기(맵 장식, 이모티콘, 점프 등): 시간이 남을 때만

## DB 설계 (ERD 초안)
- users: id PK, username UNIQUE, password_hash, nickname, toy_id FK->toys, color, created_at
- toys: id PK, name, model_file, description
- rooms: id PK, name (서버 1, 서버 2, 서버 3), max_players
- chat_messages: id PK, room_id FK->rooms, user_id FK->users, content, created_at
- play_logs: id PK, user_id FK->users, room_id FK->rooms, joined_at, left_at, last_x, last_z

관계: toys 1 - N users / users 1 - N chat_messages / rooms 1 - N chat_messages / users 1 - N play_logs / rooms 1 - N play_logs

## 구현 원칙
- 코드를 작성할 때 "이 코드가 어디에 쓰이는지"를 한국어 주석으로 간단히 남길 것 (파일 맨 위에 파일 역할 한 줄, 함수/주요 블록마다 용도 한 줄). 발표에서 내가 직접 설명해야 하므로 이해하기 쉽게 쓸 것
- 위치는 서버 메모리에서 방 단위로 관리하고 초당 10~20회로 제한해서 전송. DB에는 퇴장 시 마지막 위치만 저장
- 채팅은 화면 출력 시 textContent 또는 EJS 이스케이프로 처리 (XSS 방지). 말풍선도 동일
- 비밀번호, DB 계정 등은 .env에 두고 .gitignore에 .env, node_modules/, *.pem 포함
- 테이블 생성 SQL은 schema.sql로 저장소에 포함
- 3D가 동작하지 않아도 로그인, 서버 선택, 채팅은 정상 동작하도록 분리
- 모델 용량 기준: 캐릭터 1개 1MB 이하, 맵 5MB 이하, 전체 10~15MB 이하. low-poly, 큰 텍스처 금지(색상/머티리얼 색 위주)
- 캐릭터는 모델 1개 + 색상 변형으로 시작하고, 공룡부터 완성해 이동/동기화까지 연결한 뒤 나머지 종류를 추가
- 일정이 늦어지면 캐릭터 종류를 줄일 수 있음
- 캐릭터는 직접 디자인한 원본으로 만들고 기존 유명 캐릭터(IP)를 닮게 만들지 않음

## 일정 (제출 11/27, 발표 11/30~12/2)
- 11/22(일): 프로젝트 세팅 / schema.sql / 메인 화면, 회원가입, 로그인
- 11/23(월): 서버 선택 화면 + socket.io 채팅 + DB 저장 + 채팅 로그 패널
- 11/24(화): Three.js 놀이터 맵 + 이동 + 로블록스식 카메라 + 실시간 동기화 + 말풍선
- 11/25(수): 캐릭터 5종 GLB 제작(공룡부터) + 선택 UI
- 11/26(목): EC2 배포, 버그 수정, 꾸미기
- 11/27(금): 제출물 정리 (EC2 화면 캡처, ERD, GitHub 캡처 -> pdf, 소스 zip)

## 서버 환경 (이미 구축됨)
- EC2 서울 리전 Ubuntu 26.04, Node 22(nvm), MariaDB 설치/실행 중, 보안 그룹 3000번 포트 열림
- 코드는 로컬(Windows)에서 개발 -> GitHub push -> EC2에서 git pull 후 pm2로 실행
- .pem 키 파일은 절대 GitHub나 서버에 올리지 않음
- 로컬 개발 DB: Windows의 MySQL 8.0 (서비스 MySQL80). schema.sql은 MySQL 8과 MariaDB 양쪽에서 동작하게 작성

## Claude Code 작업 방식
- 위 우선순위 순서대로 진행하고, 큰 설계 변경이 필요하면 먼저 물어볼 것
- 어떤 파일을 왜 만들었는지 간단히 설명할 것
- DB 테이블 변경 시 schema.sql과 ERD 설명도 같이 갱신할 것
- Blender 작업은 Blender MCP로 도형을 조합해서 만들고 GLB로 내보낼 것
