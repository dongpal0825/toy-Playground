// routes/auth.js: 메인 화면, 회원가입, 로그인, 로그아웃을 처리하는 라우트
const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');

const router = express.Router();

// 입력값 규칙 (화면 안내 문구와 같게 맞춤)
const USERNAME_RULE = /^[a-zA-Z0-9_]{3,20}$/;

// 메인 화면에 에러 메시지와 함께 다시 보여주는 함수
function renderMain(res, { tab = 'login', error = null, form = {} } = {}) {
  res.status(error ? 400 : 200).render('index', { tab, error, form });
}

// 메인 화면: 이미 로그인했으면 서버 선택 화면으로 이동
router.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/servers');
  renderMain(res);
});

// 회원가입: 입력 검사 -> 아이디 중복 확인 -> 비밀번호 해시 저장 -> 바로 로그인
router.post('/register', async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim();
    const nickname = (req.body.nickname || '').trim();
    const password = req.body.password || '';
    const form = { username, nickname };

    if (!USERNAME_RULE.test(username)) {
      return renderMain(res, { tab: 'register', form, error: '아이디는 영문/숫자/_ 3~20자로 입력해 주세요.' });
    }
    if (nickname.length < 1 || nickname.length > 12) {
      return renderMain(res, { tab: 'register', form, error: '닉네임은 1~12자로 입력해 주세요.' });
    }
    if (password.length < 4 || password.length > 72) {
      return renderMain(res, { tab: 'register', form, error: '비밀번호는 4~72자로 입력해 주세요.' });
    }

    const [exists] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (exists.length > 0) {
      return renderMain(res, { tab: 'register', form, error: '이미 사용 중인 아이디예요.' });
    }

    // 비밀번호는 원문 대신 bcrypt 해시로만 저장
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)',
      [username, passwordHash, nickname]
    );

    loginSession(req, { id: result.insertId, username, nickname, toy_id: 1, color: '#4caf50' });
    req.session.save(() => res.redirect('/servers'));
  } catch (err) {
    // 동시에 같은 아이디로 가입한 경우 (UNIQUE 제약 위반)
    if (err.code === 'ER_DUP_ENTRY') {
      return renderMain(res, { tab: 'register', error: '이미 사용 중인 아이디예요.' });
    }
    next(err);
  }
});

// 로그인: 아이디로 유저를 찾고 bcrypt로 비밀번호 비교
router.post('/login', async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    const [rows] = await pool.query(
      'SELECT id, username, password_hash, nickname, toy_id, color FROM users WHERE username = ?',
      [username]
    );
    const found = rows[0];
    const ok = found && (await bcrypt.compare(password, found.password_hash));
    if (!ok) {
      return renderMain(res, { tab: 'login', form: { username }, error: '아이디 또는 비밀번호가 틀렸어요.' });
    }

    loginSession(req, found);
    req.session.save(() => res.redirect('/servers'));
  } catch (err) {
    next(err);
  }
});

// 로그아웃: 세션을 지우고 메인으로
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// 세션에 로그인한 유저 정보를 저장하는 함수 (비밀번호 해시는 넣지 않음)
function loginSession(req, u) {
  req.session.user = {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    toyId: u.toy_id,
    color: u.color,
  };
}

module.exports = router;
