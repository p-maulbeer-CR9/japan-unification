/*
 * gunma.js
 * 群馬県の「グンマー化」。
 * ・発動条件：①群馬が関東地方を制覇したとき ②1,000日を経過するごと。どちらも確率50%で、一度なったら戻らない。
 *   ただし群馬の主国が群馬自身のとき（他の勢力の属国になっていないとき）だけ。属国のときは抽選もしない。
 * ・お国替えモード中、群馬という「土地」に元々の群馬の「中身」がいないとき（お国替えでよそへ移ってしまったとき）は、
 *   関東制覇・1,000日経過のどちらでもグンマー化しない（抽選自体しない）。秘境である群馬県という土地と群馬県民の
 *   組み合わせでしか起きない現象という位置づけ。後でお国替えにより中身が群馬に戻ってくれば、また判定対象になる。
 * ・グンマー化すると、県名が「グンマー」になり、グンマーが主国の勢力（グンマー自身と、主国をグンマーとする属国）の全県が
 *   攻撃力+1・素早さ+1（素早さは加算しても10が上限）になる。グンマーが他の勢力に取られたらボーナスはなくなる（県名は「グンマー」のまま）。色はヒョウ柄（colors.js）。
 * ・グンマーが主国のままお国替えで群馬の土地を離れると、「秘境から離れ、グンマーは力を失った。」となり、
 *   グンマー化が解けて県名も群馬県に戻る（revertGunmaByKuniGae。後で条件が揃えばまたグンマー化しうる）。
 * 発動条件や強さを変えたくなったら、このファイルの定数だけ見れば完結するようにしている。
 */

const GUNMA_ID = '群馬';
const GUNMA_NAME = 'グンマー';
const GUNMA_CHANCE = 0.5;
const GUNMA_ERA_DAYS = 1000;
const GUNMA_ATTACK_BONUS = 1;
const GUNMA_SPEED_BONUS = 1;
const MAX_SPEED = 10;

// id がグンマー勢力（グンマー化した群馬が主国の勢力。グンマー自身と、主国をグンマーとする属国）の一員か。
// グンマーが他の勢力に取られている間は、誰にもボーナスは付かない。
// 群馬の土地にグンマーの中身がいないとき（取られている間にお国替えでよそへ移された等）は、群馬の土地が主国でも対象外。
function isGunmaFaction(state, id) {
  return !!state.gunmaified && factionRoot(state, id) === GUNMA_ID && state.prefs[GUNMA_ID].originId === GUNMA_ID;
}

// お国替えで、グンマー勢力の主国（群馬の土地にいるグンマー）が秘境を離れる場合に呼ぶ。
// グンマー化を解いて県名を元に戻す（条件が揃えば、後でまたグンマー化の抽選対象になる）。
// 戻り値: バナー下の白文字に添える文言
function revertGunmaByKuniGae(state) {
  const slot = findSlotByOriginId(state, GUNMA_ID);
  const original = PREFECTURES.find((p) => p.id === GUNMA_ID);
  state.gunmaified = false;
  state.prefs[slot].name = original.name;
  const note = `秘境から離れ、${GUNMA_NAME}は力を失った。`;
  pushLog(state, `🐆 ${note}${GUNMA_NAME}は${original.name}に戻った`);
  return note;
}

function gunmaAttackBonus(state, id) {
  return isGunmaFaction(state, id) ? GUNMA_ATTACK_BONUS : 0;
}

// 素早さ（基本値 + グンマー化ボーナス + 徳川ボーナス。上限10）。行動間隔の計算と表示にはこちらを使う。
// グンマーと徳川は主国が別なので同時に両方付くことはないが、合算しておいても安全。
function effectiveSpeed(state, id) {
  const bonus = (isGunmaFaction(state, id) ? GUNMA_SPEED_BONUS : 0) + tokugawaSpeedBonus(state, id);
  return Math.min(MAX_SPEED, state.prefs[id].baseSpd + bonus);
}

// 条件を満たしたときに呼ぶ。50%の抽選に通ればグンマー化する。実際にグンマー化したら true。
function tryGunmaify(state, reason) {
  if (state.gunmaified) return false;
  if (factionRoot(state, GUNMA_ID) !== GUNMA_ID) return false; // 群馬が他の勢力の属国になっているときはグンマー化しない（抽選もしない）
  if (state.prefs[GUNMA_ID].originId !== GUNMA_ID) return false; // お国替えで群馬の中身がよそへ移っている間は判定しない
  if (Math.random() >= GUNMA_CHANCE) return false;
  const oldName = state.prefs[GUNMA_ID].name;
  state.gunmaified = true;
  pushLog(state, `🐆 ${oldName}がグンマー化した！（${reason}）勢力の県は攻撃力+${GUNMA_ATTACK_BONUS}・素早さ+${GUNMA_SPEED_BONUS}`);
  state.prefs[GUNMA_ID].name = GUNMA_NAME;

  // 侵略イベントと同じ大きなバナー。見出しの上には戦闘メッセージ（設定のONのときだけ）を出す
  const pause = shouldPauseOnInvasion(state);
  state.worldEvent = {
    headline: `${oldName}がグンマー化！！`,
    notes: [`突然${oldName}がグンマー化した`], // 見出しの下の白文字バナー
    quip: state.showBattleQuips ? `おや！？${oldName}の様子が……` : null,
    time: state.simTime,
    paused: pause,
  };
  if (pause) state.running = false; // 画面側の検知を待たず、ここで即座に一時停止する
  return true;
}

// 1,000日を超えるたびに1回ずつ抽選する（tick の中で毎フレーム呼ぶ）
function checkGunmaEra(state) {
  const era = Math.floor(state.simTime / GUNMA_ERA_DAYS);
  while (state.gunmaCheckEra < era) {
    state.gunmaCheckEra += 1;
    tryGunmaify(state, `${state.gunmaCheckEra * GUNMA_ERA_DAYS}日経過`);
  }
}
