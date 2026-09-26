/*
 * invaders.js
 * 47都道府県の勢力とは別枠の特殊イベント「侵略者」。
 * ・オソロシア：500ターンに1回、50%の確率で北海道/青森/秋田のいずれかへ襲来。
 *   まだ領土を持っていない間だけ「オソロシアパワー」+5が乗る。
 * ・宇宙人　　：800ターンに1回、33%の確率で47都道府県のいずれかへ襲来。
 *   領土の有無にかかわらず、常にチップ埋め込みで判定なし・無条件属国化。
 * ・離島　　：佐渡・淡路・隠岐・対馬が、一定ターンごとに確率で親県から独立して勢力になる（ISLANDS、data.js参照）。
 * どちらも、攻撃対象が主国だった場合は通常ルール（新主国が独立）とは異なり、
 * その属国もまとめて自分の勢力に組み込む（absorbVassals、combat.js参照）。
 * どちらも既存の勢力／戦闘／色システムをそのまま再利用する。発生条件や強さを
 * 変えたくなったら、このファイルの定数・関数だけ見れば完結するようにしている。
 */

const OSOROSHIA_ID = 'オソロシア';
const OSOROSHIA_TURN_INTERVAL = 500;
const OSOROSHIA_CHANCE = 0.5;
const OSOROSHIA_TARGETS = ['北海道', '青森', '秋田'];
const OSOROSHIA_POWER_BONUS = 5; // 領土を持つ前だけの奇襲ボーナス
const OSOROSHIA_INNATE_BONUS = 1; // 領土を持った後も、通常の攻守方法の中で常に乗る攻撃力+1

const ALIEN_ID = '宇宙人';
const ALIEN_TURN_INTERVAL = 800;
const ALIEN_CHANCE = 0.33;
const ALIEN_INNATE_BONUS = 2; // 領土を持った後も、通常の攻守方法の中で常に乗る攻撃力+2

// 黒船来航（メリケン）。1853ターン目に必ず来航し、以降は470ターンごとに33%の確率で来航する。
// 来航地は段階（state.blackShipStage）で変わる：0=浦賀のみ → 神奈川を占拠すると1（日米和親条約）
// → 1で横浜を占拠すると2（日米通商修好条約）。占拠されるのは来航地に対応する県で、判定は通常の攻守と同じ。
const BLACKSHIP_ID = 'メリケン';
const BLACKSHIP_FIRST_TURN = 1853;
const BLACKSHIP_TURN_INTERVAL = 470;
const BLACKSHIP_CHANCE = 0.33;
const BLACKSHIP_QUIP = '開国シテクダサーイ！';
const BLACKSHIP_QUIP_AFTER_TREATY = 'ねぇ、開国シテクダサーイよぉ～'; // 日米通商修好条約のあと（5港に来航する段階）
const BLACKSHIP_PORTS = [
  [{ port: '浦賀', prefId: '神奈川' }],
  [{ port: '横浜', prefId: '神奈川' }, { port: '下田', prefId: '静岡' }, { port: '函館', prefId: '北海道' }],
  [{ port: '函館', prefId: '北海道' }, { port: '横浜', prefId: '神奈川' }, { port: '新潟', prefId: '新潟' }, { port: '神戸', prefId: '兵庫' }, { port: '長崎', prefId: '長崎' }],
];

// 侵略者用の特殊エントリを（初回だけ）state.prefs に用意する。
// nextActionTime は Infinity にして、通常のタイムライン処理では絶対に選ばれないようにする。
function ensureInvaderFaction(state, id) {
  if (!state.prefs[id]) {
    state.prefs[id] = {
      id,
      name: id,
      baseAtk: 0,
      baseDef: 0,
      baseSpd: 0,
      sovereignId: null,
      charged: false,
      recentlyDefeated: false,
      drawStreak: null,
      nextActionTime: Infinity,
      originId: id,
    };
  }
  return state.prefs[id];
}

function invaderHasTerritory(state, id) {
  return getVassalsOf(state, id).length > 0;
}

