/*
 * combat.js
 * 実効攻撃力・実効守備力の計算と、戦闘解決（勝敗判定・属国化・主国継承）を担当する。
 * 仕様9〜16章に対応。ここを変更すればバランス調整・ルール変更が完結するようにする。
 */

// オソロシア／宇宙人の勢力に属している間（属国・本体問わず）常時乗る攻撃力ボーナス。
// 各侵略者が領土を持っている間だけ有効（invaders.js側の仕様と対応）。
function invaderFactionAttackBonus(state, id) {
  const root = factionRoot(state, id);
  if (root === OSOROSHIA_ID && invaderHasTerritory(state, OSOROSHIA_ID)) return OSOROSHIA_INNATE_BONUS;
  if (root === ALIEN_ID && invaderHasTerritory(state, ALIEN_ID)) return ALIEN_INNATE_BONUS;
  return 0;
}

// 「力を蓄える」で次の攻撃に乗る攻撃力。通常は+2、離島（佐渡・淡路・隠岐・対馬）は+3、
// 徳川勢力（江戸が主国。tokugawa.js参照）だけは特別に+1（代わりに守備力にも+1が乗る。effectiveDefense参照）
const CHARGE_BONUS = 2;
const ISLAND_CHARGE_BONUS = 3;
function chargeBonusOf(state, id) {
  if (isTokugawaFaction(state, id)) return TOKUGAWA_CHARGE_ATK_BONUS;
  return ISLAND_IDS.includes(id) ? ISLAND_CHARGE_BONUS : CHARGE_BONUS;
}

function effectiveAttack(state, id) {
  const p = state.prefs[id];
  const factionBonus = countAdjacentFactionMembers(state, id);
  const chargeBonus = p.charged ? chargeBonusOf(state, id) : 0;
  const invaderBonus = invaderFactionAttackBonus(state, id);
  return p.baseAtk + factionBonus + chargeBonus + invaderBonus + gunmaAttackBonus(state, id);
}

// 離島（佐渡・淡路・隠岐・対馬）が攻撃するときは、相手の守備力の隣接勢力加算を無視する（ignoreAdjacency=true）
function effectiveDefense(state, id, ignoreAdjacency = false) {
  const p = state.prefs[id];
  const factionBonus = ignoreAdjacency ? 0 : countAdjacentFactionMembers(state, id);
  const defeatPenalty = p.recentlyDefeated ? -1 : 0;
  // 徳川勢力だけ、力を蓄えている間（次の攻撃で消費されるまで）守備力にも+1が乗る
  const chargeDefBonus = p.charged && isTokugawaFaction(state, id) ? TOKUGAWA_CHARGE_DEF_BONUS : 0;
  return p.baseDef + factionBonus + defeatPenalty + chargeDefBonus;
}

// 以下は戦闘ログに内訳を出すための表示用ヘルパー（実際の判定は effectiveAttack/effectiveDefense を使う）。
// resolveCombat内で状態（charged等）が変化する前に呼び出して使うこと。

function attackTerms(state, id) {
  const p = state.prefs[id];
  return [
    { value: p.baseAtk, label: '基本', always: true },
    { value: countAdjacentFactionMembers(state, id), label: '隣接勢力' },
    { value: p.charged ? chargeBonusOf(state, id) : 0, label: '力を蓄えた' },
    { value: invaderFactionAttackBonus(state, id), label: '侵略勢力' },
    { value: gunmaAttackBonus(state, id), label: 'グンマー化' },
  ];
}

function defenseTerms(state, id, ignoreAdjacency = false) {
  const p = state.prefs[id];
  return [
    { value: p.baseDef, label: '基本', always: true },
    { value: ignoreAdjacency ? 0 : countAdjacentFactionMembers(state, id), label: '隣接勢力' },
    { value: p.recentlyDefeated ? -1 : 0, label: '敗北ペナルティ' },
    { value: p.charged && isTokugawaFaction(state, id) ? TOKUGAWA_CHARGE_DEF_BONUS : 0, label: '力を蓄えた' },
  ];
}

// [{value, label}, ...] と最終合計値を「1(基本)+4(隣接勢力)-1(敗北ペナルティ)=4」のような文字列にする。
// 2項目め以降は値が負ならそのまま「-1」、正なら「+1」という表記にする（先頭項目は符号を付けない）。値0の項目は省略する。
// total は呼び出し側が持っている確定値（resolveCombatの戻り値のatk/def）を渡す。
function formatBreakdown(terms, total) {
  const shown = terms.filter((t) => t.always || t.value);
  if (shown.length <= 1) return `${total}`;
  const str = shown.map((t, i) => {
    const sign = i === 0 ? '' : (t.value < 0 ? '' : '+');
    return `${sign}${t.value}(${t.label})`;
  }).join('');
  return `${str}=${total}`;
}

