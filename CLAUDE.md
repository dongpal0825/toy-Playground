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

## 구현 메모 (지금까지 정한 규칙)
- 파일 구조와 ERD는 README.md에 정리. DB를 바꾸면 schema.sql과 README의 ERD(mermaid)를 같이 고칠 것
- 캐릭터 GLB 규칙: Blender에서 앞쪽은 -Y(내보내면 three.js의 +Z), 원점은 발바닥(오브젝트 위치 0,0,0 — 메쉬를 합친 뒤 위치를 메쉬에 적용해야 함), 키 1.4~1.9m, 유저 색이 입혀질 재질 이름은 "Body"로 시작 (예: Body_Dino). 나머지 재질은 고정 색
- GLB 원본은 assets/blender/toys.blend (씬 Toy_Dino, Toy_Bear, Toy_Robot, Toy_Duck, Toy_Penguin, Playground). 내보낼 때 use_active_scene=True 필수 (안 하면 다른 씬 물체도 들어감)
- GLB가 없거나 못 불러오면 characters.js의 기본 도형 모델로 대신 표시
- 퀄리티 기준 (2026-11-22 결정, 텍스처 없이): 캐릭터 1개 최대 3만 삼각형 / 맵 최대 50만 삼각형 / 전체 다운로드 8~10MB 목표(최대 15MB). 현재: 캐릭터 각 2.2만~2.9만(150~230KB), 맵 약 34만(3.4MB), 전체 약 4.3MB
- 모든 GLB는 Draco 압축으로 내보냄 (export_draco_mesh_compression_enable=True). 화면에서는 public/js/loader.js의 loadGLB()로만 불러올 것 (Draco 해제기 연결 + 로딩 진행률 + ?v=버전 캐시)
- 입체감: Cycles로 AO를 버텍스 컬러("AO")에 구워서 export_vertex_color='ACTIVE'로 내보냄. 내보낼 재질의 Base Color 노드에는 아무것도 연결하지 말 것 (연결하면 색이 안 나감)
- 캐릭터 몸통은 기본 도형을 합친 뒤 복셀 리메시로 이음매 없이 녹여 붙이고 Decimate로 삼각형 수를 맞춤
- 서버는 시작할 때 models 폴더로 assetVersion을 계산함 → 모델을 바꾸면 서버 재시작(pm2 restart) 필요. /models는 30일 캐시
- game3d.js: 시작 후 FPS가 32 미만이면 해상도 → 그림자 순서로 자동으로 품질을 낮춤. 주소에 ?debug를 붙이면 window.__dbg로 renderer/scene 확인 가능
- 놀이터 맵: Blender 씬 Playground → public/models/playground.glb (Draco, 약 3.4MB). 맨 위 물체 3개(Ground, Playground, Cloud)로 합쳐서 draw call을 줄임. 충돌 영역은 이름이 COL_로 시작하는 Empty(위치 + scale.x = 반지름). 바닥 표면 높이는 0 이하로 유지 (캐릭터 발이 묻히지 않게)
- Playground 씬의 RenderCast 컬렉션(캐릭터 복사본 + Render_Cam, Render_Sun)은 발표용 렌더 전용. GLB로 내보낼 때는 Ground/Playground/Cloud/COL_만 선택
- playground.glb를 못 불러오면 public/js/map.js의 코드 맵으로 대신 표시
- 점프: 클라이언트에서 중력 계산, y를 move에 같이 보냄 (서버는 0~2로 제한). 이모티콘: 'emote' 이벤트로 번호(0~5)만 전송, DB 저장 안 함
- 놀이기구: playground.glb 안 이름 규칙 RIDE_(움직이는 부품, 원점=회전축) / SEAT_(좌석, RIDE의 자식, Blender -Y가 앞) / PATH_slide_00..32 / ZONE_(탈 수 있는 구역, scale=반지름) / EXIT_(내린 뒤 위치). 좌석은 서버 game/rides.js가 관리(미끄럼틀1·그네2·시소2·뺑뺑이4), 움직임은 public/js/rides.js가 서버 시각(serverNow 오프셋) 기준으로 계산. 구역 좌표와 SLIDE_MS/MERRY_SPEED는 서버와 화면 양쪽 값이 같아야 함
- 테스트 봇 놀이기구 모드: RIDE=seesaw node tools/test-bot.js 1 2 (slide/swing/seesaw/merry)
- 위치 동기화: 클라이언트 15Hz 전송 → 서버 rooms.js 메모리 갱신 → 66ms 타이머로 움직인 사람만 묶어서 'moves' 전송
- Windows에서 mysql 클라이언트로 SQL을 실행할 때 한글이 깨지지 않게 schema.sql 맨 위에 SET NAMES utf8mb4 유지
- 세션은 메모리 저장(MemoryStore)이라 서버를 재시작하면 다시 로그인해야 함

## Claude Code 작업 방식
- 위 우선순위 순서대로 진행하고, 큰 설계 변경이 필요하면 먼저 물어볼 것
- 어떤 파일을 왜 만들었는지 간단히 설명할 것
- DB 테이블 변경 시 schema.sql과 ERD 설명도 같이 갱신할 것
- Blender 작업은 Blender MCP로 도형을 조합해서 만들고 GLB로 내보낼 것
