// routes/account.js: 회원 탈퇴 (비밀번호를 한 번 더 확인한 뒤 계정과 채팅/접속 기록을 삭제)
const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const accounts = require('../lib/accounts');
const { requireLogin } = require('./lobby');

const router = express.Router();

// 탈퇴 확인 화면
router.get('/account/delete', requireLogin, (req, res) => {
  res.render('account-delete', { error: null });
});

// 탈퇴 처리: 비밀번호 확인 -> 계정 삭제 -> 세션 지우고 메인으로
router.post('/account/delete', requireLogin, async (req, res, next) => {
  try {
    const me = req.session.user;
    const [rows] = await pool.query('SELECT password_hash, is_admin FROM users WHERE id = ?', [me.id]);
    if (rows.length === 0) return res.redirect('/');

    // 관리자 계정이 실수로 사라지면 관리자 페이지에 아무도 못 들어가므로 막아 둠
    if (rows[0].is_admin) {
      return res.status(400).render('account-delete', { error: '관리자 계정은 탈퇴할 수 없어요.' });
    }
    const ok = await bcrypt.compare(req.body.password || '', rows[0].password_hash);
    if (!ok) {
      return res.status(400).render('account-delete', { error: '비밀번호가 틀렸어요.' });
    }

    await accounts.deleteUser(me.id, '계정을 탈퇴해서 연결이 끊겼어요.');
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.redirect('/?bye=1');
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
