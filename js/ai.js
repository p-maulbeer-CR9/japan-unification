/*
 * ai.js
 * 自動モード、および手動モードにおける非プレイヤー勢力の行動決定ロジック（仕様21章）。
 * 「戦う」か「力を蓄える」かはランダムに決め、戦う場合の攻撃対象決定はここに閉じ込める。
 * 高度な戦略は未確定事項（32章）のため、ここを差し替えるだけで強化できる構造にしている。
 *
 * kuniGaeOffer（お国替えモード時、startTurnがconsumeKuniGaeOfferで用意した{left,right}）が
 * あれば、まずそれを優先するかどうかを判定する（KUNIGAE_AI_PRIORITY_CHANCE、kunigae.js参照）。
 */

function decideAutoAction(state, prefId, kuniGaeOffer) {
  if (kuniGaeOffer && Math.random() < KUNIGAE_AI_PRIORITY_CHANCE) {
    const slotA = kuniGaeOffer.left[randInt(0, kuniGaeOffer.left.length - 1)];
    const slotB = kuniGaeOffer.right[randInt(0, kuniGaeOffer.right.length - 1)];
    return { type: 'kunigae', slotA, slotB };
  }

  const candidates = getAdjacentEnemyTargets(state, prefId);

  if (candidates.length === 0) {
    return { type: 'charge' };
  }

  if (Math.random() < 0.5) {
    return { type: 'charge' };
  }

  // 有利な相手を7割の確率で優先し、3割はランダム（プロトタイプとしての簡易AI）
  if (Math.random() < 0.7) {
    let best = candidates[0];
    let bestDiff = -Infinity;
    candidates.forEach((targetId) => {
      const diff = effectiveAttack(state, prefId) - effectiveDefense(state, targetId, ISLAND_IDS.includes(prefId));
      if (diff > bestDiff) {
        bestDiff = diff;
        best = targetId;
      }
    });
    return { type: 'attack', targetId: best };
  }

  const targetId = candidates[randInt(0, candidates.length - 1)];
  return { type: 'attack', targetId };
}
