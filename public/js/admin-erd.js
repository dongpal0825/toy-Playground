// admin-erd.js: 관리자 DB 구조 화면에서 테이블 상자 사이에 관계선(1 ─ N)을 그리는 스크립트
// FK 컬럼 줄(자식 테이블)과 가리키는 PK 컬럼 줄(부모 테이블)을 곡선으로 잇고, 부모 쪽에 1, 자식 쪽에 N을 표시
(function () {
  const wrap = document.getElementById('erd');
  const svg = document.getElementById('erd-lines');
  const relations = JSON.parse(document.getElementById('rel-data').textContent);
  const NS = 'http://www.w3.org/2000/svg';
  const lines = []; // 관계마다 그린 SVG 묶음 (강조할 때 사용)

  // 요소 위치를 ERD 영역 기준 좌표로
  function box(el) {
    // (좁은 화면에서 가로 스크롤했을 때도 맞도록 스크롤 양을 더함)
    const a = el.getBoundingClientRect(), b = wrap.getBoundingClientRect();
    const ox = wrap.scrollLeft - b.left, oy = wrap.scrollTop - b.top;
    return { l: a.left + ox, r: a.right + ox, y: a.top + oy + a.height / 2, cx: (a.left + a.right) / 2 + ox };
  }

  function make(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    parent.appendChild(el);
    return el;
  }

  // 관계선 전부 다시 그리기 (창 크기가 바뀌거나 설명을 켜고 끌 때)
  function draw() {
    svg.innerHTML = '';
    lines.length = 0;
    svg.setAttribute('width', wrap.scrollWidth);
    svg.setAttribute('height', wrap.scrollHeight);
    relations.forEach((rel, i) => {
      const child = wrap.querySelector(`[data-col="${rel.t}.${rel.col}"]`);
      const parent = wrap.querySelector(`[data-col="${rel.refT}.${rel.refCol}"]`);
      if (!child || !parent) return;
      const p = box(parent), c = box(child);
      // 부모가 왼쪽에 있으면 부모 오른쪽 끝 -> 자식 왼쪽 끝, 반대면 반대로
      const leftToRight = p.cx < c.cx;
      const x1 = leftToRight ? p.r : p.l, x2 = leftToRight ? c.l : c.r;
      const dir = leftToRight ? 1 : -1;
      const bend = Math.max(40, Math.abs(x2 - x1) / 2);
      const g = make('g', { class: 'rel' }, svg);
      make('path', { d: `M${x1},${p.y} C${x1 + bend * dir},${p.y} ${x2 - bend * dir},${c.y} ${x2},${c.y}` }, g);
      make('circle', { cx: x1, cy: p.y, r: 4 }, g);
      make('circle', { cx: x2, cy: c.y, r: 4 }, g);
      make('text', { x: x1 + 10 * dir, y: p.y - 6, class: 'one', 'text-anchor': leftToRight ? 'start' : 'end' }, g).textContent = '1';
      make('text', { x: x2 - 10 * dir, y: c.y - 6, class: 'many', 'text-anchor': leftToRight ? 'end' : 'start' }, g).textContent = 'N';
      lines[i] = { g, child, parent };
    });
  }

  // 관계 설명 줄에 마우스를 올리면 그 선과 두 컬럼을 강조
  document.querySelectorAll('.rel-list li').forEach((li) => {
    const i = Number(li.dataset.rel);
    const on = (yes) => {
      const l = lines[i];
      if (!l) return;
      l.g.classList.toggle('hot', yes);
      l.child.classList.toggle('hot', yes);
      l.parent.classList.toggle('hot', yes);
      svg.classList.toggle('dim', yes);
    };
    li.addEventListener('mouseenter', () => on(true));
    li.addEventListener('mouseleave', () => on(false));
  });

  // 컬럼 설명 보기/숨기기
  document.getElementById('show-info').addEventListener('change', (e) => {
    wrap.classList.toggle('no-info', !e.target.checked);
    draw();
  });

  window.addEventListener('resize', draw);
  draw();
})();
