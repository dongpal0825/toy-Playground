// routes/admin.js: 관리자 페이지 (사용자 목록, 강제 탈퇴, DB 구조 보기). is_admin = 1인 계정만 들어올 수 있음
const express = require('express');
const pool = require('../db');
const rooms = require('../game/rooms');
const accounts = require('../lib/accounts');

const router = express.Router();

// 관리자만 통과시키는 미들웨어 (로그인 안 했으면 메인, 일반 유저면 서버 선택 화면으로)
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  if (!req.session.user.isAdmin) return res.redirect('/servers');
  next();
}
router.use(requireAdmin);

// ===== 사용자 목록 =====
// 유저 정보 + 고른 장난감 이름(JOIN) + 채팅 수/접속 횟수/마지막 접속(하위 쿼리) + 지금 접속 중인지(서버 메모리)
router.get('/', async (req, res, next) => {
  try {
    const [users] = await pool.query(`
      SELECT u.id, u.username, u.nickname, u.color, u.is_admin, u.created_at, t.name AS toy,
             (SELECT COUNT(*) FROM chat_messages c WHERE c.user_id = u.id) AS chats,
             (SELECT COUNT(*) FROM play_logs p WHERE p.user_id = u.id)     AS visits,
             (SELECT MAX(p.joined_at) FROM play_logs p WHERE p.user_id = u.id) AS last_seen
        FROM users u JOIN toys t ON t.id = u.toy_id
       ORDER BY u.id`);
    const [[{ chatTotal }]] = await pool.query('SELECT COUNT(*) AS chatTotal FROM chat_messages');
    for (const u of users) {
      const online = rooms.findSocketByUser(u.id);
      u.online = online ? online.roomId : null; // 접속 중이면 서버 번호
    }
    res.render('admin-users', {
      users,
      stats: { users: users.length, online: users.filter((u) => u.online).length, chats: chatTotal },
      msg: req.query.msg || null,
    });
  } catch (err) {
    next(err);
  }
});

// ===== 강제 탈퇴 =====
// 관리자 계정은 지울 수 없음. 접속 중이면 연결을 끊고 계정 + 채팅 + 접속 기록 삭제
router.post('/users/:id/delete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query('SELECT username, is_admin FROM users WHERE id = ?', [id]);
    if (rows.length === 0) return res.redirect('/admin?msg=' + encodeURIComponent('이미 없는 계정이에요.'));
    if (rows[0].is_admin) return res.redirect('/admin?msg=' + encodeURIComponent('관리자 계정은 탈퇴시킬 수 없어요.'));

    await accounts.deleteUser(id, '관리자가 계정을 탈퇴 처리해서 연결이 끊겼어요.');
    res.redirect('/admin?msg=' + encodeURIComponent(`${rows[0].username} 계정을 탈퇴 처리했어요.`));
  } catch (err) {
    next(err);
  }
});

