/*
 * map.js
 * SVG地図の描画とズーム／パン操作。ゲームロジックには一切触れず、
 * 「今のstateをどう描くか」「クリックされたらコールバックを呼ぶ」だけに専念する。
 */

const NODE_RADIUS = 20;
const ISLAND_NODE_RADIUS = 14; // 離島は本土の県より小さく描いて、隣の県と重ならないようにする

// 地図に描く全ノード（47都道府県＋離島。離島は独立するまで非表示）
const MAP_NODES = PREFECTURES.concat(ISLANDS);

const MapView = (() => {
  const svg = document.getElementById('map-svg');
  const NS = 'http://www.w3.org/2000/svg';

  let viewBox = { ...MAP_VIEWBOX };
  const homeViewBox = { ...MAP_VIEWBOX };

  let onPrefClick = null;
  let selectedId = null;

  function applyViewBox() {
    svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
  }

  function resetView() {
    viewBox = { ...homeViewBox };
    applyViewBox();
  }

  function zoomBy(factor, cx, cy) {
    const centerX = cx !== undefined ? cx : viewBox.x + viewBox.width / 2;
    const centerY = cy !== undefined ? cy : viewBox.y + viewBox.height / 2;
    let newW = viewBox.width * factor;
    let newH = viewBox.height * factor;
    newW = Math.max(150, Math.min(homeViewBox.width, newW));
    newH = Math.max(150 * (homeViewBox.height / homeViewBox.width), Math.min(homeViewBox.height, newH));
    viewBox = {
      x: centerX - (centerX - viewBox.x) * (newW / viewBox.width),
      y: centerY - (centerY - viewBox.y) * (newH / viewBox.height),
      width: newW,
      height: newH,
    };
    applyViewBox();
  }

  function zoomToPref(pref) {
    const targetW = homeViewBox.width * 0.28;
    const targetH = homeViewBox.height * 0.28;
    viewBox = {
      x: pref.x - targetW / 2,
      y: pref.y - targetH / 2,
      width: targetW,
      height: targetH,
    };
    applyViewBox();
  }

  function svgPoint(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM().inverse();
    const p = pt.matrixTransform(ctm);
    return p;
  }

  function buildStaticLayers() {
    svg.innerHTML = '';

    // 模様で塗る勢力（ヒョウ柄・星条旗）の塗りパターン
    const defs = document.createElementNS(NS, 'defs');
    defs.innerHTML = PATTERN_DEFS;
    svg.appendChild(defs);

    const linesGroup = document.createElementNS(NS, 'g');
    linesGroup.setAttribute('id', 'adj-lines');
    const drawn = new Set();
    MAP_NODES.forEach((p) => {
      (ADJACENCY[p.id] || []).concat(ISLAND_LINKS[p.id] || []).forEach((nId) => {
        const key = [p.id, nId].sort().join('|');
        if (drawn.has(key)) return;
        drawn.add(key);
        const n = MAP_NODES.find((x) => x.id === nId);
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', p.x);
        line.setAttribute('y1', p.y);
        line.setAttribute('x2', n.x);
        line.setAttribute('y2', n.y);
        line.setAttribute('class', (isSeaLink(p.id, nId) || ISLAND_IDS.includes(p.id) || ISLAND_IDS.includes(nId)) ? 'adj-line sea' : 'adj-line');
        line.setAttribute('data-a', p.id);
        line.setAttribute('data-b', nId);
        if (ISLAND_IDS.includes(p.id) || ISLAND_IDS.includes(nId)) line.setAttribute('display', 'none');
        linesGroup.appendChild(line);
      });
    });
    svg.appendChild(linesGroup);

    const nodesGroup = document.createElementNS(NS, 'g');
    nodesGroup.setAttribute('id', 'pref-nodes');
    MAP_NODES.forEach((p) => {
      const isIsland = ISLAND_IDS.includes(p.id);
      const R = isIsland ? ISLAND_NODE_RADIUS : NODE_RADIUS;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', isIsland ? 'pref-node island-node' : 'pref-node');
      if (isIsland) g.setAttribute('display', 'none'); // 独立するまで非表示（update で切り替える）
      g.setAttribute('data-id', p.id);
      g.setAttribute('transform', `translate(${p.x},${p.y})`);

      // 左右2色の勢力カラーにも対応できるよう、円を左右2枚の半円パスで構成する
      // （単色の場合は両方に同じ色を塗る）
      const leftHalf = document.createElementNS(NS, 'path');
      leftHalf.setAttribute('class', 'fill-half fill-left');
      leftHalf.setAttribute('d', `M 0,${-R} A ${R},${R} 0 0 0 0,${R} Z`);
      g.appendChild(leftHalf);

      const rightHalf = document.createElementNS(NS, 'path');
      rightHalf.setAttribute('class', 'fill-half fill-right');
      rightHalf.setAttribute('d', `M 0,${-R} A ${R},${R} 0 0 1 0,${R} Z`);
      g.appendChild(rightHalf);

      const outline = document.createElementNS(NS, 'circle');
      outline.setAttribute('class', 'outline');
      outline.setAttribute('r', R);
      g.appendChild(outline);

      const kunigaeRing = document.createElementNS(NS, 'circle');
      kunigaeRing.setAttribute('class', 'kunigae-ring');
      kunigaeRing.setAttribute('r', R + 7);
      g.appendChild(kunigaeRing);

      const label = document.createElementNS(NS, 'text');
      label.setAttribute('data-role', 'label');
      label.setAttribute('y', isIsland ? R + 14 : -R - 6); // 離島は隣の県の円と重ならないようラベルを下に出す
      label.textContent = p.name.replace(/[都府県]$/, ''); // 「北海道」の「道」は接尾辞ではないので対象外にする
      g.appendChild(label);

      const badge = document.createElementNS(NS, 'text');
      badge.setAttribute('class', 'badge');
      badge.setAttribute('y', isIsland ? -R - 4 : R + 16);
      badge.setAttribute('data-role', 'badge');
      g.appendChild(badge);

      g.addEventListener('click', (evt) => {
        evt.stopPropagation();
        if (onPrefClick) onPrefClick(p.id);
      });

      nodesGroup.appendChild(g);
    });
    svg.appendChild(nodesGroup);
  }

  function update(state) {
    MAP_NODES.forEach((p) => {
      const g = svg.querySelector(`.pref-node[data-id="${p.id}"]`);
      if (!g) return;
      const pref = state.prefs[p.id];
      if (!pref) return; // まだ独立していない離島は非表示のまま
      if (g.getAttribute('display') === 'none') {
        g.removeAttribute('display');
        svg.querySelectorAll('#adj-lines line').forEach((ln) => {
          if (state.prefs[ln.getAttribute('data-a')] && state.prefs[ln.getAttribute('data-b')]) ln.removeAttribute('display');
        });
      }
      const spec = getFactionColorSpec(state, p.id);
      // 模様の勢力は url(#pat-〇〇)、単色は同じ色を左右に、分割色は左右別々に塗る
      const leftColor = spec.type === 'pattern' ? `url(#pat-${spec.pattern})` : (spec.type === 'solid' ? spec.color : spec.left);
      const rightColor = spec.type === 'pattern' ? `url(#pat-${spec.pattern})` : (spec.type === 'solid' ? spec.color : spec.right);
      const fl = g.querySelector('.fill-left'); if (fl.getAttribute('fill') !== leftColor) fl.setAttribute('fill', leftColor);
      const fr = g.querySelector('.fill-right'); if (fr.getAttribute('fill') !== rightColor) fr.setAttribute('fill', rightColor);

      g.classList.toggle('selected', p.id === selectedId);

      // 県名が変わる県（グンマー化した群馬）のラベルを追従させる
      const labelEl = g.querySelector('[data-role="label"]');
      const labelText = pref.name.replace(/[都府県]$/, '');
      if (labelEl.textContent !== labelText) labelEl.textContent = labelText;

      const badge = g.querySelector('[data-role="badge"]');
      let mark = '';
      if (pref.sovereignId === null && getVassalsOf(state, p.id).length > 0) mark += '★';
      if (pref.charged) mark += '↑';
      if (pref.recentlyDefeated) mark += '↓';
      if (badge.textContent !== mark) badge.textContent = mark;
    });
  }

  function setSelected(id) {
    selectedId = id;
  }

  // お国替えの候補を地図上で左=オレンジ・右=青の丸で囲む。marks=null で全部消す。
  // 丸は土地(id)に付ける（候補のidは土地のidなので、地図の位置とそのまま対応する）
  function setKuniGaeMarks(marks) {
    const left = new Set(marks ? marks.left : []);
    const right = new Set(marks ? marks.right : []);
    svg.querySelectorAll('.pref-node').forEach((g) => {
      const id = g.getAttribute('data-id');
      g.classList.toggle('kunigae-left', left.has(id));
      g.classList.toggle('kunigae-right', right.has(id));
    });
  }

  function init(clickHandler) {
    onPrefClick = clickHandler;
    buildStaticLayers();
    applyViewBox();

    document.getElementById('zoom-reset-btn').addEventListener('click', resetView);
    document.getElementById('zoom-in-btn').addEventListener('click', () => zoomBy(0.7));
    document.getElementById('zoom-out-btn').addEventListener('click', () => zoomBy(1.4));

    svg.addEventListener('wheel', (evt) => {
      evt.preventDefault();
      const p = svgPoint(evt);
      zoomBy(evt.deltaY > 0 ? 1.15 : 0.87, p.x, p.y);
    }, { passive: false });

    // ドラッグでパン（PC）
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    svg.addEventListener('mousedown', (evt) => {
      dragging = true;
      lastX = evt.clientX;
      lastY = evt.clientY;
      svg.classList.add('dragging');
    });
    window.addEventListener('mousemove', (evt) => {
      if (!dragging) return;
      const scale = viewBox.width / svg.clientWidth;
      viewBox.x -= (evt.clientX - lastX) * scale;
      viewBox.y -= (evt.clientY - lastY) * scale;
      lastX = evt.clientX;
      lastY = evt.clientY;
      applyViewBox();
    });
    window.addEventListener('mouseup', () => { dragging = false; svg.classList.remove('dragging'); });

    // ピンチズーム／タップドラッグ（スマートフォン想定の簡易対応）
    let touchStartDist = null;
    let touchStartView = null;
    svg.addEventListener('touchstart', (evt) => {
      if (evt.touches.length === 2) {
        const [a, b] = evt.touches;
        touchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        touchStartView = { ...viewBox };
      } else if (evt.touches.length === 1) {
        lastX = evt.touches[0].clientX;
        lastY = evt.touches[0].clientY;
        dragging = true;
      }
    }, { passive: true });
    svg.addEventListener('touchmove', (evt) => {
      if (evt.touches.length === 2 && touchStartDist) {
        const [a, b] = evt.touches;
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const factor = touchStartDist / dist;
        const newW = Math.max(150, Math.min(homeViewBox.width, touchStartView.width * factor));
        const newH = Math.max(150 * (homeViewBox.height / homeViewBox.width), Math.min(homeViewBox.height, touchStartView.height * factor));
        viewBox = {
          x: touchStartView.x + (touchStartView.width - newW) / 2,
          y: touchStartView.y + (touchStartView.height - newH) / 2,
          width: newW,
          height: newH,
        };
        applyViewBox();
      } else if (evt.touches.length === 1 && dragging) {
        const scale = viewBox.width / svg.clientWidth;
        viewBox.x -= (evt.touches[0].clientX - lastX) * scale;
        viewBox.y -= (evt.touches[0].clientY - lastY) * scale;
        lastX = evt.touches[0].clientX;
        lastY = evt.touches[0].clientY;
        applyViewBox();
      }
    }, { passive: true });
    svg.addEventListener('touchend', () => { dragging = false; touchStartDist = null; });
  }

  return { init, update, setSelected, setKuniGaeMarks, zoomToPref, resetView };
})();
