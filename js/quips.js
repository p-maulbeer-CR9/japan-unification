/*
 * quips.js
 * 戦闘メッセージ（県同士のやり取りをひとことで表すセリフ）の台帳。
 * プレイヤーの勢力が絡む戦闘のとき、勝敗バナーの上に表示する（設定の⚙でON/OFF）。
 * メッセージを増やしたい場合は、quips-input.txt に書いてから取り込む（このファイルは取り込み時に自動生成される）。
 *
 * 2種類の台帳がある。
 *  ・BATTLE_QUIPS（隣接関係メッセージ）: キーは「攻撃側の県ID>防御側の県ID」、値は攻撃側から見た
 *    結果（win/draw/lose）ごとのメッセージ配列。この組み合わせに固有のセリフ。
 *  ・BASE_ATTACK_QUIPS / BASE_DEFENSE_QUIPS（基本メッセージ）: キーは県ID、値は結果ごとのメッセージ配列。
 *    相手を問わない、その県固有のセリフ。BASE_ATTACK_QUIPS はその県が攻撃したとき（攻撃側から見た結果）、
 *    BASE_DEFENSE_QUIPS はその県が攻撃されたとき（防御側から見た結果＝勝ち=防衛成功）に使う。
 * どの台帳も、配列に複数入れるとその中からランダムに1つ選ぶ。定義の無い組み合わせ・結果では表示しない。
 *
 * お国替えモードで新たに生まれる隣接パターン専用の追加台帳（KUNIGAE_BATTLE_QUIPS）が
 * quips-kunigae.js にある。セリフは「土地」ではなく「中身（originId）」の組み合わせで引くため、
 * getBattleQuip() はまずattackerId/defenderId（実際の土地＝県ID）からoriginIdを求め、それを使って
 * BATTLE_QUIPS・KUNIGAE_BATTLE_QUIPS・BASE_ATTACK_QUIPS/BASE_DEFENSE_QUIPSを引く
 * （お国替えしていなければoriginId=idなので、今まで通りの挙動になる）。
 *
 * 実際にどちらを表示するかは getBattleQuip() が決める（詳しくは関数コメント参照）。
 */

