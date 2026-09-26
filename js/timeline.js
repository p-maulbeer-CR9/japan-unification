/*
 * timeline.js
 * 連続時間タイムラインの進行・ターン処理（仕様18〜22章）。
 * 「誰が行動を決めるか（プレイヤー / AI）」の切り替えのみをここで行い、
 * 実際の戦闘解決は combat.js、行動決定は ai.js に委譲する。
 */

function baseInterval(spd) {
  return BASE_TIME_UNIT / spd;
}

function getPlayerFactionRoot(state) {
  if (!state.playerPrefId) return null;
  // 徳川家を操作している間は、主国が江戸から尾張・紀州・水戸に移っても徳川家の主国がプレイヤー
  if (state.playerTokugawa) return state.shogunateActive ? state.tokugawaCapitalId : null;
  if (state.playerDefeated) return null;
  return state.playerPrefId;
}

// targetId が落ちるとプレイヤーの本拠地陥落になるか。徳川家を操作している間は、江戸が落ちても
// 藩が主国を継げば操作は続く（徳川家そのものの滅亡は checkTokugawaWipeout で扱う）ので対象外。
function isPlayerHome(state, targetId) {
  return targetId === state.playerPrefId && !state.playerTokugawa;
}

function isPlayerControlled(state, prefId) {
  const root = getPlayerFactionRoot(state);
  return root !== null && state.mode === 'manual' && factionRoot(state, prefId) === root;
}

// 判定は必ず47都道府県だけを基準にする（オソロシア・宇宙人など特殊勢力自体は数えない。
// それらが都道府県を支配している間は、その都道府県の帰属先として結果に反映される）
function checkGameClear(state) {
  if (state.winnerRootId) return;
  const roots = new Set(getAllPrefIds(state).map((id) => factionRoot(state, id)));
  if (roots.size === 1) {
    // 最後の1県で地方制覇と日本一統が同時に成立した場合、ログには地方制覇を先に、日本一統をその後に書く
    checkRegionConquests(state);
    state.winnerRootId = [...roots][0];
    state.running = false;
    const winnerName = factionDisplayName(state, state.winnerRootId);
    if (isBadEnding(state)) {
      pushLog(state, `💀 ${winnerName}が日本一統を達成した`);
    } else {
      pushLog(state, `🎉 ${winnerName}が日本一統を達成した！！`);
    }
  }
}

// オソロシア・宇宙人・メリケン・徳川家による日本一統はバッドエンド（プレイヤー自身が徳川家を率いていた場合も含む）
function isBadEnding(state) {
  const winner = state.winnerRootId;
  if (!winner) return false;
  return [OSOROSHIA_ID, ALIEN_ID, BLACKSHIP_ID].includes(winner) || isCurrentTokugawaCapital(state, winner);
}

// 地方（東北・関東…）がすべて同じ勢力に支配されたら、それがプレイヤー自身の勢力の場合だけ
// 「〇〇地方を制覇！！」を表示する（他勢力の地方制覇は表示しない）。
// 同じ勢力が持ち続けている間は再表示せず、他勢力に一度でも奪われて改めて統一された場合に再度表示する。
function checkRegionConquests(state) {
  const playerRoot = getPlayerFactionRoot(state);
  Object.keys(REGIONS).forEach((regionName) => {
    // 県数が1つしかない地方（北海道地方）は開始時点から「制覇済み」なので、createInitialState で
    // 初期値を記録済み。開始直後には表示されず、一度失ってから取り戻した／他県を従えて奪った場合に表示される。
    // 出現済みの離島（佐渡=中部・淡路=近畿・隠岐=中国・対馬=九州）も、その地方の制覇条件に含める。
    const prefIds = getRegionMembers(state, regionName);
    const roots = new Set(prefIds.map((id) => factionRoot(state, id)));
    if (roots.size === 1) {
      const rootId = [...roots][0];
      if (state.conqueredRegions[regionName] !== rootId) {
        state.conqueredRegions[regionName] = rootId;

        if (rootId === playerRoot) {
          pushLog(state, `🏯 ${regionName}を制覇した！！`);
          // 他の侵略イベント等と同様、「特殊イベントで自動停止」の設定に従う（OFF時は止めずバナーだけ短く出す）
          const pause = shouldPauseOnInvasion(state);
          state.worldEvent = { headline: `${regionName}を制覇！！`, time: state.simTime, paused: pause };
          if (pause) state.running = false; // 画面側の検知を待たず、ここで即座に一時停止する
        }
        // お国替えモード中は、勢力（プレイヤーに限らずどの勢力でも）として初めてこの地方を制覇したら、
        // その主国の次の1回の行動選択だけお国替えを提示する（kunigae.js参照）
        markRegionMilestoneForKuniGae(state, rootId, regionName);
        // 制覇バナーの後に判定して、グンマー化した場合はそちらのバナーを優先する
        if (regionName === '関東地方' && rootId === GUNMA_ID) tryGunmaify(state, '群馬の関東地方制覇');
      }
    } else {
      delete state.conqueredRegions[regionName];
    }
  });
}