// 攻撃対象がプレイヤー勢力だった場合の、勝敗バナー情報を作る（主語は常にプレイヤー自身の県にする）
function buildPlayerBanner(state, invaderId, targetId, targetRootBefore, targetSovereignBefore, result, desperation, accumulatedBonus) {
  const playerRoot = getPlayerFactionRoot(state);
  if (playerRoot === null || targetRootBefore !== playerRoot) return null;
  const playerOutcome = result === 'draw' ? 'draw' : (result === 'win' ? 'lose' : 'win'); // 侵略者が勝てばプレイヤーの敗北、負ければ防衛成功
  return {
    selfName: state.prefs[targetId].name,
    selfSovereign: targetSovereignBefore,
    opponentName: state.prefs[invaderId].name,
    opponentSovereign: state.prefs[invaderId].name, // 侵略者の主国は常に自分自身
    playerWasAttacker: false, // 侵略イベントでは常にプレイヤー側が防御側
    playerOutcome,
    desperation: !!desperation,
    accumulatedBonus: !!accumulatedBonus,
  };
}

function markPlayerCapitalLossIfNeeded(state, targetId, captured) {
  if (captured && isPlayerHome(state, targetId)) {
    state.playerDefeated = true;
  }
}

// 主国を倒して属国もまとめて奪った場合のログ用文言
function describeAbsorbedVassals(state, absorbedVassals) {
  if (!absorbedVassals || absorbedVassals.length === 0) return '';
  const names = absorbedVassals.map((id) => state.prefs[id].name).join('・');
  return ` ／ 旧属国の${names}もまとめて属国にした`;
}

function maybeTriggerOsoroshia(state) {
  if (state.turnCount % OSOROSHIA_TURN_INTERVAL !== 0) return;
  if (Math.random() >= OSOROSHIA_CHANCE) return;

  const candidates = OSOROSHIA_TARGETS.filter((id) => factionRoot(state, id) !== OSOROSHIA_ID);
  if (candidates.length === 0) return;
  const targetId = candidates[randInt(0, candidates.length - 1)];
  const targetName = state.prefs[targetId].name;
  const targetRootBefore = factionRoot(state, targetId);
  const targetSovereignBefore = getSovereignName(state, targetId);

  const osoroshia = ensureInvaderFaction(state, OSOROSHIA_ID);
  const powered = !invaderHasTerritory(state, OSOROSHIA_ID);
  // 領土を持った後の常時+1は effectiveAttack 側（invaderFactionAttackBonus）で自動的に乗るので、ここでは足さない
  osoroshia.baseAtk = randInt(1, 10) + (powered ? OSOROSHIA_POWER_BONUS : 0);
  osoroshia.charged = false;

  const res = resolveCombat(state, OSOROSHIA_ID, targetId, { absorbVassals: true });

  let msg = res.accumulatedBonus ? `💥 オソロシア 蓄積ダメージ！！（${targetName}に5連続未勝利・攻撃力+${ACCUMULATED_DRAW_BONUS}） ` : '';
  msg += `🌫️ オソロシアが${targetName}に襲来！（攻撃力${res.atk}${powered ? '／オソロシアパワー込み' : ''}）`;
  if (res.result === 'win') {
    msg += ` → ${targetName}を制圧し、オソロシアの属国にした！`;
  } else if (res.result === 'draw') {
    msg += ` → ${targetName}と互角（引き分け）`;
  } else {
    msg += ` → ${targetName}(守備力${res.def})が撃退した！`;
  }
  msg += describeAbsorbedVassals(state, res.absorbedVassals);
  markPlayerCapitalLossIfNeeded(state, targetId, res.result === 'win');
  if (res.result === 'win' && isPlayerHome(state, targetId)) {
    msg += `（プレイヤーの本拠地が陥落。以後この勢力はAIが操作する）`;
  }
  pushLog(state, msg);

  // バナー下の白文字メッセージ（勝利・引き分け・敗北の3パターン）
  let notes;
  if (res.result === 'win') {
    notes = [`オソロシアが${targetName}に襲来！${powered ? 'オソロシアパワーで' : ''}`, `${targetName}を制圧し、オソロシアの属国にした！`];
  } else if (res.result === 'draw') {
    notes = [`オソロシアが${targetName}に襲来！`, `${targetName}と互角、オソロシアは撤退した！`];
  } else {
    notes = [`オソロシアが${targetName}に襲来！`, `${targetName}はオソロシアを撃退した！`];
  }

  const pause = shouldPauseOnInvasion(state);
  state.worldEvent = { headline: 'オソロシア侵攻！！', notes, time: state.simTime, paused: pause };
  if (pause) state.running = false; // 画面側の検知を待たず、ここで即座に一時停止する（次のtick()が先に進むのを防ぐ）。設定で止めない場合はそのまま続行する
  state.lastBattle = {
    ...res,
    attackerName: OSOROSHIA_ID,
    defenderName: targetName,
    time: state.simTime,
    playerBanner: buildPlayerBanner(state, OSOROSHIA_ID, targetId, targetRootBefore, targetSovereignBefore, res.result, res.desperation, res.accumulatedBonus),
  };

  checkTokugawaWipeout(state); // 万一この侵略イベントが江戸（東京）を攻め落としていた場合に備えて念のため確認する
  checkGameClear(state);
}