const BATTLE_QUIPS = {
  '北海道>青森': {
    win: [
      '開拓民の力思い知ったべ！',
    ],
    lose: [
      '内地の民は強いべさ…。',
    ],
  },
  '青森>北海道': {
    lose: [
      '大間のマグロが連れてかれた…',
    ],
  },
  '岩手>青森': {
    win: [
      'めんこいなあ',
    ],
  },
  '岩手>宮城': {
    win: [
      '遠野の妖怪たちが杜の都を占拠…！！',
    ],
    lose: [
      'さすがは東北最大都市…',
    ],
  },
  '宮城>山形': {
    lose: [
      '青葉城がさくらんぼだらけにされた',
    ],
  },
  '秋田>宮城': {
    win: [
      'なまはげ侵攻…泣く子はいねぇがぁ！！',
    ],
  },
  '福島>宮城': {
    win: [
      'ずっとフラダンスを踊らせてくれる！',
    ],
  },
  '福島>栃木': {
    win: [
      'もはや栃木は南東北…！',
    ],
    lose: [
      '白河の関を越えられたか…',
    ],
  },
  '茨城>千葉': {
    win: [
      'かつてない数の暴走族が千葉へ押し寄せた',
    ],
  },
  '栃木>茨城': {
    win: [
      'ごめんねごめんね～！',
    ],
  },
  '埼玉>群馬': {
    lose: [
      '秘境グンマーに入るべからず…',
    ],
  },
  '東京>埼玉': {
    win: [
      '埼玉県民にはそこらへんの草でも食わせておけ！',
    ],
    lose: [
      'くっ…埼玉がうつる…',
    ],
  },
  '神奈川>千葉': {
    lose: [
      '強風でアクアライン閉鎖、久里浜からのフェリーも欠航で攻められず…',
    ],
  },
  '滋賀>京都': {
    win: [
      '琵琶湖の水止めたろか！',
    ],
    lose: [
      '水を止める権利は京都側にあるだと…！？',
    ],
  },
  '京都>滋賀': {
    win: [
      '滋賀は京都の植民地やさかい',
    ],
  },
  '京都>大阪': {
    win: [
      'えらいせっかちやなあ',
    ],
    lose: [
      '大阪と一緒にせんといて！',
    ],
  },
  '京都>奈良': {
    win: [
      '奈良はん、新幹線通ってへんのやろ？',
    ],
  },
  '奈良>三重': {
    win: [
      '東大寺の大仏が伊勢神宮めがけて仏ビーム…！！',
    ],
  },
  '奈良>京都': {
    win: [
      '奈良の方がいにしえの都ぞ！！',
    ],
  },
  '奈良>大阪': {
    win: [
      'シカが大阪のうまいもんを食いだおれ…！！',
    ],
  },
  '和歌山>大阪': {
    win: [
      '梅干しを大量輸出！大阪府民は塩分過多になった',
    ],
  },
  '鳥取>兵庫': {
    win: [
      '砂丘の砂が風に舞い、有馬温泉が砂風呂になった',
      '砂嵐で視界ゼロ！神戸の夜景が全く見えなくなった…',
    ],
    lose: [
      '神戸のオシャレさに目がくらみ、撤退…',
    ],
  },
  '鳥取>島根': {
    win: [
      'ラクダの大群が出雲大社を制圧！ラクダ神話が始まる',
    ],
    lose: [
      'いつも島根に間違えられる…',
    ],
  },
  '鳥取>岡山': {
    win: [
      '鳥取の曇りや雨の多さが岡山にも伝搬！さよなら晴れの国…',
    ],
    lose: [
      '桃太郎を生んだ勇者の国！さすが山陽…山陰では勝てないのか…？',
      'いつも晴れやがって…',
    ],
  },
  '島根>鳥取': {
    win: [
      '合併し島根県となった過去を再現しよう',
    ],
    lose: [
      '人口最少県に負けるとは…',
    ],
  },
  '岡山>兵庫': {
    win: [
      '白鷺城が烏城のように真っ黒になった…',
    ],
  },
  '岡山>鳥取': {
    win: [
      'きびだんごで白うさぎとサメとラクダをお供にした',
    ],
    lose: [
      'きびだんごに砂が混じってジャリっとする…',
    ],
  },
  '岡山>広島': {
    win: [
      '赤鬼がカープとの赤色対決を制した',
    ],
  },
  '広島>愛媛': {
    win: [
      '造船して呉に船を納めろ！！',
    ],
  },
  '山口>福岡': {
    win: [
      'ふぐ毒を豚骨スープに紛れ込ました…',
    ],
  },
  '香川>兵庫': {
    win: [
      '鳴門の渦潮に沈めてくれる…！！',
    ],
  },
  '愛媛>広島': {
    win: [
      'しまなみ海道から大量の闘牛が突っ込んできた…！！',
    ],
  },
  '愛媛>高知': {
    win: [
      '柑橘といえば、高知の柚子より愛媛のみかん！！',
    ],
  },
  '高知>徳島': {
    win: [
      '闘犬が群れをなして襲いかかる！！',
    ],
  },
  '沖縄>鹿児島': {
    win: [
      '黒豚を全部ミミガーと豚足とラフテーにした',
    ],
    lose: [
      'なんくるないさ～',
    ],
  },
};

// 県ごとの基本メッセージ（攻撃したとき／攻撃されたとき）。キーは県ID、値は結果ごとのメッセージ配列。
// quips-input.txt の「■県名（攻撃）」「■県名（防御）」セクションから取り込む。
const BASE_ATTACK_QUIPS = {
  '青森': {
    win: [
      'りんご型爆弾投下…！！アポーン！！（爆発音）',
      'イタコのチャネリングでご家族から恥ずかしい過去を教えてもらい広めるぞ',
    ],
  },
  '栃木': {
    win: [
      'ごめんねごめんね～！',
      '雷で攻撃…！！',
    ],
  },
};

