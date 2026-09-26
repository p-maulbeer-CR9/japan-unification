/*
 * tokugawa.js
 * 江戸幕府（徳川家）。
 * ・1603日目に確率30%で開かれる。開かれなかった／その後全滅した場合は、以後16.3日ごとに確率33%で再興する。
 *   15代目（徳川慶喜）まで開かれたら、以後（16代目）は二度と開かれない。
 * ・開かれると、東京都が「江戸」となって独立し（無条件・判定なし）、同時に必ず
 *   愛知(尾張)・和歌山(紀州)・茨城(水戸)の3県が無条件で属国になる。攻守判定は行わない。
 * ・江戸・3藩は幕府が開かれるたびに能力値が上書きされる。
 * ・お国替えモード中は「土地」ではなく「中身（人）」を基準に発動する。江戸幕府は徳川家という人々の話なので、
 *   東京・愛知・和歌山・茨城の元々の中身（originId。kunigae.js参照）が今住んでいる土地を毎回探し直し、
 *   その土地を江戸・尾張・紀州・水戸にする。お国替えで中身がよそへ移っていれば、移った先の土地が対象になる。
 * ・徳川家の「主国」（＝勢力の代表。state.tokugawaCapitalId）が攻め落とされたとき：
 *     - 尾張・紀州・水戸のうち、まだ徳川家の属国として残っているものがあれば、その中から
 *       （能力値合計が最大のものを、同点ならランダムで）1つを新主国とする。地名（尾張など）は
 *       そのままだが、勢力名は引き続き「徳川家」（combat.js/faction.jsの通常の主国継承ロジックを、
 *       この特別処理に置き換える。resolveTokugawaSuccession参照）。
 *       15代目（最終決戦）の幕府だけは、新主国になった場所の能力値を全て10にする。
 *     - 尾張・紀州・水戸が誰も残っていなければ、徳川家は消滅する。江戸・3藩それぞれの名前・能力値は
 *       元に戻し、それ以外の元属国（あれば）は1つにまとめず、それぞれ個別に独立させる。
 *       誰の戦闘であっても「江戸幕府滅亡！！」（15代目なら「江戸幕府完全滅亡！！」）を大きく前面に表示する。
 * ・徳川勢力は常時：攻撃のたびに攻撃力+1〜3（ランダム、メリケンと同じ仕組み）、素早さ常時+1。
 *   「力を蓄える」は通常の+2ではなく攻撃力+1・守備力+1になる（combat.js/gunma.js参照）。
 * ・15代目の江戸幕府を全滅させた状態で日本一統を達成すると「真クリア」（main.js/ui.js参照）。
 * 発生条件や強さを変えたくなったら、このファイルの定数・関数だけ見れば完結するようにしている。
 */

const EDO_ORIGIN_ID = '東京'; // 江戸幕府の主国になる「中身」の元の出自＝東京都（お国替えでよそへ移ってもこのidを追いかける）
const EDO_NAME = '江戸';

// 藩名は combat.js 等からは参照しないので、名前と能力値レンジだけ持つ簡易テーブル
const HAN = [
  { originId: '愛知', hanName: '尾張' },
  { originId: '和歌山', hanName: '紀州' },
  { originId: '茨城', hanName: '水戸' },
];

// 徳川将軍15代（1: 徳川家康 〜 15: 徳川慶喜）
const SHOGUN_NAMES = [
  '徳川家康', '徳川秀忠', '徳川家光', '徳川家綱', '徳川綱吉',
  '徳川家宣', '徳川家継', '徳川吉宗', '徳川家重', '徳川家治',
  '徳川家斉', '徳川家慶', '徳川家定', '徳川家茂', '徳川慶喜',
];
const MAX_SHOGUN = SHOGUN_NAMES.length; // 15

