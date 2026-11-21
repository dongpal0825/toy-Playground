// routes/lobby.js: 서버 선택 화면, 캐릭터/색상 저장 후 입장, 놀이터 화면, 서버별 인원 API
const express = require('express');
const pool = require('../db');
const rooms = require('../game/rooms');

const router = express.Router();

const COLOR_RULE = /^#[0-9a-fA-F]{6}$/;

// 캐릭터 색상 추천 목록 (서버 선택 화면의 색 버튼)
const COLOR_PRESETS = ['#4caf50', '#ff5a5f', '#ffd23f', '#3a86ff', '#b388ff', '#ff9f1c', '#8d6e63', '#f5f5f5'];

// 로그인 안 한 사람은 메인 화면으로 돌려보내는 미들웨어
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  next();
}

// 서버 선택 화면: 서버 목록 + 현재 인원 + 장난감 목록을 보여줌
router.get('/servers', requireLogin, async (req, res, next) => {
  try {
    const [roomRows] = await pool.query('SELECT id, name, max_players FROM rooms ORDER BY id');
    const [toys] = await pool.query('SELECT id, name, description FROM toys ORDER BY id');
    const counts = rooms.getCounts();
    res.render('servers', {
      rooms: roomRows.map((r) => ({ ...r, count: counts[r.id] || 0 })),
      toys,
      colors: COLOR_PRESETS,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

// 서버별 현재 인원 (서버 선택 화면이 몇 초마다 불러서 숫자를 갱신)
router.get('/api/room-counts', requireLogin, (req, res) => {
  res.json(rooms.getCounts());
});

// 입장 버튼: 고른 캐릭터와 색상을 DB에 저장하고 놀이터 화면으로 이동
router.post('/enter', requireLogin, async (req, res, next) => {
  try {
    const roomId = Number(req.body.roomId);
    const toyId = Number(req.body.toyId);
    const color = String(req.body.color || '');

    if (!rooms.isValidRoom(roomId)) return res.redirect('/servers?error=' + encodeURIComponent('없는 서버예요.'));
    if (!COLOR_RULE.test(color)) return res.redirect('/servers?error=' + encodeURIComponent('색상이 올바르지 않아요.'));

    const [toyRows] = await pool.query('SELECT id FROM toys WHERE id = ?', [toyId]);
    if (toyRows.length === 0) return res.redirect('/servers?error=' + encodeURIComponent('캐릭터를 골라 주세요.'));

    await pool.query('UPDATE users SET toy_id = ?, color = ? WHERE id = ?', [toyId, color, req.session.user.id]);
    req.session.user.toyId = toyId;
    req.session.user.color = color;
    req.session.save(() => res.redirect('/play/' + roomId));
  } catch (err) {
    next(err);
  }
});

// 놀이터 화면: 실제 입장(인원 확인, 채팅 불러오기)은 화면이 열린 뒤 socket.io로 처리
router.get('/play/:roomId', requireLogin, async (req, res, next) => {
  try {
    const roomId = Number(req.params.roomId);
    const [roomRows] = await pool.query('SELECT id, name, max_players FROM rooms WHERE id = ?', [roomId]);
    if (roomRows.length === 0) return res.redirect('/servers');
    const [toys] = await pool.query('SELECT id, name, model_file FROM toys ORDER BY id');
    res.render('play', { room: roomRows[0], toys });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.requireLogin = requireLogin;