// ===== DB 구조 (ERD) =====
// 발표용 설명 문구: 테이블/컬럼이 무엇을 저장하는지 한국어로
const TABLE_INFO = {
  toys: '장난감 캐릭터 5종 (공룡, 곰인형, 로봇, 고무 오리, 펭귄)',
  users: '회원 정보. 비밀번호는 bcrypt 해시로만 저장',
  rooms: '서버(방) 3개. 같은 서버 사람끼리만 채팅/이동이 보임',
  chat_messages: '채팅 기록. 입장하면 최근 30개를 불러옴',
  play_logs: '접속/퇴장 기록 + 나갈 때의 마지막 위치',
};
const COLUMN_INFO = {
  'toys.name': '캐릭터 이름', 'toys.model_file': '3D 모델(GLB) 파일 이름', 'toys.description': '설명',
  'users.username': '로그인 아이디 (중복 불가)', 'users.password_hash': 'bcrypt 해시 (원래 비밀번호는 저장 안 함)',
  'users.nickname': '머리 위에 보이는 이름', 'users.toy_id': '고른 캐릭터', 'users.color': '캐릭터 색 (#RRGGBB)',
  'users.is_admin': '관리자면 1', 'users.created_at': '가입 시각',
  'rooms.name': '서버 1, 2, 3', 'rooms.max_players': '최대 인원',
  'chat_messages.room_id': '채팅한 서버', 'chat_messages.user_id': '채팅한 사람', 'chat_messages.content': '채팅 내용 (최대 200자)',
  'chat_messages.created_at': '보낸 시각',
  'play_logs.user_id': '접속한 사람', 'play_logs.room_id': '접속한 서버', 'play_logs.joined_at': '입장 시각',
  'play_logs.left_at': '퇴장 시각 (접속 중이면 NULL)', 'play_logs.last_x': '나갈 때 위치 x', 'play_logs.last_z': '나갈 때 위치 z',
};
// 관계 설명 (FK마다 한 줄)
const RELATION_INFO = {
  'users.toy_id': '장난감 하나를 여러 유저가 고를 수 있어요',
  'chat_messages.user_id': '유저 한 명이 채팅을 여러 개 써요',
  'chat_messages.room_id': '서버 하나에 채팅이 여러 개 쌓여요',
  'play_logs.user_id': '유저 한 명이 여러 번 접속해요',
  'play_logs.room_id': '서버 하나에 접속 기록이 여러 개 쌓여요',
};
const TABLE_ORDER = ['toys', 'users', 'chat_messages', 'play_logs', 'rooms']; // 화면 배치 순서

// DB의 실제 구조를 information_schema(MySQL/MariaDB가 가진 "DB 설명서" 테이블)에서 읽어서 보여 줌
// -> schema.sql을 바꾸면 이 페이지도 자동으로 바뀜
router.get('/db', async (req, res, next) => {
  try {
    const [cols] = await pool.query(`
      SELECT TABLE_NAME AS t, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
             COLUMN_KEY AS keyType, COLUMN_DEFAULT AS def, EXTRA AS extra
        FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
       ORDER BY TABLE_NAME, ORDINAL_POSITION`);
    const [fks] = await pool.query(`
      SELECT k.TABLE_NAME AS t, k.COLUMN_NAME AS col, k.REFERENCED_TABLE_NAME AS refT,
             k.REFERENCED_COLUMN_NAME AS refCol, r.DELETE_RULE AS onDelete
        FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r
          ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
       WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY k.TABLE_NAME, k.COLUMN_NAME`);

    // 테이블별로 묶기 (TABLE_ORDER에 있는 것 먼저, 나머지는 뒤에)
    const names = [...new Set(cols.map((c) => c.t))];
    names.sort((a, b) => (TABLE_ORDER.indexOf(a) + 1 || 99) - (TABLE_ORDER.indexOf(b) + 1 || 99));
    const fkSet = new Set(fks.map((f) => `${f.t}.${f.col}`));

    const tables = [];
    for (const name of names) {
      // 테이블 이름은 information_schema에서 읽은 값만 쓰고, 백틱으로 감싸서 쿼리에 넣음
      const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
      const [sample] = await pool.query(`SELECT * FROM \`${name}\` ORDER BY 1 DESC LIMIT 5`);
      tables.push({
        name,
        info: TABLE_INFO[name] || '',
        rows: n,
        columns: cols.filter((c) => c.t === name).map((c) => ({
          ...c,
          fk: fkSet.has(`${name}.${c.name}`),
          info: COLUMN_INFO[`${name}.${c.name}`] || '',
        })),
        sample: sample.map((row) => maskRow(row)),
      });
    }

    const relations = fks.map((f) => ({ ...f, info: RELATION_INFO[`${f.t}.${f.col}`] || '' }));
    res.render('admin-db', { tables, relations });
  } catch (err) {
    next(err);
  }
});

// 예시 데이터 표시용: 비밀번호 해시는 앞부분만, 날짜는 읽기 쉽게
function maskRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'password_hash') out[k] = String(v).slice(0, 12) + '…';
    else if (v instanceof Date) out[k] = v.toLocaleString('ko-KR', { hour12: false });
    else out[k] = v;
  }
  return out;
}

module.exports = router;