const SHOGUNATE_FIRST_DAY = 1603;
const SHOGUNATE_FIRST_CHANCE = 0.3;
const SHOGUNATE_INTERVAL_DAYS = 16.3; // 1603日目以降、徳川不在の間はこの間隔で再興を判定する
const SHOGUNATE_CHANCE = 0.33;
const SHOGUNATE_TIMELINE_SPREAD_DAYS = 3; // 幕府が開かれた瞬間だけ、江戸・3藩の初回行動をこの日数内にランダム配置する（通常はBASE_TIME_UNIT=10日）

const TOKUGAWA_ATTACK_BONUS_MIN = 1;
const TOKUGAWA_ATTACK_BONUS_MAX = 3; // 攻撃のたびにランダムで+1〜3（メリケンと同じ仕組み）
const TOKUGAWA_SPEED_BONUS = 1;
const TOKUGAWA_CHARGE_ATK_BONUS = 1; // 通常の力を蓄える（+2、離島+3）の代わりに徳川は+1
const TOKUGAWA_CHARGE_DEF_BONUS = 1; // 徳川だけ、力を蓄えている間は守備力にも+1
const TOKUGAWA_FACTION_NAME = '徳川家';

// id が徳川勢力（現在の徳川家の主国＝state.tokugawaCapitalId が主国の勢力）の一員か。
// 幕府が開かれていない間、または徳川家が完全に消滅した後は誰も該当しない。
function isTokugawaFaction(state, id) {
  return !!state.shogunateActive && !!state.tokugawaCapitalId && factionRoot(state, id) === state.tokugawaCapitalId;
}

// id が「今まさに攻め落とされようとしている、現在の徳川家の主国」そのものか
// （combat.js/faction.jsの主国継承ロジックの分岐に使う）。
function isCurrentTokugawaCapital(state, id) {
  return !!state.shogunateActive && state.tokugawaCapitalId === id;
}

// 勢力名（主国名）として表示する名前。地名（江戸・尾張など）はそのままだが、勢力名（属国から見た主国名・
// クリア画面・グラフの凡例など）は「徳川家」にする（faction.js の getSovereignName が必ずここを経由する）。
// rootId には factionRoot() の戻り値（主国のid）を渡す。
function factionDisplayName(state, rootId) {
  if (isCurrentTokugawaCapital(state, rootId)) return TOKUGAWA_FACTION_NAME;
  return state.prefs[rootId].name;
}

function tokugawaAttackRoll() {
  return randInt(TOKUGAWA_ATTACK_BONUS_MIN, TOKUGAWA_ATTACK_BONUS_MAX);
}

function tokugawaSpeedBonus(state, id) {
  return isTokugawaFaction(state, id) ? TOKUGAWA_SPEED_BONUS : 0;
}

function randStatSet(min, max) {
  return { baseAtk: randInt(min, max), baseDef: randInt(min, max), baseSpd: randInt(min, max) };
}

