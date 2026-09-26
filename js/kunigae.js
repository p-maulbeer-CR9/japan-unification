/*
 * kunigae.js
 * お国替えモード（開始画面でON/OFFを選ぶ、デフォルトOFF）。
 *
 * 【土地（id）と中身（originId）の分離】
 * このゲームはこれまで「id」が地図位置・隣接関係・属する地方・主国かどうか・タイムラインの順番
 * （＝土地そのもの）と、県名・能力値・配色（＝そこに住んでいる中身）の両方を兼ねていた。
 * お国替えは「中身（名前・能力値・配色の元・蓄積ダメージ）」だけを2つの土地の間で入れ替える機能なので、
 * 各県データに originId（今その土地に住んでいる中身の元の出自。デフォルトは自分自身のid）を追加し、
 * ・土地に紐づくもの（地図位置・隣接・地方・nextActionTime）→ 今まで通りid（土地）のまま
 * ・中身に紐づくもの（name・baseAtk/Def/Spd・色の参照先・蓄積ダメージdrawStreak）→ お国替えでoriginIdごと移動
 * ・主国の立場とプレイヤー（state.playerPrefId）も中身についていく（transferSovereignty参照）。
 *   主国の中身が属国の土地へ移れば、移った先の土地が主国になる（徳川家の主国tokugawaCapitalIdも同様）
 * という形で共存させる。名前を表示するところは全部 state.prefs[id].name を見ているので、
 * お国替え後は自動的に入れ替わった中身の名前が表示される（ログ・クイップ含め追加対応は不要）。
 * 一方、江戸幕府（tokugawa.js）・グンマー化（gunma.js）は「土地」と「中身」のどちらを基準にするかが
 * 仕様ごとに違う（グンマー化は土地＋元の中身が両方揃っているときだけ／江戸幕府は中身を追いかける）ので、
 * それぞれのファイル側で originId を見て判定している。
 *
 * 【解禁条件】
 * ある勢力(rootId)が、ある地方を「その勢力として初めて」制覇した直後、その主国の次の1回の行動選択
 * （攻撃対象がなくても行動選択画面自体は出す）でだけ「お国替え」が選択肢に出る。このとき力を蓄える等
 * 他の行動を選んでも、そのタイミングを逃したら同じ地方の制覇では二度と出ない（別の地方を新たに制覇したら、
 * また1回だけ出る）。state.pendingKuniGae[rootId] が「今回提示すべきか」の一時フラグで、
 * 主国の手番が来た瞬間に必ず消費（false化）する。
 *
 * 【対象】
 * 同じ勢力に属する県・離島・藩のうち、今「力を蓄えた」状態にあるもの（charged）。
 * 主国の手番でお国替えを選ぶと、対象をシャッフルして左右に最大4つずつ（重複なし）表示し、
 * 左右から1つずつ選んで実行する。対象が2つしかなければ左1・右1、1つ以下なら選択肢自体を出さない。
 * （離島・藩は隠し要素なので、画面の説明文では「島」「藩」という言葉を出さず「場所」と書く）
 */

const KUNIGAE_MAX_PER_SIDE = 4; // 左右それぞれに表示する候補数の上限
const KUNIGAE_AI_PRIORITY_CHANCE = 0.7; // AI（自動モード・自動A・他勢力）が、お国替えが使えるとき優先する確率

// id（土地）が今「力を蓄えた」状態にあるか
function isKuniGaeEligible(state, id) {
  const p = state.prefs[id];
  return !!p && !!p.charged;
}