function maybeTriggerAliens(state) {
  if (state.turnCount % ALIEN_TURN_INTERVAL !== 0) return;
  if (Math.random() >= ALIEN_CHANCE) return;

  const candidates = getAllPrefIds(state).filter((id) => factionRoot(state, id) !== ALIEN_ID);
  if (candidates.length === 0) return;
  const targetId = candidates[randInt(0, candidates.length - 1)];
  const targetName = state.prefs[targetId].name;
  const targetRootBefore = factionRoot(state, targetId);
  const targetSovereignBefore = getSovereignName(state, targetId);

  ensureInvaderFaction(state, ALIEN_ID);

  // 15代目（最終決戦）の江戸幕府の主国だけは、宇宙人の洗脳を退ける（無条件属国化されない・領地も奪われない）
  const resisted = isCurrentTokugawaCapital(state, targetId) && state.shogunNumber === MAX_SHOGUN;

  let successorId = null;
  let absorbedVassals = [];
  let msg;
  let notes;

  if (resisted) {
    msg = `🛸 宇宙人が${targetName}にチップを埋め込もうとした…！ しかし徳川は宇宙人の洗脳を退けた！`;
    notes = [`宇宙人が${targetName}にチップを埋め込もうとした…！`, `徳川は宇宙人の洗脳を退けた`];
  } else {
    // 宇宙人の領土がすでにある場合も含め、UFO襲来は常にチップ埋め込みで判定なし・無条件で洗脳属国化（属国もまとめて奪う）
    const outcome = forceCapture(state, ALIEN_ID, targetId, { absorbVassals: true });
    successorId = outcome.successorId;
    absorbedVassals = outcome.absorbedVassals;
    msg = `🛸 宇宙人が${targetName}にチップを埋め込んだ…！ 洗脳され、無条件で宇宙人の属国になった！`;
    msg += describeAbsorbedVassals(state, absorbedVassals);
    markPlayerCapitalLossIfNeeded(state, targetId, true);
    if (isPlayerHome(state, targetId)) {
      msg += `（プレイヤーの本拠地が陥落。以後この勢力はAIが操作する）`;
    }
    // バナー下の白文字メッセージ（2行だけ。旧属国の県名の羅列は長くなるのでログにだけ残す）
    notes = [`宇宙人が${targetName}にチップを埋め込んだ…！`, `洗脳され、無条件で宇宙人の属国になった！`];
  }
  pushLog(state, msg);

  const pause = shouldPauseOnInvasion(state);
  state.worldEvent = { headline: 'UFO襲来！！', notes, time: state.simTime, paused: pause };
  if (pause) state.running = false; // 画面側の検知を待たず、ここで即座に一時停止する（次のtick()が先に進むのを防ぐ）。設定で止めない場合はそのまま続行する

  if (!resisted) {
    state.lastBattle = {
      attackerId: ALIEN_ID,
      defenderId: targetId,
      atk: null,
      def: null,
      result: 'win',
      successorId,
      absorbedVassals,
      desperation: false,
      forced: true,
      attackerName: ALIEN_ID,
      defenderName: targetName,
      time: state.simTime,
      playerBanner: buildPlayerBanner(state, ALIEN_ID, targetId, targetRootBefore, targetSovereignBefore, 'win', false),
    };
    // 万一この侵略イベントが徳川家の現在の主国を攻め落としていた場合は、「江戸幕府滅亡！！」を
    // 今出したUFO襲来バナーの直後に続けて表示する（上書きしない）
    checkTokugawaWipeout(state, { queueAfterCurrentWorldEvent: true });
  }
  checkGameClear(state);
}