const BASE_DEFENSE_QUIPS = {
};

// result（'win'|'draw'|'lose'）を反対の立場から見た結果に変換する（勝ち⇔負け、引き分けはそのまま）。
function flipResult(result) {
  if (result === 'win') return 'lose';
  if (result === 'lose') return 'win';
  return result;
}

function pickRandom(list) {
  if (!list || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// 隣接関係メッセージ（攻撃側から見た result のセリフ。防御側視点で使う場合も同じキーを引く）。
// attackerId/defenderId はここでは既にoriginId（中身）に解決済みのものを渡す（getBattleQuip参照）。
// 通常の台帳（BATTLE_QUIPS）に無ければ、お国替え専用の台帳（KUNIGAE_BATTLE_QUIPS、quips-kunigae.js）を見る。
function adjacentQuip(attackerId, defenderId, result) {
  const key = `${attackerId}>${defenderId}`;
  const entry = BATTLE_QUIPS[key] || KUNIGAE_BATTLE_QUIPS[key];
  return pickRandom(entry && entry[result]);
}

// 隣接関係メッセージを優先する確率（残りは基本メッセージを優先）
const ADJACENT_QUIP_PRIORITY = 0.75;

// attackerId が defenderId に挑んだ結果（result: 'win'|'draw'|'lose'、攻撃側から見た結果）に対する
// 戦闘メッセージを1つ選んで返す。無ければ null。
// attackerId/defenderId は実際に戦った県（土地＝state.prefsのキー）。セリフは中身（originId）に
// 紐づくため、まずoriginIdに解決してから各台帳を引く（お国替えしていなければoriginId=idなので、
// 今まで通りの挙動になる）。
//
// speakerIsAttacker で「誰のセリフとして選ぶか」を切り替える（バナーは自分の勢力視点で表示するため）。
//  ・true（自分が攻撃側）: 基本メッセージは BASE_ATTACK_QUIPS[攻撃側のoriginId]、結果は result そのまま。
//  ・false（自分が防御側）: 基本メッセージは BASE_DEFENSE_QUIPS[防御側のoriginId]、結果は result を反転
//    （attackerIdが勝ち＝防御側は負け、など）したもの。
// 隣接関係メッセージは向き（攻撃側のoriginId>防御側のoriginId）と result 固定で、どちらの立場でも同じものを参照する。
//
// 決め方: 隣接関係メッセージ（通常＋お国替え専用の2台帳）を75%、基本メッセージを25%の確率で優先する。
// 優先された方にその結果のセリフが無ければ、もう片方にあればそちらを使う。どちらにも無ければ null（表示しない）。
// 防御側に（防御）のセリフが無いときに（攻撃）のセリフで代用することはしない（攻撃側も同様）。
function getBattleQuip(state, attackerId, defenderId, result, speakerIsAttacker = true) {
  const attackerOriginId = state.prefs[attackerId].originId;
  const defenderOriginId = state.prefs[defenderId].originId;
  const speakerId = speakerIsAttacker ? attackerOriginId : defenderOriginId;
  const speakerResult = speakerIsAttacker ? result : flipResult(result);
  const baseQuips = speakerIsAttacker ? BASE_ATTACK_QUIPS : BASE_DEFENSE_QUIPS;
  const baseMsg = pickRandom(baseQuips[speakerId] && baseQuips[speakerId][speakerResult]);
  const adjMsg = adjacentQuip(attackerOriginId, defenderOriginId, result);

  const preferAdjacent = Math.random() < ADJACENT_QUIP_PRIORITY;
  const msg = preferAdjacent ? (adjMsg || baseMsg) : (baseMsg || adjMsg);
  return msg || null;
}