// 主国が失われた（別勢力の属国になった）際、残された属国の中から新主国を選ぶ（仕様16章）。
function appointSuccessor(state, oldRootId) {
  const oldVassals = getVassalsOf(state, oldRootId);
  if (oldVassals.length === 0) return;

  let bestScore = -Infinity;
  let candidates = [];
  oldVassals.forEach((id) => {
    const p = state.prefs[id];
    const score = p.baseAtk + p.baseDef + p.baseSpd;
    if (score > bestScore) {
      bestScore = score;
      candidates = [id];
    } else if (score === bestScore) {
      candidates.push(id);
    }
  });

  const newSovereignId = candidates[randInt(0, candidates.length - 1)];
  state.prefs[newSovereignId].sovereignId = null;
  oldVassals
    .filter((id) => id !== newSovereignId)
    .forEach((id) => { state.prefs[id].sovereignId = newSovereignId; });

  return newSovereignId;
}

// 主国を倒した側が、新主国を立てさせず残された属国もまとめて自分の勢力に組み込む
// （オソロシア・宇宙人の侵攻専用。仕様15〜16章の通常ルールの例外）
function absorbFallenVassals(state, oldRootId, newOwnerRootId) {
  const oldVassals = getVassalsOf(state, oldRootId);
  oldVassals.forEach((id) => { state.prefs[id].sovereignId = newOwnerRootId; });
  return oldVassals;
}

const DESPERATION_BONUS = 3; // キュウソネコカミ！！ 発動時の追加攻撃力
const DESPERATION_CHANCE = 0.2; // 発動確率（条件を満たした場合のみ抽選）
const DESPERATION_CHANCE_BOOSTED = 0.5; // 蓄積ダメージの条件も同時に満たしている場合はこちらの確率を使う

const ACCUMULATED_DRAW_STREAK = 5; // 同じ相手に何回連続で勝てなければ（引き分け・敗北）蓄積ダメージが発動するか
const ACCUMULATED_DRAW_BONUS = 3; // 蓄積ダメージによる追加攻撃力

// 同じ攻撃側が同じ相手に4連続で未勝利（引き分け・敗北）の場合、その次（5回目）の攻撃だけ true になる。
// 「力を蓄える」は resolveCombat を通らないため、このカウントには一切影響しない（自然に無視される）。
function isAccumulatedDrawBonusEligible(state, attackerId, defenderId) {
  const streak = state.prefs[attackerId].drawStreak;
  return !!streak && streak.targetId === defenderId && streak.count === ACCUMULATED_DRAW_STREAK - 1;
}

// 連続未勝利（引き分け・敗北）カウンタを更新する。ボーナスが発動した回（wasBoosted）は結果に関わらずリセットする。
// 勝利した場合のみカウントが途切れる（引き分け・敗北はどちらも積み上がる）。
function updateDrawStreak(attacker, defenderId, result, wasBoosted) {
  if (wasBoosted) {
    attacker.drawStreak = { targetId: defenderId, count: 0 };
    return;
  }
  if (result === 'draw' || result === 'lose') {
    if (attacker.drawStreak && attacker.drawStreak.targetId === defenderId) {
      attacker.drawStreak.count += 1;
    } else {
      attacker.drawStreak = { targetId: defenderId, count: 1 };
    }
  } else {
    attacker.drawStreak = { targetId: defenderId, count: 0 };
  }
}

