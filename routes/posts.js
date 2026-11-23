// routes/posts.js: 놀이터 게시판 API (글 목록, 읽기, 쓰기, 수정, 삭제). 화면(public/js/board.js)이 fetch로 부름
// 내 글만 수정할 수 있고, 삭제는 글쓴이 본인 또는 관리자만 가능. 새 글이 올라오면 모든 서버 접속자에게 알림
const express = require('express');
const pool = require('../db');
const realtime = require('../lib/realtime');

const router = express.Router();
router.use(express.json({ limit: '10kb' })); // 화면이 JSON으로 보냄

const TITLE_MAX = 50;
const CONTENT_MAX = 1000;
const LIST_LIMIT = 50;          // 목록에 보여 줄 최근 글 수
const POST_COOLDOWN_MS = 10000; // 글 도배 방지: 새 글은 10초에 한 번
const lastPostAt = new Map();   // 유저 id -> 마지막으로 글 쓴 시각

// 로그인한 사람만 (화면이 아니라 API라서 이동 대신 401 JSON으로 응답)
router.use((req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: '로그인이 필요해요.' });
  next();
});

// 제목/내용 검사. 문제 있으면 에러 문구, 괜찮으면 null
function validate(title, content) {
  if (!title) return '제목을 입력해 주세요.';
  if (title.length > TITLE_MAX) return `제목은 ${TITLE_MAX}자까지 쓸 수 있어요.`;
  if (!content) return '내용을 입력해 주세요.';
  if (content.length > CONTENT_MAX) return `내용은 ${CONTENT_MAX}자까지 쓸 수 있어요.`;
  return null;
}

// 모든 서버(방 1~3)의 접속자에게 게시판 변화를 알림 (열려 있는 게시판 목록 새로고침 + 새 글이면 채팅창 안내)
function notify(type, post, nickname) {
  const io = realtime.getIo();
  if (io) io.emit('board', { type, id: post.id, title: post.title, nickname });
}

// 글 목록: 최근 글부터 (내용은 빼고 제목/글쓴이/시각만)
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.title, p.user_id, p.created_at, p.updated_at, u.nickname
         FROM posts p JOIN users u ON u.id = p.user_id
        ORDER BY p.id DESC LIMIT ?`,
      [LIST_LIMIT]
    );
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM posts');
    res.json({ total, posts: rows.map((r) => ({ ...r, mine: r.user_id === req.session.user.id })) });
  } catch (err) {
    next(err);
  }
});

// 글 하나 읽기
router.get('/:id', async (req, res, next) => {
  try {
    const post = await findPost(req.params.id);
    if (!post) return res.status(404).json({ error: '없는 글이에요. (삭제됐을 수 있어요)' });
    const me = req.session.user;
    res.json({ ...post, mine: post.user_id === me.id, canDelete: post.user_id === me.id || !!me.isAdmin });
  } catch (err) {
    next(err);
  }
});

// 글쓰기
router.post('/', async (req, res, next) => {
  try {
    const me = req.session.user;
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    const error = validate(title, content);
    if (error) return res.status(400).json({ error });

    const now = Date.now();
    if (now - (lastPostAt.get(me.id) || 0) < POST_COOLDOWN_MS) {
      return res.status(429).json({ error: '글은 10초에 한 번만 올릴 수 있어요.' });
    }
    lastPostAt.set(me.id, now);

    const [result] = await pool.query('INSERT INTO posts (user_id, title, content) VALUES (?, ?, ?)', [me.id, title, content]);
    notify('new', { id: result.insertId, title }, me.nickname);
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

// 글 수정: 내 글만
router.put('/:id', async (req, res, next) => {
  try {
    const me = req.session.user;
    const post = await findPost(req.params.id);
    if (!post) return res.status(404).json({ error: '없는 글이에요.' });
    if (post.user_id !== me.id) return res.status(403).json({ error: '내가 쓴 글만 수정할 수 있어요.' });

    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    const error = validate(title, content);
    if (error) return res.status(400).json({ error });

    await pool.query('UPDATE posts SET title = ?, content = ?, updated_at = NOW() WHERE id = ?', [title, content, post.id]);
    notify('edit', { id: post.id, title }, me.nickname);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 글 삭제: 글쓴이 본인 또는 관리자
router.delete('/:id', async (req, res, next) => {
  try {
    const me = req.session.user;
    const post = await findPost(req.params.id);
    if (!post) return res.status(404).json({ error: '없는 글이에요.' });
    if (post.user_id !== me.id && !me.isAdmin) return res.status(403).json({ error: '내가 쓴 글만 삭제할 수 있어요.' });

    await pool.query('DELETE FROM posts WHERE id = ?', [post.id]);
    notify('delete', post, me.nickname);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// id로 글 찾기 (글쓴이 닉네임 포함)
async function findPost(idParam) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) return null;
  const [rows] = await pool.query(
    `SELECT p.id, p.user_id, p.title, p.content, p.created_at, p.updated_at, u.nickname
       FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    [id]
  );
  return rows[0] || null;
}

module.exports = router;