// プレイヤーの本拠地が一度陥落した後も、他勢力同士の戦闘で旧主国が新たに敗北し、
// appointSuccessor（仕様16章）によってプレイヤーの本拠地が後継の新主国として
// 選ばれ直すことがある。その場合は再び独立＝主国に戻るので、プレイヤー操作を復活させる。
// notes は、返り咲きのきっかけとなった戦闘の結果（「〇〇は〇〇勢力の属国になった」「〇〇の旧属国は〇〇を新主国として独立」）。
// 東京で始めたプレイヤーは、幕府が続いている間（中身が「江戸」のまま）は返り咲かない。江戸が徳川家とは別に
// 独立して主国になっても、中身は徳川家ではなく、東京都の名前に戻るまで返り咲かせない（プレイヤーが主国を
// 2つ持つことも防ぐ）。徳川家として戻れるのは、もう一度江戸幕府が開かれたときだけ（openShogunate参照）。
// options.queue=true なら、直前に出した世界イベント（江戸幕府滅亡など）を上書きせず、その次に表示する。
function checkPlayerComeback(state, notes, options = {}) {
  if (!state.playerDefeated || !state.playerPrefId || state.playerTokugawa) return;
  if (state.shogunateActive && state.prefs[state.playerPrefId].originId === EDO_ORIGIN_ID) return;
  if (factionRoot(state, state.playerPrefId) === state.playerPrefId) {
    state.playerDefeated = false;
    // 前の主国の属国を引き継いで返り咲いた場合は、その顔ぶれもログ・バナーに添える
    const vassals = getVassalsOf(state, state.playerPrefId);
    const vassalText = vassals.length > 0 ? `（${vassals.map((id) => state.prefs[id].name).join('・')}を従えた）` : '';
    pushLog(state, `👑 ${state.prefs[state.playerPrefId].name}が新たな主国として返り咲いた！${vassalText}プレイヤーの操作が復活した`);
    // 侵略イベントと同様、バナーを出してタイムラインを一旦止める（タップで再開）。戦闘の結果は見出しの下に添える。
    // 他の侵略イベント等と同様、「特殊イベントで自動停止」の設定に従う（OFF時は止めずバナーだけ短く出す）
    const pause = shouldPauseOnInvasion(state);
    const allNotes = (notes || []).concat(vassals.length > 0 ? ['属国を従えて返り咲いた'] : []);
    const event = {
      headline: `${state.prefs[state.playerPrefId].name}が返り咲いた！！`,
      notes: allNotes.length > 0 ? allNotes : null,
      time: state.simTime,
      paused: pause,
    };
    // キューは一時停止中のバナーを閉じたときにだけ進むので、止まっていないバナーの後には積まない
    if (options.queue && state.worldEvent && state.worldEvent.paused) {
      state.worldEventQueue.push(event);
    } else {
      state.worldEvent = event;
      if (pause) state.running = false;
    }
  }
}