// originId（中身の元の出自）が今どの土地(id)に住んでいるかを探す。見つからなければoriginId自身を返す
// （まだ一度もお国替えされていない、＝土地と中身のidが一致している場合はこれで正しい）。
function findSlotByOriginId(state, originId) {
  const found = Object.keys(state.prefs).find((id) => state.prefs[id].originId === originId);
  return found || originId;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

// rootId勢力の中から、お国替え対象（力を蓄えた状態）をシャッフルして左右最大4つずつに分ける。
// 対象が2未満なら（左右1つずつも作れない）null を返す。
function buildKuniGaeCandidates(state, rootId) {
  const pool = getFactionMembers(state, rootId).filter((id) => isKuniGaeEligible(state, id));
  if (pool.length < 2) return null;
  const shuffled = shuffleArray(pool);
  const total = Math.min(shuffled.length, KUNIGAE_MAX_PER_SIDE * 2);
  // 奇数個のときは、余った1つを左右どちらに入れるかもランダム（例：5つなら3と2、または2と3）
  let leftCount = Math.floor(total / 2);
  if (total % 2 === 1 && Math.random() < 0.5) leftCount += 1;
  const left = shuffled.slice(0, leftCount);
  const right = shuffled.slice(leftCount, total);
  return { left, right };
}

// prefIdの手番開始時に呼ぶ。お国替えの一時解禁フラグを消費し（結果に関わらずこの手番限りで無効化）、
// 提示できる候補があれば{left,right}を、なければnullを返す。
function consumeKuniGaeOffer(state, prefId) {
  if (!state.kuniGaeMode) return null;
  const isSovereign = factionRoot(state, prefId) === prefId;
  const hadPending = isSovereign && !!state.pendingKuniGae[prefId];
  if (isSovereign) state.pendingKuniGae[prefId] = false; // 提示の有無に関わらずこの手番で必ず消費する
  if (!hadPending) return null;
  return buildKuniGaeCandidates(state, prefId);
}

// checkRegionConquests から、rootIdがregionNameを新たに制覇した瞬間に呼ぶ。
// rootIdにとって「そのregionNameを制覇したのが史上初めて」なら、次の主国の手番でお国替えを1回だけ提示する。
function markRegionMilestoneForKuniGae(state, rootId, regionName) {
  if (!state.kuniGaeMode) return;
  const everSet = state.everConqueredRegionsBy[rootId] || (state.everConqueredRegionsBy[rootId] = new Set());
  if (everSet.has(regionName)) return; // この勢力として2回目以降の制覇（奪還等）は対象外
  everSet.add(regionName);
  state.pendingKuniGae[rootId] = true;
}

// 他の全県が持つ蓄積ダメージ(drawStreak)の矛先を、中身の移動先(slotA→slotB／slotB→slotA)を
// 追いかけるように付け替える（「誰を狙っているか」は土地ではなく中身についての情報のため）。
function relocateDrawStreakTargets(state, slotA, slotB) {
  Object.keys(state.prefs).forEach((id) => {
    const p = state.prefs[id];
    if (!p.drawStreak) return;
    if (p.drawStreak.targetId === slotA) p.drawStreak.targetId = slotB;
    else if (p.drawStreak.targetId === slotB) p.drawStreak.targetId = slotA;
  });
}

// 付け替えた結果、攻撃側と対象がもう隣接しておらず攻撃を続けられない蓄積ダメージをリセットする
function clearUnreachableDrawStreaks(state) {
  Object.keys(state.prefs).forEach((id) => {
    const p = state.prefs[id];
    if (p.drawStreak && !getNeighbors(state, id).includes(p.drawStreak.targetId)) {
      p.drawStreak = null;
    }
  });
}

function swapMapEntries(map, a, b) {
  const va = map[a];
  const vb = map[b];
  delete map[a];
  delete map[b];
  if (vb !== undefined) map[a] = vb;
  if (va !== undefined) map[b] = va;
}

// 主国の中身がお国替えで別の土地へ移ったとき、主国の立場（属国を従える側）も中身と一緒に移す。
// 勢力のidをキーにしている情報（地方制覇の記録・お国替えの解禁フラグ・徳川家の主国）も新しい土地に付け替える。
function transferSovereignty(state, oldRootId, newRootId) {
  Object.values(state.prefs).forEach((p) => {
    if (p.sovereignId === oldRootId) p.sovereignId = newRootId;
  });
  state.prefs[newRootId].sovereignId = null;
  state.prefs[oldRootId].sovereignId = newRootId;

  Object.keys(state.conqueredRegions).forEach((regionName) => {
    if (state.conqueredRegions[regionName] === oldRootId) state.conqueredRegions[regionName] = newRootId;
  });
  swapMapEntries(state.everConqueredRegionsBy, oldRootId, newRootId);
  swapMapEntries(state.pendingKuniGae, oldRootId, newRootId);
  if (state.tokugawaCapitalId === oldRootId) state.tokugawaCapitalId = newRootId;
}

// お国替えを実行する。slotA・slotBの「中身」（名前・能力値・配色の元・蓄積ダメージ）を入れ替える。
// 「土地」側（地図位置・隣接関係・属する地方・タイムラインの順番）は変えない。
// ただし主国かどうか・プレイヤーかどうかは中身についてくる（例：主国の鳥取と属国の兵庫を入れ替えても、
// 主国は鳥取のまま＝兵庫の土地に移った鳥取が主国になる）。
function executeKuniGae(state, slotA, slotB) {
  const pa = state.prefs[slotA];
  const pb = state.prefs[slotB];
  const beforeAName = pa.name;
  const beforeBName = pb.name;
  // グンマー勢力の主国（群馬の土地にいるグンマー）がお国替えされると、秘境を離れてグンマー化が解ける
  const gunmaLeaves = isGunmaFaction(state, GUNMA_ID) && (slotA === GUNMA_ID || slotB === GUNMA_ID);

  const swapFields = ['name', 'baseAtk', 'baseDef', 'baseSpd', 'originId', 'drawStreak'];
  const tmp = {};
  swapFields.forEach((f) => { tmp[f] = pa[f]; });
  swapFields.forEach((f) => { pa[f] = pb[f]; });
  swapFields.forEach((f) => { pb[f] = tmp[f]; });

  if (factionRoot(state, slotA) === slotA) transferSovereignty(state, slotA, slotB);
  else if (factionRoot(state, slotB) === slotB) transferSovereignty(state, slotB, slotA);

  // プレイヤーは中身（最初に選んだ県の人々）の方。土地が入れ替わったら追いかける
  if (state.playerPrefId === slotA) state.playerPrefId = slotB;
  else if (state.playerPrefId === slotB) state.playerPrefId = slotA;

  relocateDrawStreakTargets(state, slotA, slotB);
  clearUnreachableDrawStreaks(state);

  // お国替え対象になった条件（力を蓄えた状態）は、お国替えで使ったものとして解除する
  [pa, pb].forEach((p) => {
    p.charged = false;
  });

  pushLog(state, `🗺️ お国替え！ ${beforeAName}と${beforeBName}が入れ替わった`);
  const notes = gunmaLeaves ? [revertGunmaByKuniGae(state)] : null;

  // オソロシア侵攻等と同じ、画面上部の大きな世界イベントバナーでも知らせる（どの勢力のお国替えでも表示する）
  const pause = shouldPauseOnInvasion(state);
  state.worldEvent = { headline: `${beforeAName}と${beforeBName}がお国替え！！`, notes, time: state.simTime, paused: pause };
  if (pause) state.running = false; // 画面側の検知を待たず、ここで即座に一時停止する
}
