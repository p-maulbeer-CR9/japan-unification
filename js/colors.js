/*
 * colors.js
 * 47都道府県の識別カラーを決定する。
 * 人の目で確実に見分けられる色数には限りがあるため、24色の基本パレットを用意し、
 * 24県はその単色、残り23県は基本パレットから2色を選んだ左右分割カラーで表現する。
 * 隣接する都道府県同士はなるべく使用色（分割の場合は2色とも）が被らないよう、
 * 隣接関係（ADJACENCY）を見ながら割り当てる（簡易的なグラフ彩色）。
 */

const BASE_PALETTE_SIZE = 24;

function buildBasePalette() {
  // 色相を均等に24分割しつつ、彩度・明度を3パターンでローテーションして
  // 隣り合う色相同士の見分けやすさをさらに上げる。
  const tiers = [
    { s: 78, l: 52 },
    { s: 60, l: 64 },
    { s: 90, l: 42 },
  ];
  const colors = [];
  for (let i = 0; i < BASE_PALETTE_SIZE; i += 1) {
    const hue = Math.round((360 / BASE_PALETTE_SIZE) * i);
    const tier = tiers[i % tiers.length];
    colors.push(`hsl(${hue}, ${tier.s}%, ${tier.l}%)`);
  }
  return colors;
}

const BASE_PALETTE = buildBasePalette();

function pickLeastUsedIndex(usageCount, excludeSet) {
  let candidates = [];
  for (let i = 0; i < BASE_PALETTE_SIZE; i += 1) {
    if (!excludeSet.has(i)) candidates.push(i);
  }
  if (candidates.length === 0) {
    // 隣接県だけで24色すべて使い切っている場合の保険（この隣接グラフでは通常発生しない）
    candidates = Array.from({ length: BASE_PALETTE_SIZE }, (_, i) => i);
  }
  candidates.sort((a, b) => usageCount[a] - usageCount[b]);
  return candidates[0];
}

// 隣接県が既に使っている基本色indexの集合を返す
function forbiddenIndices(colorAssignment, id) {
  const forbidden = new Set();
  (ADJACENCY[id] || []).forEach((n) => {
    const assigned = colorAssignment[n];
    if (assigned) assigned.forEach((idx) => forbidden.add(idx));
  });
  return forbidden;
}

function assignPrefectureColors() {
  const ids = PREFECTURES.map((p) => p.id);
  // 隣接数が多い（＝色の衝突制約が厳しい）県から先に割り当てる（Welsh-Powell的な貪欲法）
  const order = ids.slice().sort((a, b) => (ADJACENCY[b] || []).length - (ADJACENCY[a] || []).length);
  const solidSlots = new Set(order.slice(0, 24));

  const usageCount = new Array(BASE_PALETTE_SIZE).fill(0);
  const colorAssignment = {}; // id -> [index] または [indexA, indexB]

  order.forEach((id) => {
    const forbidden = forbiddenIndices(colorAssignment, id);

    if (solidSlots.has(id)) {
      const idx = pickLeastUsedIndex(usageCount, forbidden);
      usageCount[idx] += 1;
      colorAssignment[id] = [idx];
    } else {
      const idxA = pickLeastUsedIndex(usageCount, forbidden);
      const forbidden2 = new Set(forbidden);
      forbidden2.add(idxA);
      const idxB = pickLeastUsedIndex(usageCount, forbidden2);
      usageCount[idxA] += 1;
      usageCount[idxB] += 1;
      colorAssignment[id] = [idxA, idxB];
    }
  });

  return colorAssignment;
}

const PREFECTURE_COLOR_ASSIGNMENT = assignPrefectureColors();

// 都道府県以外の特殊勢力（侵略者）専用の色。47色パレットとは重複しない見た目にする。
const SPECIAL_FACTION_COLORS = {
  オソロシア: 'hsl(355, 72%, 24%)', // 不気味な暗赤
  宇宙人: 'hsl(150, 85%, 32%)', // 不気味な蛍光グリーン
  // 離島勢力：47県の基本パレット（明度42〜64%）より明るいパステル／無彩色にして区別する
  佐渡: 'hsl(48, 100%, 82%)', // 金脈の淡い金色
  淡路: 'hsl(320, 100%, 90%)', // 淡いピンク
  隠岐: 'hsl(0, 0%, 90%)', // 白に近い灰色
  対馬: 'hsl(100, 80%, 86%)', // 淡い若草色
};