// 実際に行動を確定させる（AIからでもプレイヤー入力からでも、この関数を通す）
function resolveTurnAction(state, prefId, action) {
  const p = state.prefs[prefId];
  let battleNotes = null; // このターンの戦闘結果（属国化／新主国独立）。返り咲きバナーに添える

  if (action.type === 'charge') {
    p.charged = true;
    const chargeDefText = isTokugawaFaction(state, prefId) ? `・守備力+${TOKUGAWA_CHARGE_DEF_BONUS}` : '';
    pushLog(state, `${p.name} は力を蓄えた（次の攻撃で攻撃力+${chargeBonusOf(state, prefId)}${chargeDefText}）`);
    state.lastBattle = null;
  } else if (action.type === 'kunigae') {
    executeKuniGae(state, action.slotA, action.slotB);
    // 主国自身は「お国替え」という行動で手番を使ったので、力を蓄えた状態は解除する。
    // 対象2県自身の分はexecuteKuniGae内で既に解除済み。
    p.charged = false;
    state.lastBattle = null;
  } else if (action.type === 'attack') {
    const targetId = action.targetId;
    if (!canAttack(state, prefId, targetId)) {
      // 不正な対象が来た場合は安全側として力を蓄える扱いにする
      p.charged = true;
      pushLog(state, `${p.name} は攻撃対象が無効なため力を蓄えた`);
    } else {
      const before = { attacker: state.prefs[prefId].name, defender: state.prefs[targetId].name };
      const playerRoot = getPlayerFactionRoot(state);
      const attackerRootBefore = factionRoot(state, prefId);
      const defenderRootBefore = factionRoot(state, targetId);
      const attackerSovereignBefore = getSovereignName(state, prefId);
      const defenderSovereignBefore = getSovereignName(state, targetId);

      // resolveCombat内でcharged等が変化する前に内訳を控えておく
      const atkTermsBefore = attackTerms(state, prefId);
      const defTermsBefore = defenseTerms(state, targetId, ISLAND_IDS.includes(prefId));

      const res = resolveCombat(state, prefId, targetId);
      const defenderName = state.prefs[targetId].name;
      let msg = '';
      if (res.accumulatedBonus) {
        msg += `💥 ${before.attacker} 蓄積ダメージ！！（${before.defender}に5連続未勝利・攻撃力+${ACCUMULATED_DRAW_BONUS}） `;
      }
      if (res.desperation) {
        msg += `🐭 ${before.attacker} キュウソネコカミ！！（攻撃力+${DESPERATION_BONUS}） `;
      } else if (res.desperationEligible) {
        msg += `🐭 ${before.attacker} キュウソネコカミ発動ならず… `;
      }
      const atkStr = formatBreakdown([
        ...atkTermsBefore,
        { value: res.accumulatedBonus ? ACCUMULATED_DRAW_BONUS : 0, label: '蓄積ダメージ' },
        { value: res.blackShipBonus || 0, label: 'メリケン勢力' },
        { value: res.tokugawaBonus || 0, label: '徳川家' },
        { value: res.desperation ? DESPERATION_BONUS : 0, label: 'キュウソネコカミ' },
      ], res.atk);
      const defStr = formatBreakdown(defTermsBefore, res.def);
      if (res.result === 'win') {
        msg += `⚔ ${before.attacker}(攻撃力 ${atkStr}) が ${before.defender}(守備力 ${defStr}) に勝利！ ${defenderName}は${factionDisplayName(state, factionRoot(state, prefId))}勢力の属国になった`;
      } else if (res.result === 'draw') {
        msg += `⚔ ${before.attacker}(攻撃力 ${atkStr}) と ${before.defender}(守備力 ${defStr}) は引き分け`;
      } else {
        msg += `⚔ ${before.attacker}(攻撃力 ${atkStr}) は ${before.defender}(守備力 ${defStr}) に敗北。${before.attacker}は一時的に守備力-1`;
      }
      if (res.successorId) {
        // 徳川家の主国を藩が継いだ場合（resolveTokugawaSuccessionが既にtokugawaCapitalIdを書き換え済み）は
        // 「独立」ではなく「幕府を継続」と表記する
        const tail = state.tokugawaCapitalId === res.successorId ? '幕府を継続' : '独立';
        msg += ` ／ ${before.defender}の旧属国は ${state.prefs[res.successorId].name} を新主国として${tail}`;
      }
      msg += describeAbsorbedVassals(state, res.absorbedVassals);
      if (res.tokugawaMassIndependence && res.tokugawaMassIndependence.length > 0) {
        // 徳川家が完全に消滅する瞬間：継ぐ藩がいなかった旧属国は、1つにまとめず、それぞれ個別に独立する
        const names = res.tokugawaMassIndependence.map((id) => state.prefs[id].name).join('・');
        msg += ` ／ 旧属国の${names}はそれぞれ独立した`;
      }
      // ログだけでなく、地図前面のトースト表示にも小さく載せる
      const vassalNote = res.result === 'win'
        ? `${before.defender}は${factionDisplayName(state, factionRoot(state, prefId))}勢力の属国になった`
        : null;
      const successorNote = res.successorId
        ? `${before.defender}の旧属国は${state.prefs[res.successorId].name}を新主国として${state.tokugawaCapitalId === res.successorId ? '幕府を継続' : '独立'}`
        : null;
      battleNotes = [vassalNote, successorNote].filter(Boolean);
      if (res.result === 'win' && isPlayerHome(state, targetId)) {
        state.playerDefeated = true;
        msg += `（プレイヤーの本拠地が陥落。以後この勢力はAIが操作する）`;
      }
      pushLog(state, msg);

      // プレイヤーの勢力が絡む戦闘（自分から挑んだ／自分が攻められた）は、
      // 画面前面に大きく表示する（文言は攻撃側視点で客観的に、色分けだけプレイヤー視点にする）
      let playerBanner = null;
      if (playerRoot !== null && (attackerRootBefore === playerRoot || defenderRootBefore === playerRoot)) {
        const playerIsAttacker = attackerRootBefore === playerRoot;
        let playerOutcome;
        if (res.result === 'draw') {
          playerOutcome = 'draw';
        } else if (playerIsAttacker) {
          playerOutcome = res.result === 'win' ? 'win' : 'lose';
        } else {
          // 自分が防御側の場合、相手(攻撃側)が勝てば自分の敗北、相手が負ければ自分の勝利（防衛成功）
          playerOutcome = res.result === 'win' ? 'lose' : 'win';
        }
        // 勝敗バナーの下にもう一段、属国化／独立の結果を1行の小さなバナーで添える
        const note = [vassalNote, successorNote].filter(Boolean).join(' ／ ');
        playerBanner = {
          selfName: playerIsAttacker ? before.attacker : before.defender,
          selfSovereign: playerIsAttacker ? attackerSovereignBefore : defenderSovereignBefore,
          opponentName: playerIsAttacker ? before.defender : before.attacker,
          opponentSovereign: playerIsAttacker ? defenderSovereignBefore : attackerSovereignBefore,
          playerWasAttacker: playerIsAttacker,
          playerOutcome,
          desperation: res.desperation,
          accumulatedBonus: res.accumulatedBonus,
          note: note || null,
          quip: state.showBattleQuips ? getBattleQuip(state, prefId, targetId, res.result, playerIsAttacker) : null,
        };
      }

      state.lastBattle = {
        ...res, attackerName: before.attacker, defenderName: before.defender, time: state.simTime, playerBanner,
      };

      // 画面側の検知（次のrequestAnimationFrame）を待つと、その間にtick()が先に次のターンを
      // 進めてバナーが上書きされてしまうことがあるため、ここで即座に一時停止する
      // （「自勢力の戦闘結果で一時停止」がOFFのときは、自動A/Bでの観察を妨げないよう止めない）
      if (playerBanner && state.pauseOnPlayerBattle) {
        state.running = false;
      }
    }
  }

  p.nextActionTime = state.simTime + baseInterval(effectiveSpeed(state, prefId));

  // 江戸（東京）が攻め落とされて徳川家が全滅していないかを、日本一統判定より先に確認する
  // （15代目を全滅させたのと同じ戦闘で日本一統が成立した場合に、真クリアの判定が間に合うようにするため）
  checkTokugawaWipeout(state);
  checkGameClear(state);

  // 通常ターンが1回完了するごとに、オソロシア／宇宙人の襲来判定を行う
  processInvaderEvents(state);

  // 通常の戦闘・侵略イベントいずれでも所属が変わりうるので、最後にまとめて地方制覇を判定する
  checkRegionConquests(state);

  // 同様に、プレイヤーの本拠地が返り咲いていないかもここでまとめて判定する
  checkPlayerComeback(state, battleNotes);
}

