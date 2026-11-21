// routes/lobby.js: 로그인한 유저만 들어갈 수 있는 서버 선택 화면 라우트
// (11/23에 서버별 인원 표시, 캐릭터/색상 선택, 입장 기능을 여기에 추가할 예정)
const express = require('express');
const pool = require('../db');

const router = express.Router();

// 로그인 안 한 사람은 메인 화면으로 돌려보내는 미들웨어
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  next();
}

// 서버 선택 화면: DB의 rooms 테이블에서 서버 목록을 읽어 보여줌
router.get('/servers', requireLogin, async (req, res, next) => {
  try {
    const [rooms] = await pool.query('SELECT id, name, max_players FROM rooms ORDER BY id');
    res.render('servers', { rooms });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.requireLogin = requireLogin;
