// lib/accounts.js: 계정 삭제(회원 탈퇴, 관리자 강제 탈퇴)를 한곳에서 처리하는 파일
// 놀이터에 접속 중이면 먼저 연결을 끊고, DB에서 지우고, 남아 있는 로그인 세션도 못 쓰게 막음
const pool = require('../db');
const rooms = require('../game/rooms');
const realtime = require('./realtime');

const deletedIds = new Set();  // 탈퇴한 유저 id: 다른 탭/기기에 남은 세션으로 들어오는 것을 막음

// 탈퇴한 계정인지 (app.js의 세션 확인, 소켓 접속 확인에서 사용)
function isDeleted(userId) {
  return deletedIds.has(userId);
}

// 계정 삭제: 접속 끊기 -> users에서 삭제 (채팅, 접속 기록은 FK의 ON DELETE CASCADE로 같이 지워짐)
async function deleteUser(userId, kickMessage) {
  const found = rooms.findSocketByUser(userId);
  const io = realtime.getIo();
  if (found && io) {
    const s = io.sockets.sockets.get(found.socketId);
    if (s) {
      s.emit('fatal', kickMessage);
      s.disconnect(true);
    }
  }
  const [result] = await pool.query('DELETE FROM users WHERE id = ?', [userId]);
  if (result.affectedRows > 0) deletedIds.add(userId);
  return result.affectedRows > 0;
}

// 서버 시작 시 DB 구조 맞추기: 예전에 만든 DB에 is_admin(관리자 여부) 컬럼이 없으면 추가
// (schema.sql의 CREATE TABLE IF NOT EXISTS는 이미 있는 테이블에 컬럼을 추가해 주지 않으므로)
async function ensureSchema() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_admin'`
  );
  if (rows[0].n === 0) {
    await pool.query('ALTER TABLE users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER color');
    console.log('users 테이블에 is_admin 컬럼 추가');
  }
  // 게시판 테이블 (schema.sql과 같은 정의. 이미 있으면 그대로 둠)
  await pool.query(POSTS_TABLE_SQL);
}

const POSTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS posts (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT           NOT NULL,
    title      VARCHAR(50)   NOT NULL,
    content    VARCHAR(1000) NOT NULL,
    created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME      NULL,
    CONSTRAINT fk_post_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_post_time (created_at)
  )`;

module.exports = { isDeleted, deleteUser, ensureSchema };