// attackerId が defenderId を攻撃する。戦闘可否のチェックは呼び出し側（timeline/ai/ui）で行う想定。
// options.absorbVassals=true の場合、defenderが主国だったら新主国を立てさせず属国もまとめて奪う
// （オソロシア・宇宙人の侵攻専用。通常の県同士の戦闘では使わない）。
// 戻り値: { attackerId, defenderId, atk, def, result: 'win'|'draw'|'lose', successorId, absorbedVassals, accumulatedBonus }
function resolveCombat(state, attackerId, defenderId, options = {}) {
  // メリケン勢力（本体と占拠された県）は、攻撃のたびに攻撃力+1か+2（どちらになるかは毎回ランダム）
  const blackShipBonus = factionRoot(state, attackerId) === BLACKSHIP_ID ? randInt(1, 2) : 0;
  // 徳川勢力（江戸が主国。tokugawa.js参照）は、攻撃のたびに攻撃力+1〜3（メリケンと同じ仕組み）
  const tokugawaBonus = isTokugawaFaction(state, attackerId) ? tokugawaAttackRoll() : 0;
  const baseAtk = effectiveAttack(state, attackerId) + blackShipBonus + tokugawaBonus;
  const def = effectiveDefense(state, defenderId, ISLAND_IDS.includes(attackerId));

  const attacker = state.prefs[attackerId];
  const defender = state.prefs[defenderId];

  // 攻撃力ボーナスは「次の攻撃」で消費される（仕様20章）
  attacker.charged = false;

  // 同じ相手に4連続で引き分けていた場合、5回目の攻撃は蓄積ダメージで攻撃力+3
  const accumulatedBonus = isAccumulatedDrawBonusEligible(state, attackerId, defenderId);
  const boostedAtk = accumulatedBonus ? baseAtk + ACCUMULATED_DRAW_BONUS : baseAtk;

  // 相手の守備力が上回る無謀な戦いに挑んだ場合、20%の確率で「キュウソネコカミ！！」が発動し攻撃力+3
  // ただし蓄積ダメージの条件も同時に満たしている場合は、発動確率が50%まで引き上がる。
  const desperationEligible = boostedAtk < def;
  const desperationChance = accumulatedBonus ? DESPERATION_CHANCE_BOOSTED : DESPERATION_CHANCE;
  const desperation = desperationEligible && Math.random() < desperationChance;
  const atk = desperation ? boostedAtk + DESPERATION_BONUS : boostedAtk;

  let result;
  let successorId = null;
  let absorbedVassals = [];
  let tokugawaMassIndependence = [];

  if (atk > def) {
    result = 'win';
    const defenderWasSovereign = getVassalsOf(state, defenderId).length > 0;
    const newOwnerRoot = factionRoot(state, attackerId);
    defender.sovereignId = newOwnerRoot;
    if (defenderWasSovereign) {
      // 徳川家の現在の主国が倒れる場合だけは、通常の継承ルールではなく専用の後継処理に委ねる（tokugawa.js参照）
      if (isCurrentTokugawaCapital(state, defenderId)) {
        const outcome = resolveTokugawaSuccession(state, defenderId, newOwnerRoot);
        successorId = outcome.successorId;
        tokugawaMassIndependence = outcome.massIndependence;
      } else if (options.absorbVassals) {
        absorbedVassals = absorbFallenVassals(state, defenderId, newOwnerRoot);
      } else {
        successorId = appointSuccessor(state, defenderId);
      }
    }
  } else if (atk === def) {
    result = 'draw';
  } else {
    result = 'lose';
    attacker.recentlyDefeated = true; // 攻撃側が敗北した場合、攻撃側に一時的な守備力-1（明確化済み仕様）
  }

  updateDrawStreak(attacker, defenderId, result, accumulatedBonus);

  return {
    attackerId, defenderId, atk, def, result, successorId, absorbedVassals, tokugawaMassIndependence, desperation,
    accumulatedBonus, blackShipBonus, tokugawaBonus, desperationEligible, desperationChance,
  };
}

function canAttack(state, attackerId, defenderId) {
  const neighbors = getNeighbors(state, attackerId);
  if (!neighbors.includes(defenderId)) return false;
  return !isSameFaction(state, attackerId, defenderId);
}

// 攻守判定を行わず、無条件で targetId を factionRootId 勢力の属国にする
// （宇宙人のチップ埋め込みなど、判定なしイベント専用）。
// options.absorbVassals=true の場合、旧属国もまとめて奪う（オソロシア・宇宙人の侵攻専用）。
// falseの場合は通常通り旧属国の中から新主国を立てる。
function forceCapture(state, factionRootId, targetId, options = {}) {
  const defender = state.prefs[targetId];
  const defenderWasSovereign = getVassalsOf(state, targetId).length > 0;
  defender.sovereignId = factionRootId;

  let successorId = null;
  let absorbedVassals = [];
  if (defenderWasSovereign) {
    if (options.absorbVassals) {
      absorbedVassals = absorbFallenVassals(state, targetId, factionRootId);
    } else {
      successorId = appointSuccessor(state, targetId);
    }
  }

  return { successorId, absorbedVassals };
}