// 幕府を開く（1603日目、または以後の再興判定に当選したときに呼ぶ）。
// 江戸(東京)を無条件で独立させ、必ず同時に尾張(愛知)・紀州(和歌山)・水戸(茨城)を無条件で属国にする（判定なし）。
function openShogunate(state) {
  const edoSlot = findSlotByOriginId(state, EDO_ORIGIN_ID); // 東京の中身が今住んでいる土地（お国替えが無ければ東京自身）

  // 初回だけ、上書きする前の「元の」名前・能力値を記憶しておく（全滅時に戻すため）。originId基準で覚える。
  if (!state.tokugawaOriginalStats) {
    state.tokugawaOriginalStats = {};
    [EDO_ORIGIN_ID, ...HAN.map((h) => h.originId)].forEach((originId) => {
      const p = state.prefs[findSlotByOriginId(state, originId)];
      state.tokugawaOriginalStats[originId] = { name: p.name, baseAtk: p.baseAtk, baseDef: p.baseDef, baseSpd: p.baseSpd };
    });
  }

  state.shogunNumber += 1;
  state.shogunateActive = true;
  state.tokugawaCapitalId = edoSlot;
  const isFinal = state.shogunNumber === MAX_SHOGUN;
  const shogunName = SHOGUN_NAMES[state.shogunNumber - 1];

  state.prefs[edoSlot].sovereignId = null; // 江戸は誰の属国でもない状態にする（既に独立していれば実質no-op）
  state.prefs[edoSlot].name = EDO_NAME;
  Object.assign(state.prefs[edoSlot], isFinal ? { baseAtk: 10, baseDef: 10, baseSpd: 10 } : randStatSet(7, 10));
  state.prefs[edoSlot].nextActionTime = state.simTime + Math.random() * SHOGUNATE_TIMELINE_SPREAD_DAYS;

  HAN.forEach((h) => {
    const hanSlot = findSlotByOriginId(state, h.originId); // その藩の中身が今住んでいる土地
    // 直前まで独立勢力（主国）でプレイヤー自身が操作していた藩が無条件で奪われる場合は、プレイヤーの敗北として扱う
    const wasPlayerRoot = hanSlot === state.playerPrefId && factionRoot(state, hanSlot) === hanSlot;
    forceCapture(state, edoSlot, hanSlot, { absorbVassals: true });
    if (wasPlayerRoot) markPlayerCapitalLossIfNeeded(state, hanSlot, true);

    state.prefs[hanSlot].name = h.hanName;
    Object.assign(state.prefs[hanSlot], isFinal ? randStatSet(8, 10) : randStatSet(5, 10));
    state.prefs[hanSlot].nextActionTime = state.simTime + Math.random() * SHOGUNATE_TIMELINE_SPREAD_DAYS;
  });

  const ordinal = state.shogunNumber === 1 ? '初代' : `${state.shogunNumber}代`;
  const lead = `${ordinal}将軍・${shogunName}が江戸幕府を開いた`;
  pushLog(state, `🏯 江戸幕府が開かれた！！ ${lead}`);

  const notes = [lead];
  if (isFinal) notes.push('最終将軍を倒した上で日本一統すると真クリアとなる');

  // 東京で始めたプレイヤー：初回の開府だけ「徳川家を操作しますか？」を聞く。再開府では聞かずに徳川家として返り咲く
  const isPlayerEdo = state.mode === 'manual' && state.playerPrefId === edoSlot;
  const autoTokugawa = isPlayerEdo && state.tokugawaChoiceMade;
  if (autoTokugawa) {
    const wasDefeated = state.playerDefeated;
    state.playerTokugawa = true;
    state.playerDefeated = false;
    pushLog(state, '👑 プレイヤーは徳川家として返り咲いた！');
    if (wasDefeated) notes.push('プレイヤーは徳川家として返り咲いた');
  }

  const pause = shouldPauseOnInvasion(state);
  state.worldEvent = { headline: '江戸幕府が開かれた！！', notes, time: state.simTime, paused: pause };
  if (pause) state.running = false; // 画面側の検知を待たず、ここで即座に一時停止する

  if (isPlayerEdo && !autoTokugawa) {
    // 東京で始めたプレイヤー（初回の開府）：東京都ではなくなったので、徳川家を操作するかどうかを本人に選んでもらう
    // （返事があるまでタイムラインは止まる。chooseTokugawaPlay参照）
    state.pendingTokugawaChoice = true;
    state.running = false;
  } else if (!isPlayerEdo) {
    checkPlayerComeback(state, null);
  }
}

// 「東京都ではなくなりました。徳川家を操作しますか？」への返事（main.jsの選択画面から呼ぶ）。
// はい：幕府が続く間、主国が江戸・尾張・紀州・水戸のどこにあっても徳川家を操作する。
// いいえ：東京都として返り咲くまで（またはもう一度江戸幕府が開かれて、自動で徳川家の操作に移るまで）操作できない。
function chooseTokugawaPlay(state, yes) {
  if (!state.pendingTokugawaChoice) return;
  state.pendingTokugawaChoice = false;
  state.tokugawaChoiceMade = true;
  state.playerTokugawa = yes;
  state.playerDefeated = !yes;
  pushLog(state, yes
    ? '🏯 プレイヤーは徳川家を操作することにした'
    : '🏯 プレイヤーは徳川家の操作を見送った（東京都として返り咲くまで操作できない）');
}