function maybeTriggerBlackShip(state) {
  const t = state.turnCount;
  const due = t === BLACKSHIP_FIRST_TURN
    || (t > BLACKSHIP_FIRST_TURN && (t - BLACKSHIP_FIRST_TURN) % BLACKSHIP_TURN_INTERVAL === 0 && Math.random() < BLACKSHIP_CHANCE);
  if (!due) return;

  const stage = state.blackShipStage || 0;
  const candidates = BLACKSHIP_PORTS[stage].filter((p) => factionRoot(state, p.prefId) !== BLACKSHIP_ID);
  if (candidates.length === 0) return;
  const { port, prefId: targetId } = candidates[randInt(0, candidates.length - 1)];
  const targetName = state.prefs[targetId].name;
  const targetRootBefore = factionRoot(state, targetId);
  const targetSovereignBefore = getSovereignName(state, targetId);

  const merica = ensureInvaderFaction(state, BLACKSHIP_ID);
  merica.baseAtk = randInt(1, 10); // 他は通常の県と同じ
  merica.charged = false;

  const res = resolveCombat(state, BLACKSHIP_ID, targetId, { absorbVassals: true });

  // 条約：浦賀で占拠→日米和親条約（次は横浜・下田・函館）、横浜で占拠（2段階目）→日米通商修好条約（次は5港）
  let treaty = null;
  if (res.result === 'win') {
    if (stage === 0) {
      treaty = '日米和親条約が結ばれた';
      state.blackShipStage = 1;
    } else if (stage === 1 && port === '横浜') {
      treaty = '日米通商修好条約が結ばれた';
      state.blackShipStage = 2;
    }
  }

  let msg = res.accumulatedBonus ? `💥 メリケン 蓄積ダメージ！！（${targetName}に5連続未勝利・攻撃力+${ACCUMULATED_DRAW_BONUS}） ` : '';
  msg += `🚢 ${port}に黒船来航！（攻撃力${res.atk}）`;
  if (res.result === 'win') {
    msg += ` → ${targetName}はメリケンに占拠された`;
    if (treaty) msg += `。${treaty}`;
  } else if (res.result === 'draw') {
    msg += ` → ${targetName}と互角（しかし、なんとか退けた）`;
  } else {
    msg += ` → ${targetName}(守備力${res.def})が撃退した！（しかし、なんとか退けた）`;
  }
  msg += describeAbsorbedVassals(state, res.absorbedVassals);
  markPlayerCapitalLossIfNeeded(state, targetId, res.result === 'win');
  if (res.result === 'win' && isPlayerHome(state, targetId)) {
    msg += `（プレイヤーの本拠地が陥落。以後この勢力はAIが操作する）`;
  }
  pushLog(state, msg);

  // バナー下の白文字メッセージ。メリケン勝利は占拠＋（あれば）条約の2行、引き分け・敗北は「退けた」の1行
  const notes = res.result === 'win'
    ? [`${port}に黒船来航！${targetName}はメリケンに占拠された`, treaty].filter(Boolean)
    : [`${port}に黒船来航！しかし、なんとか退けた`];
  // 戦闘メッセージ：勝敗にかかわらず、見出し（黒船来航！！）の上に白文字で出す。
  // 日米通商修好条約のあと（5港に来航する段階）は口調が変わる。
  const quip = state.showBattleQuips ? (stage >= 2 ? BLACKSHIP_QUIP_AFTER_TREATY : BLACKSHIP_QUIP) : null;

  // プレイヤーが絡む来航のときだけ、これまでどおり勝敗バナーも出す（メッセージはそちらには載せない）
  const pause = shouldPauseOnInvasion(state);
  const playerBanner = buildPlayerBanner(state, BLACKSHIP_ID, targetId, targetRootBefore, targetSovereignBefore, res.result, res.desperation, res.accumulatedBonus);

  state.worldEvent = { headline: '黒船来航！！', notes, quip, time: state.simTime, paused: pause };
  if (pause) state.running = false; // 画面側の検知を待たず、ここで即座に一時停止する（次のtick()が先に進むのを防ぐ）
  state.lastBattle = {
    ...res,
    attackerName: BLACKSHIP_ID,
    defenderName: targetName,
    time: state.simTime,
    playerBanner,
  };

  checkTokugawaWipeout(state); // 万一この侵略イベントが江戸（東京）を攻め落としていた場合に備えて念のため確認する
  checkGameClear(state);
}