// 模様（パターン）で塗る勢力。map.js が PATTERN_DEFS の <pattern id="pat-〇〇"> を地図に用意し、fill に url(#pat-〇〇) を使う。
// color: グラフなど単色しか使えない場所の代表色 / swatch: タイムラインの丸など、CSSで描ける場所用の模様
// グンマーは「群馬がグンマー化している間の群馬勢力」の色（getFactionColorSpec 側で切り替える）。
const PATTERN_FACTIONS = {
  メリケン: {
    pattern: 'stripes',
    color: 'hsl(355, 78%, 46%)',
    swatch: 'repeating-linear-gradient(0deg, #c8202f 0 3px, #ffffff 3px 6px)', // 星条旗の赤白ストライプ
  },
  グンマー: {
    pattern: 'leopard',
    color: 'hsl(38, 72%, 52%)',
    swatch: 'radial-gradient(circle at 30% 35%, #5a3413 0 2px, transparent 2.6px), radial-gradient(circle at 72% 68%, #5a3413 0 2px, transparent 2.6px), #e0a83c', // ヒョウ柄
  },
  徳川: {
    pattern: 'tokugawa',
    color: 'hsl(235, 40%, 32%)',
    // 葵色の地に金の外周＋中央の六角形（CSSでは六角形・ストライプは描けないので、外周の金の帯＋中心の金だけ簡略に出す）
    swatch: 'radial-gradient(circle at 50% 50%, #d4af37 0 28%, #2c3468 28% 81%, #d4af37 81% 100%)',
  },
};

const PATTERN_DEFS = `
  <pattern id="pat-stripes" width="12" height="12" patternUnits="userSpaceOnUse">
    <rect width="12" height="12" fill="#ffffff"/>
    <rect width="12" height="6" fill="#c8202f"/>
  </pattern>
  <pattern id="pat-leopard" width="26" height="26" patternUnits="userSpaceOnUse">
    <rect width="26" height="26" fill="#e0a83c"/>
    <g fill="none" stroke="#3a2210" stroke-width="2.6" stroke-linecap="round">
      <g transform="translate(7,7) rotate(20)"><circle r="2" fill="#b8741f" stroke="none"/><path d="M-4.2,1 A4.4,4.4 0 1 1 3,3.4"/></g>
      <g transform="translate(20,11) rotate(200)"><circle r="2" fill="#b8741f" stroke="none"/><path d="M-4.2,1 A4.4,4.4 0 1 1 3,3.4"/></g>
      <g transform="translate(11,20) rotate(110)"><circle r="2" fill="#b8741f" stroke="none"/><path d="M-4.2,1 A4.4,4.4 0 1 1 3,3.4"/></g>
    </g>
  </pattern>
  <pattern id="pat-tokugawa-hex-stripe" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="5" height="5" fill="#d4af37"/>
    <rect width="1" height="5" fill="#2c3468"/>
  </pattern>
  <pattern id="pat-tokugawa" width="40" height="40" x="-20" y="-20" patternUnits="userSpaceOnUse">
    <rect width="40" height="40" fill="#2c3468"/>
    <g transform="translate(20,20) scale(1.2)">
      <circle r="16" fill="#d4af37"/>
      <circle r="13" fill="#2c3468"/>
      <g transform="rotate(30)">
        <path d="M0,-12 L10.392,-6 L10.392,6 L0,12 L-10.392,6 L-10.392,-6 Z" fill="url(#pat-tokugawa-hex-stripe)"/>
      </g>
    </g>
  </pattern>`;

// { type: 'solid', color } / { type: 'split', left, right } / { type: 'pattern', pattern, color, swatch } を返す
function getColorSpec(id) {
  if (PATTERN_FACTIONS[id]) {
    return { type: 'pattern', ...PATTERN_FACTIONS[id] };
  }
  if (SPECIAL_FACTION_COLORS[id]) {
    return { type: 'solid', color: SPECIAL_FACTION_COLORS[id] };
  }
  const indices = PREFECTURE_COLOR_ASSIGNMENT[id];
  if (indices.length === 1) {
    return { type: 'solid', color: BASE_PALETTE[indices[0]] };
  }
  return { type: 'split', left: BASE_PALETTE[indices[0]], right: BASE_PALETTE[indices[1]] };
}