// 1603日目以降、徳川不在（未開／全滅）の間、16.3日ごとに再興を判定する（tick()から毎フレーム呼ぶ）。
// checkGunmaEra と同じ「era」方式：経過日数からその時点までに判定すべき回数を割り出し、追いついていなければまとめて判定する。
function checkShogunateEra(state) {
  if (state.shogunateActive) return; // 開いている間は判定しない
  if (state.shogunNumber >= MAX_SHOGUN) return; // 15代で打ち止め（16代目以降は開かれない）
  if (state.simTime < SHOGUNATE_FIRST_DAY) return;

  const era = Math.floor((state.simTime - SHOGUNATE_FIRST_DAY) / SHOGUNATE_INTERVAL_DAYS) + 1;
  while (state.shogunateCheckEra < era) {
    state.shogunateCheckEra += 1;
    const chance = state.shogunateCheckEra === 1 ? SHOGUNATE_FIRST_CHANCE : SHOGUNATE_CHANCE;
    if (Math.random() < chance) {
      openShogunate(state);
      return; // 開いたら以降の巻き戻し判定はしない（次はまた全滅後に判定が始まる）
    }
  }
}

// 徳川家の現在の主国（state.tokugawaCapitalId）が攻め落とされたときに呼ぶ、主国継承の特別処理。
// combat.js の resolveCombat・faction.js の forceCapture から、通常の appointSuccessor / absorbVassals
// の代わりに呼ばれる（isCurrentTokugawaCapital で分岐）。
// 戻り値: { successorId, massIndependence }
//   successorId: 尾張・紀州・水戸の中から選ばれた新主国のid（いなければ null）
//   massIndependence: 継げる藩がおらず、バラバラに独立した旧属国のid配列（通常は空配列）
function resolveTokugawaSuccession(state, oldCapitalId, newOwnerRoot) {
  const vassalIds = getVassalsOf(state, oldCapitalId); // 落城直前の属国一覧（まだ書き換わっていない）
  // 「まだ藩か」は土地(id)ではなく中身(originId)で判定する（お国替えで藩の中身がよそへ移っていても、
  // 移った先が徳川家の属国のままなら引き続き継承候補になる）
  const remainingHan = vassalIds.filter((id) => HAN.some((h) => h.originId === state.prefs[id].originId));

  if (remainingHan.length > 0) {
    let bestScore = -Infinity;
    let candidates = [];
    remainingHan.forEach((id) => {
      const p = state.prefs[id];
      const score = p.baseAtk + p.baseDef + p.baseSpd;
      if (score > bestScore) {
        bestScore = score;
        candidates = [id];
      } else if (score === bestScore) {
        candidates.push(id);
      }
    });
    const newCapitalId = candidates[randInt(0, candidates.length - 1)];
    state.prefs[newCapitalId].sovereignId = null;
    vassalIds
      .filter((id) => id !== newCapitalId)
      .forEach((id) => { state.prefs[id].sovereignId = newCapitalId; });

    state.tokugawaCapitalId = newCapitalId;
    // 15代目（最終決戦）だけは、主国になった場所の能力値を必ず全て10にする
    if (state.shogunNumber === MAX_SHOGUN) {
      Object.assign(state.prefs[newCapitalId], { baseAtk: 10, baseDef: 10, baseSpd: 10 });
    }
    return { successorId: newCapitalId, massIndependence: [] };
  }

  // 尾張・紀州・水戸が誰も残っていない＝徳川家は消滅。元属国はそれぞれ個別に独立する（誰か1つにまとめない）
  vassalIds.forEach((id) => { state.prefs[id].sovereignId = null; });
  state.tokugawaCapitalId = null; // checkTokugawaWipeout がこれを見て後片付けする
  // 全滅バナーの白文字用に、誰かが個別独立したことを一時的に覚えておく（checkTokugawaWipeoutが読んでクリアする）
  state.tokugawaPendingMassIndependence = vassalIds.length > 0;
  return { successorId: null, massIndependence: vassalIds };
}