// 離島（佐渡・淡路・隠岐・対馬）の独立。一定ターンごとに確率で、まだ独立していなければ独立勢力として現れる。
// 攻撃力・守備力・素早さは通常の都道府県と同じ乱数（1〜10）。
function maybeTriggerIslandIndependence(state) {
  ISLANDS.forEach((isl) => {
    const existing = state.prefs[isl.id];
    // 独立済みで、まだ他勢力の属国になっていない間は判定しない（属国になった後は再独立の判定対象）
    if (existing && existing.sovereignId === null) return;
    if (state.turnCount % isl.interval !== 0) return;
    if (Math.random() >= ISLAND_INDEPENDENCE_CHANCE) return;

    const parentName = state.prefs[isl.parentId].name;
    const parentSovereignName = getSovereignName(state, isl.parentId);
    if (existing) {
      // 他の県に取られていた島が、能力値・中身の出自(originId)はそのままに再び独立する
      existing.sovereignId = null;
      existing.recentlyDefeated = false;
      existing.drawStreak = null;
    } else {
      state.prefs[isl.id] = {
        id: isl.id,
        name: isl.name,
        baseAtk: randInt(1, 10),
        baseDef: randInt(1, 10),
        baseSpd: randInt(1, 10),
        sovereignId: null,
        charged: false,
        recentlyDefeated: false,
        drawStreak: null,
        nextActionTime: state.simTime + Math.random() * BASE_TIME_UNIT,
        originId: isl.id,
      };
    }
    // 独立するのは島の「土地」。お国替えで別の中身（例：長崎）が住んでいれば、その名前で独立する
    const islandName = state.prefs[isl.id].name;
    // バナー下：1行目は決まり文句（「！」まで）、2行目は独立元の県と、その時点の主国を添える
    const secondLine = `${islandName}が${parentName}（主国:${parentSovereignName}）から独立した`;
    pushLog(state, `🏝️ ${isl.lead}${secondLine}`);

    const pause = shouldPauseOnInvasion(state);
    state.worldEvent = { headline: `${islandName}が${parentName}から独立！！`, notes: [isl.lead, secondLine], time: state.simTime, paused: pause };
    if (pause) state.running = false;
  });
}

// 通常ターンが1回完了するたびに呼ぶ。カウンタを進め、条件を満たせば各侵略イベントを判定する。
function processInvaderEvents(state) {
  state.turnCount = (state.turnCount || 0) + 1;
  maybeTriggerOsoroshia(state);
  maybeTriggerAliens(state);
  maybeTriggerIslandIndependence(state);
  maybeTriggerBlackShip(state);
}