// prefId のターンを開始する。プレイヤー入力待ちが必要なら true を返し、呼び出し側は処理を止める。
function startTurn(state, prefId) {
  const p = state.prefs[prefId];
  p.recentlyDefeated = false; // 自分の番が来た時点で敗北ペナルティは解除（仕様13章）

  // お国替えモード：主国の手番が来た瞬間に、今回提示すべきか（地方を新規制覇した直後の1回だけ）を必ず消費する。
  // 提示対象があれば{left,right}、無ければnull（自動操作B中でも、この手番で無条件に消費させる）
  const kuniGaeOffer = consumeKuniGaeOffer(state, prefId);

  if (isPlayerControlled(state, prefId)) {
    // 自動操作A/B（⚙の設定）中は、行動選択画面を出さず自動で行動を決める
    if (state.operationMode === 'autoB') {
      resolveTurnAction(state, prefId, { type: 'charge' });
      return false;
    }
    if (state.operationMode === 'autoA') {
      resolveTurnAction(state, prefId, decideAutoAction(state, prefId, kuniGaeOffer));
      return false;
    }

    const candidates = getAdjacentEnemyTargets(state, prefId);
    if (candidates.length === 0 && !kuniGaeOffer) {
      // 攻撃可能な隣接県が無く、お国替えの提示も無く、力を蓄えるしかできない場合は選択画面を出さず自動で力を蓄える
      resolveTurnAction(state, prefId, { type: 'charge' });
      return false;
    }
    state.pendingPlayerDecision = { prefId, candidates, kuniGaeOffer };
    return true;
  }

  const action = decideAutoAction(state, prefId, kuniGaeOffer);
  resolveTurnAction(state, prefId, action);
  return false;
}

