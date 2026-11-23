// app.js: 서버의 시작점. Express 설정, 세션, 화면 라우트를 연결하고 3000번 포트로 실행
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const session = require('express-session');
const pool = require('./db');
const accounts = require('./lib/accounts');

const app = express();

// EJS 화면 템플릿 설정 (views 폴더)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 3D 모델 버전 번호: models 폴더 파일들의 크기/수정 시간으로 만든 짧은 값
// 화면이 모델 주소 뒤에 ?v=버전 을 붙이므로, 모델을 바꾸면 주소가 바뀌어 새로 받고 아니면 캐시를 씀
const MODELS_DIR = path.join(__dirname, 'public', 'models');
function computeAssetVersion() {
  const hash = crypto.createHash('md5');
  for (const f of fs.readdirSync(MODELS_DIR).sort()) {
    const st = fs.statSync(path.join(MODELS_DIR, f));
    hash.update(`${f}:${st.size}:${st.mtimeMs}`);
  }
  return hash.digest('hex').slice(0, 8);
}
app.locals.assetVersion = computeAssetVersion();

// 3D 모델: 용량이 크므로 브라우저가 30일 동안 저장해 두고 다시 받지 않게 함 (EC2 전송량 절약)
app.use('/models', express.static(MODELS_DIR, { maxAge: '30d', immutable: true }));
// CSS, JS 같은 나머지 정적 파일 제공 (public 폴더)
app.use(express.static(path.join(__dirname, 'public')));
// Three.js 라이브러리를 node_modules에서 바로 제공 (CDN 없이 EC2에서도 동작). 자주 안 바뀌므로 7일 캐시
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three'), { maxAge: '7d' }));

// 로그인/회원가입 폼 데이터를 req.body로 읽기
app.use(express.urlencoded({ extended: false }));

// 로그인 상태를 기억하는 세션 (나중에 socket.io 채팅에서도 같이 쓰려고 변수로 분리)
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 6 }, // 6시간 유지, 다른 사이트에서 보낸 요청엔 쿠키 안 붙음
});
app.use(sessionMiddleware);

// 모든 화면에서 로그인한 유저 정보를 user 변수로 쓸 수 있게 함
// (탈퇴한 계정의 세션이 다른 탭/기기에 남아 있으면 여기서 로그아웃 처리)
app.use((req, res, next) => {
  if (req.session.user && accounts.isDeleted(req.session.user.id)) delete req.session.user;
  res.locals.user = req.session.user || null;
  next();
});

// 화면 라우트 연결
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/lobby'));
app.use('/', require('./routes/account'));  // 회원 탈퇴
app.use('/admin', require('./routes/admin')); // 관리자 페이지
app.use('/api/posts', require('./routes/posts')); // 놀이터 게시판 API

// 없는 주소: 화면 주소면 메인으로 돌려보내고, 파일(.glb, .js 등)이면 404
app.use((req, res) => {
  if (path.extname(req.path)) return res.status(404).send('Not Found');
  res.redirect('/');
});

// 서버 에러가 나면 콘솔에 남기고 간단한 메시지 표시
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
});

// HTTP 서버 생성 + 같은 서버에 socket.io를 붙여 3000번 포트 하나로 웹과 실시간 통신을 같이 처리
const server = http.createServer(app);
const setupSockets = require('./sockets');
const { saveAllOnShutdown } = setupSockets(server, sessionMiddleware);
const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, async () => {
  console.log(`장난감 놀이터 실행 중: http://localhost:${PORT}`);
  // 시작할 때 DB 접속이 되는지 확인하고, 지난번에 정리 못 한 접속 기록을 닫음
  try {
    await pool.query('SELECT 1');
    console.log('DB 연결 성공');
    await accounts.ensureSchema();
    await setupSockets.closeDanglingLogs();
  } catch (e) {
    console.error('DB 연결 실패:', e.message);
  }
});

// 서버 종료 신호(pm2 restart, Ctrl+C)를 받으면 접속 중인 사람들의 위치를 저장하고 끝냄
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await saveAllOnShutdown();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server, sessionMiddleware };
