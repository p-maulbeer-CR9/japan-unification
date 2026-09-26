/*
 * faction.js
 * 主国・属国・勢力に関する参照ロジック。データ構造は「主国(root) + 直属の属国」のフラット構造のみ
 * （仕様15章：奪った属国の、さらにその属国までは連鎖しない）。
 */

function isVassal(state, id) {
  return state.prefs[id].sovereignId !== null;
}

// 自分の勢力の根っこ（主国）のIDを返す。独立県・主国自身は自分自身を返す。
function factionRoot(state, id) {
  const sovereignId = state.prefs[id].sovereignId;
  return sovereignId !== null ? sovereignId : id;
}

function isSameFaction(state, a, b) {
  return factionRoot(state, a) === factionRoot(state, b);
}

// id の現在の主国名（独立県・主国自身の場合は自分自身の名前）。
// 徳川（江戸）だけは地名（江戸）と勢力名（徳川家）が異なるので、勢力名としてはこちらを必ず経由する（tokugawa.js参照）。
function getSovereignName(state, id) {
  return factionDisplayName(state, factionRoot(state, id));
}

// rootId を主国とする勢力に所属する属国一覧（root自身は含まない）
function getVassalsOf(state, rootId) {
  return Object.values(state.prefs)
    .filter((p) => p.sovereignId === rootId)
    .map((p) => p.id);
}

// rootId 勢力に属する全県（root含む）
function getFactionMembers(state, rootId) {
  return [rootId, ...getVassalsOf(state, rootId)];
}

function getFactionSize(state, id) {
  return getFactionMembers(state, factionRoot(state, id)).length;
}

// id の現在の隣接県（まだ独立していない離島は含めない）
function getNeighbors(state, id) {
  return (ADJACENCY[id] || []).concat(ISLAND_LINKS[id] || []).filter((n) => state.prefs[n]);
}

// 判定対象の全県（47都道府県＋すでに独立している離島）
function getAllPrefIds(state) {
  return PREFECTURES.map((p) => p.id).concat(ISLAND_IDS.filter((id) => state.prefs[id]));
}

// 地方制覇の判定対象（その地方の都道府県＋すでに出現している、その地方の離島）
function getRegionMembers(state, regionName) {
  const islandIds = ISLANDS.filter((isl) => isl.region === regionName && state.prefs[isl.id]).map((isl) => isl.id);
  return REGIONS[regionName].concat(islandIds);
}

// id に隣接する県のうち、自分と同じ勢力に属する県（属国・主国どちらも含む）の数（戦力ボーナス）
function countAdjacentFactionMembers(state, id) {
  const root = factionRoot(state, id);
  return getNeighbors(state, id).filter((n) => factionRoot(state, n) === root).length;
}

// id が攻撃可能な隣接する敵県（別勢力）の一覧
function getAdjacentEnemyTargets(state, id) {
  const root = factionRoot(state, id);
  return getNeighbors(state, id).filter((n) => factionRoot(state, n) !== root);
}

// 勢力（主国）の色。単色 { type:'solid', color } または左右分割 { type:'split', left, right }
function getFactionColorSpec(state, id) {
  const root = factionRoot(state, id);
  if (isGunmaFaction(state, root)) return getColorSpec('グンマー'); // グンマー化した群馬勢力はヒョウ柄（土地基準。gunma.js参照）
  if (isCurrentTokugawaCapital(state, root)) return getColorSpec('徳川'); // 江戸幕府（徳川家）は三つ葉葵。尾張等が主国を継いだ後も同じ配色
  // 配色は「土地(root)」ではなく「今そこに住んでいる中身(originId)」についてくる。
  // お国替え（kunigae.js）で中身が移動していても、元々割り当てられた配色をそのまま使うため。
  const displayId = (state.prefs[root] && state.prefs[root].originId) || root;
  return getColorSpec(displayId);
}

// タイムラインのドットなど単色で十分な箇所向けに、代表色を1つだけ返す
function getFactionColor(state, id) {
  const spec = getFactionColorSpec(state, id);
  return spec.type === 'split' ? spec.left : spec.color;
}

// タイムラインの丸・凡例の色見本用。模様の勢力はCSSで描ける模様（swatch）、それ以外は単色
function getFactionSwatch(state, id) {
  const spec = getFactionColorSpec(state, id);
  return spec.swatch || getFactionColor(state, id);
}
