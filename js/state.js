/*
 * state.js
 * ゲーム状態の生成・保持を担当する。ルール計算そのもの（実効値・戦闘）は combat.js / faction.js に分離する。
 */

const BASE_TIME_UNIT = 10; // 素早さ10のとき行動間隔が1.0になる基準値（仕様18章）

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createInitialState() {
  const prefs = {};

  PREFECTURES.forEach((p) => {
    prefs[p.id] = {
      id: p.id,
      name: p.name,
      baseAtk: randInt(1, 10),
      baseDef: randInt(1, 10),
      baseSpd: randInt(1, 10),
      sovereignId: null, // null = 独立 or 主国（vassals を持つかどうかで判別）
      charged: false, // 力を蓄えた状態（攻撃力+2、離島は+3。次の攻撃消費で解除）
      recentlyDefeated: false, // 攻撃失敗による守備力-1状態（自分の次のターン開始で解除）
      drawStreak: null, // 同じ相手への連続引き分けカウンタ（蓄積ダメージ判定用） { targetId, count }
      nextActionTime: Math.random() * BASE_TIME_UNIT, // 初期行動時刻をばらけさせる
      originId: p.id, // この「土地(id)」に今住んでいる中身の元の出自。お国替え（kunigae.js）で中身ごと入れ替わる。地名・能力値・配色はoriginId側についてくる
    };
  });

  // 県数が1つだけの地方（北海道地方）は開始時点で既にその県が制覇している状態なので、
  // 開始直後に「制覇！！」が出ないよう初期値として記録しておく
  const conqueredRegions = {};
  Object.entries(REGIONS).forEach(([regionName, prefIds]) => {
    if (prefIds.length === 1) conqueredRegions[regionName] = prefIds[0];
  });

  return {
    prefs,
    simTime: 0,
    speed: 1,
    running: false,
    mode: 'manual', // 'manual' | 'auto'
    playerPrefId: null,
    playerDefeated: false,
    playerTokugawa: false, // 東京で始めたプレイヤーが、江戸幕府が開かれたときに「徳川家を操作する」を選んだか（幕府が続く間は主国が藩に移っても操作できる。tokugawa.js参照）
    pendingTokugawaChoice: false, // 「徳川家を操作しますか？」の返事待ち（その間タイムラインは止まる）
    tokugawaChoiceMade: false, // 上の選択をすでに1回したか（2回目以降の開府では聞かずに自動で徳川家の操作に移る）
    pendingPlayerDecision: null, // { prefId, candidates: [id,...] }
    operationMode: 'manual', // 'manual' | 'autoA' | 'autoB'。手動モード中、操作県の行動を自動化するか（⚙の設定で切替。autoA=AIに任せる／autoB=毎回力を蓄える）
    log: [],
    winnerRootId: null,
    lastBattle: null, // 直近の戦闘演出用データ
    turnCount: 0, // 侵略イベント（オソロシア・宇宙人）の発生判定に使う通算ターン数
    worldEvent: null, // 侵略イベント・地方制覇発生時の前面表示用データ
    worldEventQueue: [], // worldEventに続けてもう1つ世界イベントバナーを出したいときのキュー（今のバナーを閉じた直後に次を表示する。main.js参照）
    pauseOnInvasion: true, // オソロシア侵攻・UFO襲来で自動停止するか（ゲーム中に画面のボタンで切り替え）
    pauseOnPlayerBattle: true, // 自勢力の戦闘結果で自動停止するか（⚙の設定で切替。自動A/B中に観察を続けたい場合はOFFにする）
    showBattleQuips: true, // 戦闘メッセージ（勝敗バナーの上のひとこと）を表示するか（ゲーム中に⚙の設定で切り替え）
    gunmaified: false, // 群馬がグンマー化済みか（一度なったら戻らない）
    gunmaCheckEra: 0, // 何回目の「1,000日単位」までグンマー化を判定したか
    blackShipStage: 0, // 黒船来航の段階（0:未占拠 1:日米和親条約後 2:日米通商修好条約後）
    conqueredRegions, // 地方名 -> 現在その地方を制覇している勢力のrootId（「〇〇地方制覇！！」の重複表示防止用）
    shogunateActive: false, // 江戸幕府（徳川家）が現在開かれているか
    shogunNumber: 0, // 何代目の将軍まで開かれたか（0〜15。15で打ち止め）
    shogunateCheckEra: 0, // 何回目の「16.3日単位」まで再興判定を行ったか（tokugawa.js参照）
    tokugawaOriginalStats: null, // 江戸(東京)・尾張(愛知)・紀州(和歌山)・水戸(茨城)の、幕府が開かれる前の元の名前・能力値のスナップショット
    tokugawaCapitalId: null, // 現在の徳川家の主国のid（開府時は東京。江戸が落ちて藩が継いだ場合はその藩のidに変わる。null=徳川家が存在しない）
    tokugawaPendingMassIndependence: false, // 継ぐ藩がおらず旧属国がそれぞれ独立した直後か（滅亡バナーの白文字用の一時フラグ。tokugawa.js参照）
    tokugawaFinalDefeated: false, // 15代目（最終）の江戸幕府を滅ぼした状態か（true クリア演出の条件）
    kuniGaeMode: false, // お国替えモード（開始画面で選択。デフォルトOFF）。ONのときだけkunigae.js全体が動く
    everConqueredRegionsBy: {}, // rootId -> Set(regionName)。その勢力がこれまでに一度でも制覇したことのある地方（お国替え解禁のトリガー判定に使う。kunigae.js参照）
    pendingKuniGae: {}, // rootId -> true。地方を新規制覇した直後、その主国の次の1回の行動選択だけお国替えを提示するための一時フラグ（kunigae.js参照）
  };
}

function pushLog(state, message) {
  state.log.unshift({ time: state.simTime, message });
  if (state.log.length > 200) state.log.length = 200;
}

// オソロシア侵攻・UFO襲来のときにタイムラインを自動停止するか。
// 自動モード：全スピードで設定に従う。手動モード：5x・10xのときだけ設定に従い、それ未満は常に停止する。
const FAST_SPEED_THRESHOLD = 5;

function shouldPauseOnInvasion(state) {
  if (state.mode === 'auto') return state.pauseOnInvasion;
  return state.speed >= FAST_SPEED_THRESHOLD ? state.pauseOnInvasion : true;
}