// UIから呼ばれる。プレイヤーの選択を確定させてタイムラインを再開できる状態にする。
function submitPlayerAction(state, action) {
  if (!state.pendingPlayerDecision) return;
  const { prefId } = state.pendingPlayerDecision;
  state.pendingPlayerDecision = null;
  resolveTurnAction(state, prefId, action);
}

// 1フレーム分タイムラインを進める。deltaSeconds は実時間の経過秒数。
function tick(state, deltaSeconds) {
  if (!state.running || state.pendingPlayerDecision || state.pendingTokugawaChoice || state.winnerRootId) return;

  state.simTime += deltaSeconds * state.speed;
  const worldEventBefore = state.worldEvent;
  checkGunmaEra(state); // 1,000日を超えるごとにグンマー化の抽選
  checkShogunateEra(state); // 1603日目以降、徳川不在の間は16.3日ごとに江戸幕府再興の抽選
  if (state.worldEvent !== worldEventBefore) return; // バナーを先に表示させる

  // 安全のため1フレームで処理するターン数に上限を設ける（高速再生時のフリーズ防止）
  let guard = 0;
  while (guard < 500) {
    guard += 1;
    const due = Object.values(state.prefs)
      .filter((p) => p.nextActionTime <= state.simTime)
      .sort((a, b) => a.nextActionTime - b.nextActionTime)[0];

    if (!due) break;

    const paused = startTurn(state, due.id);
    // プレイヤー絡みの戦闘バナーや世界イベントが出た場合は、上書きされる前に必ずこのフレームで表示させる
    if (paused || state.winnerRootId || (state.lastBattle && state.lastBattle.playerBanner) || state.worldEvent !== worldEventBefore) break;
  }
}
