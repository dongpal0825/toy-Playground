// app.js: 서버의 시작점. Express 설정, 세션, 화면 라우트를 연결하고 3000번 포트로 실행
require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const pool = require('./db');

const app = express();

// EJS 화면 템플릿 설정 (views 폴더)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// CSS, JS, 3D 모델 같은 정적 파일 제공 (public 폴더)
app.use(express.static(path.join(__dirname, 'public')));

// 로그인/회원가입 폼 데이터를 req.body로 읽기
app.use(express.urlencoded({ extended: false }));

// 로그인 상태를 기억하는 세션 (나중에 socket.io 채팅에서도 같이 쓰려고 변수로 분리)
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 6 }, // 6시간 유지
});
app.use(sessionMiddleware);

// 모든 화면에서 로그인한 유저 정보를 user 변수로 쓸 수 있게 함
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// 화면 라우트 연결
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/lobby'));

// 없는 주소로 들어오면 메인으로 돌려보냄
app.use((req, res) => res.redirect('/'));

// 서버 에러가 나면 콘솔에 남기고 간단한 메시지 표시
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
});

// HTTP 서버 생성 (다음 단계에서 같은 서버에 socket.io를 붙여 3000번 포트 하나로 사용)
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, async () => {
  console.log(`장난감 놀이터 실행 중: http://localhost:${PORT}`);
  // 시작할 때 DB 접속이 되는지 한 번 확인
  try {
    await pool.query('SELECT 1');
    console.log('DB 연결 성공');
  } catch (e) {
    console.error('DB 연결 실패:', e.message);
  }
});

module.exports = { app, server, sessionMiddleware };