// 江戸・3藩を上書きしていた名前・能力値を元に戻す（徳川家が完全に消滅したときに呼ぶ）。
// お国替えで中身がさらに移動している可能性があるので、この時点で改めてoriginIdの居場所を探し直す。
function restoreTokugawaOriginal(state) {
  if (!state.tokugawaOriginalStats) return;
  [EDO_ORIGIN_ID, ...HAN.map((h) => h.originId)].forEach((originId) => {
    const orig = state.tokugawaOriginalStats[originId];
    const p = state.prefs[findSlotByOriginId(state, originId)];
    if (!orig || !p) return;
    p.name = orig.name;
    p.baseAtk = orig.baseAtk;
    p.baseDef = orig.baseDef;
    p.baseSpd = orig.baseSpd;
  });
}

// 徳川家が完全に消滅したかどうかを判定する。通常の戦闘（timeline.js）・宇宙人のチップ埋め込み
// （invaders.js）いずれの後にも呼んでよい安全な関数（まだ主国が健在／藩が継承していれば何もしない）。
// 消滅の経路は2通り：①resolveTokugawaSuccessionが継ぐ藩がなく tokugawaCapitalId を null にした場合
// （通常の戦闘で江戸・藩が攻め落とされた場合）、②宇宙人のチップ埋め込みのように、後継処理を経由せず
// 主国がまるごと（属国ごと）奪われた場合（この場合は tokugawaCapitalId は更新されないままなので、
// 現在の主国の実際の帰属先を見て判定する）。
// options.queueAfterCurrentWorldEvent=true の場合、既に表示待ち／表示中の世界イベント（UFO襲来など）を
// 上書きせず、それを閉じた直後に続けて表示するようキューに積む（invaders.js参照）。
function checkTokugawaWipeout(state, options = {}) {
  if (!state.shogunateActive) return;
  const capitalId = state.tokugawaCapitalId;
  if (capitalId !== null && factionRoot(state, capitalId) === capitalId) return; // まだ健在、または藩に代替わりして存続中

  state.shogunateActive = false;
  state.tokugawaCapitalId = null;
  const isFinal = state.shogunNumber === MAX_SHOGUN;
  if (isFinal) state.tokugawaFinalDefeated = true;

  restoreTokugawaOriginal(state);

  // 継ぐ藩がおらず旧属国がそれぞれ独立した場合は、バナー下の白文字にもその旨を出す
  const hadMassIndependence = !!state.tokugawaPendingMassIndependence;
  state.tokugawaPendingMassIndependence = false;

  const headline = isFinal ? '江戸幕府完全滅亡！！' : '江戸幕府滅亡！！';
  pushLog(state, `🏯 ${headline}`);

  const pause = shouldPauseOnInvasion(state);
  const notes = hadMassIndependence ? ['徳川家の旧属国はそれぞれ独立した'] : null;
  const event = { headline, notes, time: state.simTime, paused: pause };

  if (options.queueAfterCurrentWorldEvent) {
    state.worldEventQueue.push(event);
  } else {
    state.worldEvent = event;
    if (pause) state.running = false;
  }

  // 徳川家を操作していたプレイヤーは、幕府の滅亡で操作できなくなる（東京都として返り咲くか、
  // もう一度江戸幕府が開かれるまで）
  if (state.playerTokugawa) {
    state.playerTokugawa = false;
    state.playerDefeated = true;
    pushLog(state, '🏯 徳川家の滅亡により、プレイヤーの操作が止まった');
  }

  // 元の東京都がこの滅亡でそのまま独立していれば（旧属国がそれぞれ独立した場合など）、東京都として返り咲く。
  // 滅亡バナーを上書きしないよう、その次に表示する
  checkPlayerComeback(state, null, { queue: true });
}
