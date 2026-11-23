// board.js: 놀이터 게시판 창 (목록 / 글 읽기 / 글쓰기·수정). 서버의 /api/posts 와 fetch로 주고받음
// 게시판 오브젝트 앞에서 Shift를 누르거나 오른쪽 위 "게시판" 버튼으로 열림. 글 내용은 textContent로만 넣어서 XSS 방지

const $ = (id) => document.getElementById(id);
const el = {
  root: $('board'), sub: $('board-sub'), error: $('board-error'),
  listView: $('board-list-view'), list: $('board-list'),
  readView: $('board-read-view'), readTitle: $('board-read-title'), readMeta: $('board-read-meta'), readContent: $('board-read-content'),
  edit: $('board-edit'), del: $('board-delete'),
  formView: $('board-form-view'), title: $('board-input-title'), content: $('board-input-content'),
  count: $('board-count'), save: $('board-save'),
};

let view = 'list';        // 지금 보고 있는 화면: list / read / form
let current = null;       // 읽고 있는 글
let editingId = null;     // 수정 중인 글 id (새 글이면 null)

// 서버 API 호출 (실패하면 서버가 보낸 에러 문구로 예외)
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청에 실패했어요.');
  return data;
}

// 날짜를 "11. 23. 14:05"처럼 짧게
function fmt(d) {
  const t = new Date(d);
  return t.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function showError(msg) {
  el.error.textContent = msg || '';
  el.error.classList.toggle('hidden', !msg);
}

// 세 화면 중 하나만 보이게
function show(name) {
  view = name;
  el.listView.classList.toggle('hidden', name !== 'list');
  el.readView.classList.toggle('hidden', name !== 'read');
  el.formView.classList.toggle('hidden', name !== 'form');
  showError(null);
}

// ===== 목록 =====
async function loadList() {
  try {
    const data = await api('GET', '/api/posts');
    el.sub.textContent = `글 ${data.total}개`;
    el.list.textContent = '';
    if (data.posts.length === 0) {
      const li = document.createElement('li');
      li.className = 'board-empty';
      li.textContent = '아직 글이 없어요. 첫 글을 남겨 보세요!';
      el.list.appendChild(li);
    }
    for (const p of data.posts) {
      const li = document.createElement('li');
      li.className = 'board-item' + (p.mine ? ' mine' : '');
      const title = document.createElement('span');
      title.className = 'item-title';
      title.textContent = p.title;
      const meta = document.createElement('span');
      meta.className = 'item-meta';
      meta.textContent = `${p.nickname}${p.mine ? ' (나)' : ''} · ${fmt(p.created_at)}${p.updated_at ? ' · 수정됨' : ''}`;
      li.append(title, meta);
      li.addEventListener('click', () => openPost(p.id));
      el.list.appendChild(li);
    }
  } catch (e) {
    showError(e.message);
  }
}

// ===== 글 읽기 =====
async function openPost(id) {
  try {
    current = await api('GET', `/api/posts/${id}`);
    el.readTitle.textContent = current.title;
    el.readMeta.textContent = `${current.nickname} · ${fmt(current.created_at)}${current.updated_at ? ` · 수정 ${fmt(current.updated_at)}` : ''}`;
    el.readContent.textContent = current.content; // 줄바꿈은 CSS(pre-wrap)로 보여 줌
    el.edit.classList.toggle('hidden', !current.mine);
    el.del.classList.toggle('hidden', !current.canDelete);
    show('read');
  } catch (e) {
    showError(e.message);
    show('list');
    loadList();
  }
}

// ===== 글쓰기 / 수정 =====
function openForm(post) {
  editingId = post ? post.id : null;
  el.title.value = post ? post.title : '';
  el.content.value = post ? post.content : '';
  el.save.textContent = post ? '수정 완료' : '등록';
  updateCount();
  show('form');
  el.title.focus();
}
function updateCount() {
  el.count.textContent = `${el.content.value.length} / 1000`;
}

el.formView.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { title: el.title.value.trim(), content: el.content.value.trim() };
  el.save.disabled = true;
  try {
    if (editingId) {
      await api('PUT', `/api/posts/${editingId}`, body);
      await openPost(editingId);
    } else {
      const r = await api('POST', '/api/posts', body);
      await openPost(r.id);
      loadList(); // 위쪽 "글 N개" 숫자도 갱신 (목록은 뒤에서 미리 채워 둠)
    }
  } catch (err) {
    showError(err.message);
  } finally {
    el.save.disabled = false;
  }
});

el.del.addEventListener('click', async () => {
  if (!current || !confirm('이 글을 삭제할까요? 되돌릴 수 없어요.')) return;
  try {
    await api('DELETE', `/api/posts/${current.id}`);
    show('list');
    loadList();
  } catch (e) {
    showError(e.message);
  }
});

$('board-write').addEventListener('click', () => openForm(null));
$('board-back').addEventListener('click', () => { show('list'); loadList(); });
el.edit.addEventListener('click', () => openForm(current));
$('board-cancel').addEventListener('click', () => (editingId ? openPost(editingId) : (show('list'), loadList())));
$('board-close').addEventListener('click', () => closeBoard());
el.content.addEventListener('input', updateCount);
// 창 바깥(어두운 배경)을 누르면 닫기
el.root.addEventListener('pointerdown', (e) => { if (e.target === el.root) closeBoard(); });
// Esc로 닫기 (글쓰는 중이면 내용이 날아가지 않게 확인)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !isBoardOpen()) return;
  if (view === 'form' && (el.title.value || el.content.value) && !confirm('쓰던 글을 닫을까요?')) return;
  closeBoard();
});

// ===== 밖에서 쓰는 함수 (play.js) =====
export function isBoardOpen() {
  return !el.root.classList.contains('hidden');
}
export function openBoard() {
  if (isBoardOpen()) return;
  el.root.classList.remove('hidden');
  show('list');
  loadList();
}
export function closeBoard() {
  el.root.classList.add('hidden');
  if (document.activeElement && el.root.contains(document.activeElement)) document.activeElement.blur();
}
// 다른 사람이 글을 올리거나 고치거나 지웠을 때: 목록을 보고 있으면 새로고침
export function boardChanged(ev) {
  if (!isBoardOpen()) return;
  if (view === 'list') loadList();
  else if (view === 'read' && current && current.id === ev.id && ev.type === 'delete') {
    showError('이 글은 방금 삭제됐어요.');
  }
}
