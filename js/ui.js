/*
 * ui.js
 * サイドパネル・タイムライン表示・各種モーダルのDOM描画。
 * ゲームロジック（timeline.js等）は直接呼ばず、main.js経由でstateとコールバックを受け取る。
 */

const UI = (() => {
  let onSelectPref = null;
  let onSubmitAction = null;
  let onCloseDecision = null;
  let onReopenDecision = null;

  // 値が変わった時だけDOMに書く（毎フレームの無駄な書き込みは、iPhone Safariでタップの取りこぼしを招くため）
  function setTextIfChanged(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function statusLabel(state, id) {
    const p = state.prefs[id];
    if (p.sovereignId === null) {
      if (getVassalsOf(state, id).length === 0) return '独立県';
      // 徳川家の現在の主国は、地名（江戸・尾張など）と勢力名（徳川家）が違うので明記する
      return isCurrentTokugawaCapital(state, id) ? `主国: ${TOKUGAWA_FACTION_NAME}` : '主国';
    }
    return `属国（主国: ${factionDisplayName(state, p.sovereignId)}）`;
  }

  // 県情報パネルは毎フレーム呼ばれるが、内容（構造）が変わっていない限りDOMを作り直さない。
  // innerHTMLを毎フレーム作り直すと、タップの最中に要素ごと差し替わってしまい、
  // スマホでタップしたのにクリックが発火しない（＝反応しない）不具合につながるため。
  // 唯一「次回行動まで」の残り日数だけは常に動くので、そこだけ要素を壊さず数値だけ更新する。
  let lastPrefInfoSignature = null;

  function prefInfoSignature(state, id) {
    const p = state.prefs[id];
    const vassals = getVassalsOf(state, id);
    return [
      id,
      effectiveAttack(state, id),
      effectiveDefense(state, id),
      p.charged,
      p.recentlyDefeated,
      factionRoot(state, id),
      vassals.join(','),
      invaderHasTerritory(state, OSOROSHIA_ID),
      invaderHasTerritory(state, ALIEN_ID),
      p.name,
      effectiveSpeed(state, id),
      state.gunmaified,
      state.shogunateActive,
    ].join('|');
  }

  // 実効攻撃力の表示用。メリケン勢力は攻撃のたびに+1か+2、徳川勢力は+1〜3が乗るので範囲で出す
  function attackText(state, id) {
    const eff = effectiveAttack(state, id);
    if (factionRoot(state, id) === BLACKSHIP_ID) return `${eff + 1}〜${eff + 2}`;
    if (isTokugawaFaction(state, id)) return `${eff + TOKUGAWA_ATTACK_BONUS_MIN}〜${eff + TOKUGAWA_ATTACK_BONUS_MAX}`;
    return `${eff}`;
  }

  function remainingText(state, id) {
    const remaining = Math.max(0, state.prefs[id].nextActionTime - state.simTime);
    return Number.isFinite(remaining) ? `${remaining.toFixed(1)}日` : '－（このタイムラインには乗らない）';
  }

  function renderPrefInfo(state, id) {
    const signature = prefInfoSignature(state, id);
    if (signature === lastPrefInfoSignature) {
      const el = document.getElementById('pref-remaining-value');
      if (el) setTextIfChanged('pref-remaining-value', remainingText(state, id));
      return;
    }
    lastPrefInfoSignature = signature;

    const p = state.prefs[id];
    const root = factionRoot(state, id);
    const vassals = getVassalsOf(state, id);

    let html = '';
    html += `<div class="info-title">${p.name}</div>`;
    html += `<div class="info-sub">${statusLabel(state, id)}</div>`;

    html += `<div class="stat-row"><span>攻撃力（実効）</span><span>${p.baseAtk} → ${attackText(state, id)}</span></div>`;
    html += `<div class="stat-row"><span>守備力（実効）</span><span>${p.baseDef} → ${effectiveDefense(state, id)}</span></div>`;
    html += `<div class="stat-row"><span>素早さ</span><span>${p.baseSpd}${effectiveSpeed(state, id) !== p.baseSpd ? ` → ${effectiveSpeed(state, id)}` : ''}</span></div>`;
    html += `<div class="stat-row"><span>次回行動まで</span><span id="pref-remaining-value">${remainingText(state, id)}</span></div>`;

    const factionBonus = countAdjacentFactionMembers(state, id);

    html += '<div style="margin-top:6px; display:flex; flex-direction:column; align-items:flex-start; gap:2px;">';
    if (factionBonus > 0) {
      html += `<span class="status-tag buff">隣接勢力${factionBonus}県（攻撃力+${factionBonus}）</span>`;
      html += `<span class="status-tag buff">隣接勢力${factionBonus}県（守備力+${factionBonus}）</span>`;
    }
    if (p.charged) {
      const chargeDefText = isTokugawaFaction(state, id) ? `・守備力+${TOKUGAWA_CHARGE_DEF_BONUS}` : '';
      html += `<span class="status-tag buff">力を蓄えた（攻撃力+${chargeBonusOf(state, id)}${chargeDefText}）</span>`;
    }
    if (p.recentlyDefeated) html += '<span class="status-tag warn">敗北による守備力-1</span>';
    if (!p.charged && !p.recentlyDefeated && factionBonus === 0) html += '<span class="status-tag">通常状態</span>';
    if (root === OSOROSHIA_ID) {
      html += invaderHasTerritory(state, OSOROSHIA_ID)
        ? `<span class="status-tag buff">オソロシア勢力：攻撃力に常時+${OSOROSHIA_INNATE_BONUS}</span>`
        : `<span class="status-tag buff">オソロシアパワー：無所属時のみ攻撃時+${OSOROSHIA_POWER_BONUS}</span>`;
    }
    if (root === ALIEN_ID) {
      html += invaderHasTerritory(state, ALIEN_ID)
        ? `<span class="status-tag buff">宇宙人勢力：攻撃力に常時+${ALIEN_INNATE_BONUS}</span>`
        : '<span class="status-tag buff">宇宙人の力：無所属時はチップ埋め込みで判定なし属国化</span>';
    }
    if (root === BLACKSHIP_ID) {
      html += `<span class="status-tag buff">メリケン勢力：攻撃力に常時+1〜2</span>`;
    }
    if (ISLAND_IDS.includes(id)) {
      html += '<span class="status-tag buff">離島の力：相手の隣接県数の守備力加算を無視</span>';
    }
    if (isGunmaFaction(state, id)) {
      html += `<span class="status-tag buff">グンマー化：攻撃力+${GUNMA_ATTACK_BONUS}・素早さ+${GUNMA_SPEED_BONUS}（上限${MAX_SPEED}）</span>`;
    }
    if (isTokugawaFaction(state, id)) {
      html += `<span class="status-tag buff">江戸幕府：攻撃力に毎回+${TOKUGAWA_ATTACK_BONUS_MIN}〜${TOKUGAWA_ATTACK_BONUS_MAX}・素早さ+${TOKUGAWA_SPEED_BONUS}（上限${MAX_SPEED}）</span>`;
    }
    html += '</div>';

    if (vassals.length > 0) {
      html += '<div style="margin-top:6px;">従えている属国：</div>';
      html += '<ul class="vassal-list">' + vassals.map((v) => `<li data-goto="${v}">・${state.prefs[v].name}</li>`).join('') + '</ul>';
    }

    document.getElementById('pref-info').innerHTML = html;
    document.querySelectorAll('#pref-info [data-goto]').forEach((el) => {
      el.addEventListener('click', () => onSelectPref(el.dataset.goto));
    });
  }

  // 勢力情報パネルも同様に、所属構成が変わっていない限りDOMを作り直さない。
  let lastFactionInfoSignature = null;

  function renderFactionInfo(state, id) {
    const root = factionRoot(state, id);
    const members = getFactionMembers(state, root);
    const signature = `${root}|${members.join(',')}|${state.prefs[root].name}`;
    if (signature === lastFactionInfoSignature) return;
    lastFactionInfoSignature = signature;

    let html = `<div class="info-title">${factionDisplayName(state, root)}勢力</div>`;
    html += `<div class="info-sub">主国: ${factionDisplayName(state, root)}</div>`;
    html += `<div>勢力数: ${members.length}県</div>`;
    html += '<ul class="member-list">' + members.map((m) => `<li data-goto="${m}">${m === root ? '★' : '・'}${state.prefs[m].name}</li>`).join('') + '</ul>';

    const detail = document.getElementById('faction-detail');
    detail.innerHTML = html;
    detail.querySelectorAll('[data-goto]').forEach((el) => {
      el.addEventListener('click', () => onSelectPref(el.dataset.goto));
    });
  }

  let factionGraphVisible = false;

  function polarPoint(cx, cy, r, angle) {
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }

  function describeDonutSlice(cx, cy, rOuter, rInner, startAngle, endAngle) {
    const so = polarPoint(cx, cy, rOuter, startAngle);
    const eo = polarPoint(cx, cy, rOuter, endAngle);
    const si = polarPoint(cx, cy, rInner, endAngle);
    const ei = polarPoint(cx, cy, rInner, startAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return `M ${so.x} ${so.y} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${eo.x} ${eo.y} `
      + `L ${si.x} ${si.y} A ${rInner} ${rInner} 0 ${largeArc} 0 ${ei.x} ${ei.y} Z`;
  }

  // ids（県IDの配列）が現在どの勢力にどれだけ属しているかを、ドーナツグラフ＋凡例のHTMLにして返す。
  // legendLimit: 凡例に個別表示する勢力数の上限（超えた分は「他n勢力」にまとめる）。unit: 「県」「島」など。
  function buildDonutGraphHtml(state, ids, unit, legendLimit) {
    const counts = new Map();
    ids.forEach((id) => {
      const root = factionRoot(state, id);
      counts.set(root, (counts.get(root) || 0) + 1);
    });
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    const cx = 100;
    const cy = 100;
    const rOuter = 90;
    const rInner = 48;
    let angle = -Math.PI / 2;
    let slicesSvg = '';
    entries.forEach(([rootId, count]) => {
      const fraction = count / ids.length;
      const nextAngle = angle + fraction * Math.PI * 2;
      const color = getFactionColor(state, rootId);
      if (entries.length === 1) {
        slicesSvg += `<circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" stroke="${color}" stroke-width="${rOuter - rInner}" />`;
      } else {
        slicesSvg += `<path d="${describeDonutSlice(cx, cy, rOuter, rInner, angle, nextAngle)}" fill="${color}" stroke="#14161c" stroke-width="1" />`;
      }
      angle = nextAngle;
    });

    const legendEntries = entries.slice(0, legendLimit);
    const restCount = entries.length - legendEntries.length;
    const restTotal = entries.slice(legendLimit).reduce((sum, [, c]) => sum + c, 0);

    let legendHtml = '<ul class="graph-legend">';
    legendEntries.forEach(([rootId, count]) => {
      const pct = ((count / ids.length) * 100).toFixed(1);
      legendHtml += `<li data-goto="${rootId}"><span class="swatch" style="background:${getFactionSwatch(state, rootId)}"></span>${factionDisplayName(state, rootId)}勢力 ${count}${unit}（${pct}%）</li>`;
    });
    if (restCount > 0) {
      const pct = ((restTotal / ids.length) * 100).toFixed(1);
      legendHtml += `<li class="graph-legend-rest">他 ${restCount}勢力 計${restTotal}${unit}（${pct}%）</li>`;
    }
    legendHtml += '</ul>';

    return `
      <svg viewBox="0 0 200 200" class="faction-graph-svg">${slicesSvg}
        <text x="100" y="96" text-anchor="middle" class="graph-center-count">${entries.length}</text>
        <text x="100" y="114" text-anchor="middle" class="graph-center-label">勢力</text>
      </svg>
      ${legendHtml}`;
  }

  // 47都道府県のグラフを表示する。離島が1つでも出現していれば、パネル内に収まるよう
  // 2カラムでコンパクト化し、離島（出現済みの分だけ）の勢力割合グラフも隣に並べる。
  // 離島が出現するまでは存在を悟られないよう、このグラフ自体も通常の1枚表示のまま何も足さない。
  function renderFactionGraph(state) {
    const container = document.getElementById('faction-graph-container');
    const islandIds = ISLAND_IDS.filter((id) => state.prefs[id]);

    if (islandIds.length === 0) {
      container.classList.remove('faction-graph-columns');
      container.innerHTML = buildDonutGraphHtml(state, PREFECTURES.map((p) => p.id), '県', 12);
    } else {
      container.classList.add('faction-graph-columns');
      const prefHtml = buildDonutGraphHtml(state, PREFECTURES.map((p) => p.id), '県', 6);
      const islandHtml = buildDonutGraphHtml(state, islandIds, '島', 6);
      container.innerHTML = `
        <div class="faction-graph-col">
          <div class="faction-graph-col-title">都道府県</div>
          ${prefHtml}
        </div>
        <div class="faction-graph-col">
          <div class="faction-graph-col-title">離島</div>
          ${islandHtml}
        </div>`;
    }

    container.querySelectorAll('[data-goto]').forEach((el) => {
      el.addEventListener('click', () => onSelectPref(el.dataset.goto));
    });
  }

  let lastFactionGraphSignature = null;

  // 47県＋出現済みの離島の帰属先が変化した時だけ再描画する（毎フレーム無条件に作り直すとスマホで重くなるため）。
  // 離島の出現数・並び順が変わった場合（新たに出現した等）も再描画されるよう署名に含める。
  function factionGraphSignature(state) {
    const islandSig = ISLAND_IDS.filter((id) => state.prefs[id]).map((id) => `${id}:${factionRoot(state, id)}`).join(',');
    return PREFECTURES.map((p) => factionRoot(state, p.id)).join(',') + `|${state.gunmaified}|${islandSig}`;
  }

  // グラフ表示中は毎フレーム呼ばれるが、実際の再描画はデータが変化した時だけ行う
  function updateFactionGraph(state) {
    if (!factionGraphVisible) return;
    const signature = factionGraphSignature(state);
    if (signature === lastFactionGraphSignature) return;
    lastFactionGraphSignature = signature;
    renderFactionGraph(state);
  }

  function toggleFactionGraph(state) {
    factionGraphVisible = !factionGraphVisible;
    document.getElementById('faction-graph-container').hidden = !factionGraphVisible;
    document.getElementById('faction-graph-toggle-btn').classList.toggle('active', factionGraphVisible);
    if (factionGraphVisible) {
      lastFactionGraphSignature = factionGraphSignature(state);
      renderFactionGraph(state);
    }
  }

  // 毎フレーム呼ばれるが、ログが増えた時だけ作り直す（毎フレームinnerHTMLを置き換えるとスマホで重くなり、タップが取りこぼされるため）
  let lastLogSignature = null;

  function renderLog(state) {
    const first = state.log[0];
    const signature = `${state.log.length}|${first ? first.time + first.message : ''}`;
    if (signature === lastLogSignature) return;
    lastLogSignature = signature;
    const list = document.getElementById('log-list');
    list.innerHTML = state.log.slice(0, 60).map((entry) =>
      `<li>[${entry.time.toFixed(1)}日] ${entry.message}</li>`
    ).join('');
  }

  // タイムラインの各項目は通常は県名だけを表示し、いずれか1つをタップすると
  // 表示中の項目すべてが一斉に「次回行動まで」の残り日数表示に切り替わる
  // （もう一度タップすると全項目が県名に戻る）。並び順・顔ぶれが変わらない限り
  // DOMを作り直さないのは renderPrefInfo と同じ理由（スマホでタップが反応しなくなる不具合を避けるため）。
  let lastTimelineSignature = null;
  let timelineRevealedAll = false;

  function timelineItemLabel(state, p) {
    if (timelineRevealedAll) {
      const wait = Math.max(0, p.nextActionTime - state.simTime).toFixed(1);
      return `残り${wait}日`;
    }
    return p.name.replace(/[都府県]$/, '');
  }

  function updateAllTimelineLabels(state) {
    document.querySelectorAll('#timeline-track .timeline-item').forEach((el) => {
      const p = state.prefs[el.dataset.pref];
      if (!p) return;
      const labelEl = document.getElementById(`timeline-label-${p.id}`);
      if (labelEl) labelEl.textContent = timelineItemLabel(state, p);
    });
  }

  function renderTimeline(state) {
    const track = document.getElementById('timeline-track');
    const upcoming = Object.values(state.prefs)
      .slice()
      .sort((a, b) => a.nextActionTime - b.nextActionTime)
      .slice(0, 16);

    const signature = upcoming.map((p) => p.id + p.name).join(',');
    if (signature === lastTimelineSignature) {
      if (timelineRevealedAll) {
        upcoming.forEach((p) => {
          const el = document.getElementById(`timeline-label-${p.id}`);
          if (el) el.textContent = timelineItemLabel(state, p);
        });
      }
    } else {
      lastTimelineSignature = signature;
      track.innerHTML = upcoming.map((p, i) => {
        const color = getFactionSwatch(state, p.id);
        return `<div class="timeline-item ${i === 0 ? 'next' : ''}" data-pref="${p.id}">
          <div class="dot" style="background:${color}"></div>
          <div id="timeline-label-${p.id}">${timelineItemLabel(state, p)}</div>
        </div>`;
      }).join('');

      track.querySelectorAll('.timeline-item').forEach((el) => {
        el.addEventListener('click', () => {
          timelineRevealedAll = !timelineRevealedAll;
          updateAllTimelineLabels(state);
        });
      });
    }

    setTextIfChanged('sim-time-display', `${state.simTime.toFixed(1)}日目`);
  }

  function updateFactionCount(state) {
    // 47都道府県の現在の帰属先だけを数える（オソロシア・宇宙人が領土を持っていなければ数えない）
    const roots = new Set(getAllPrefIds(state).map((id) => factionRoot(state, id)));
    setTextIfChanged('faction-count-display', `現在の勢力数: ${roots.size}`);
  }

  function showDecisionModal(state) {
    const { prefId, candidates, kuniGaeOffer } = state.pendingPlayerDecision;
    const p = state.prefs[prefId];
    document.getElementById('decision-title').textContent = `${p.name} の行動を選択`;
    document.getElementById('decision-stats').innerHTML =
      `実効攻撃力: ${effectiveAttack(state, prefId)}${p.charged ? '（力を蓄え済み）' : ''}／ 実効守備力: ${effectiveDefense(state, prefId)}`;

    const optionsEl = document.getElementById('decision-options');
    let html = '';
    candidates.forEach((targetId) => {
      const t = state.prefs[targetId];
      const isAccumulated = isAccumulatedDrawBonusEligible(state, prefId, targetId);
      const isDesperationEligible = effectiveAttack(state, prefId) < effectiveDefense(state, targetId);
      const desperationChance = isAccumulated ? DESPERATION_CHANCE_BOOSTED : DESPERATION_CHANCE;
      const desperationLine = isDesperationEligible
        ? `<div class="desperation-hint">🐭 キュウソネコカミ！！ ${Math.round(desperationChance * 100)}%で攻撃力+${DESPERATION_BONUS}</div>`
        : '';
      const accumulatedLine = isAccumulated
        ? `<div class="desperation-hint">💥 蓄積ダメージ発動！！（5連続未勝利・攻撃力+${ACCUMULATED_DRAW_BONUS}）</div>`
        : '';
      html += `<div class="decision-option" data-target="${targetId}">
        <div class="decision-option-main">
          <span>⚔ ${t.name} を攻撃（${statusLabel(state, targetId)}）</span>
          <span class="odds">相手 攻撃力:${attackText(state, targetId)} ／ 守備力:${effectiveDefense(state, targetId)} ／ 素早さ:${effectiveSpeed(state, targetId)}</span>
        </div>
        ${accumulatedLine}
        ${desperationLine}
      </div>`;
    });
    const chargeAtk = chargeBonusOf(state, prefId);
    const chargeDefText = isTokugawaFaction(state, prefId) ? `・守備力+${TOKUGAWA_CHARGE_DEF_BONUS}` : '';
    html += `<div class="decision-option" data-charge="1">
      <div class="decision-option-main">
        <span>🛡 力を蓄える（次の攻撃時 攻撃力+${chargeAtk}${chargeDefText}）</span><span class="odds"></span>
      </div>
    </div>`;
    if (kuniGaeOffer) {
      html += `<div class="decision-option" data-kunigae="1">
        <div class="decision-option-main">
          <span>🗺️ お国替え</span><span class="odds"></span>
        </div>
        <div class="kunigae-note">⚠️ 地方を制覇した直後の今だけ選べます。見送ると、次にどこか新しい地方を制覇するまで現れません</div>
      </div>`;
    }
    optionsEl.innerHTML = html;
    optionsEl.hidden = false;
    document.getElementById('kunigae-step').hidden = true;

    optionsEl.querySelectorAll('[data-target]').forEach((el) => {
      el.addEventListener('click', () => onSubmitAction({ type: 'attack', targetId: el.dataset.target }));
    });
    optionsEl.querySelector('[data-charge]').addEventListener('click', () => onSubmitAction({ type: 'charge' }));
    const kunigaeBtn = optionsEl.querySelector('[data-kunigae]');
    if (kunigaeBtn) {
      kunigaeBtn.addEventListener('click', () => {
        kuniGaeStep = { decision: state.pendingPlayerDecision, selectedLeft: null, selectedRight: null };
        showKuniGaeStep(state, kuniGaeOffer);
      });
    }

    document.getElementById('decision-close-btn').onclick = () => onCloseDecision();

    document.getElementById('player-decision-modal').hidden = false;
    document.getElementById('decision-reopen-btn').hidden = true;

    // ✕で閉じて地図・県情報を確認した後に開き直した場合は、お国替えの選択画面（と選んでいた候補）に戻す
    if (kuniGaeStep && kuniGaeStep.decision === state.pendingPlayerDecision && kuniGaeOffer) {
      showKuniGaeStep(state, kuniGaeOffer);
    } else {
      clearKuniGaeStep();
    }
  }

  // お国替えの候補選択画面の状態。{ decision, selectedLeft, selectedRight }。
  // ✕で閉じても（行動選択が済むまで）覚えておき、地図のオレンジ・青の丸もその間は出したままにする
  let kuniGaeStep = null;

  function clearKuniGaeStep() {
    kuniGaeStep = null;
    MapView.setKuniGaeMarks(null);
  }

  // 選んだ場所の基本能力値（隣接勢力などを加算する前の値）を、説明文の上に被せて表示する
  function renderKuniGaePicked(state) {
    const rows = [
      ['kunigae-picked-left', kuniGaeStep.selectedLeft],
      ['kunigae-picked-right', kuniGaeStep.selectedRight],
    ];
    rows.forEach(([elId, id]) => {
      const el = document.getElementById(elId);
      if (!id) {
        el.hidden = true;
        return;
      }
      const p = state.prefs[id];
      el.innerHTML = `<span class="kunigae-picked-name">${p.name}</span>攻撃力:${p.baseAtk} ／ 守備力:${p.baseDef} ／ 素早さ:${p.baseSpd}`;
      el.hidden = false;
    });
    document.getElementById('kunigae-picked').hidden = !(kuniGaeStep.selectedLeft || kuniGaeStep.selectedRight);
  }

  // お国替えの2段階目：候補を左右に表示し、1つずつ選んで実行する画面に切り替える
  function showKuniGaeStep(state, kuniGaeOffer) {
    document.getElementById('decision-options').hidden = true;
    const stepEl = document.getElementById('kunigae-step');
    stepEl.hidden = false;
    MapView.setKuniGaeMarks(kuniGaeOffer);

    const executeBtn = document.getElementById('kunigae-execute-btn');
    const updateExecuteBtn = () => { executeBtn.disabled = !(kuniGaeStep.selectedLeft && kuniGaeStep.selectedRight); };

    function renderColumn(containerId, ids, side) {
      const el = document.getElementById(containerId);
      el.innerHTML = ids.map((id) => `<button data-id="${id}" class="${kuniGaeStep[side] === id ? 'active' : ''}">${state.prefs[id].name}</button>`).join('');
      el.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          el.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          kuniGaeStep[side] = btn.dataset.id;
          renderKuniGaePicked(state);
          updateExecuteBtn();
        });
      });
    }
    renderColumn('kunigae-left-options', kuniGaeOffer.left, 'selectedLeft');
    renderColumn('kunigae-right-options', kuniGaeOffer.right, 'selectedRight');
    renderKuniGaePicked(state);
    updateExecuteBtn();

    executeBtn.onclick = () => {
      if (!kuniGaeStep.selectedLeft || !kuniGaeStep.selectedRight) return;
      onSubmitAction({ type: 'kunigae', slotA: kuniGaeStep.selectedLeft, slotB: kuniGaeStep.selectedRight });
    };
    document.getElementById('kunigae-back-btn').onclick = () => {
      clearKuniGaeStep();
      stepEl.hidden = true;
      document.getElementById('decision-options').hidden = false;
    };
  }

  function showReopenButton(state) {
    const { prefId } = state.pendingPlayerDecision;
    const btn = document.getElementById('decision-reopen-btn');
    btn.textContent = `▶ ${state.prefs[prefId].name} の行動を選択する`;
    btn.hidden = false;
    document.getElementById('player-decision-modal').hidden = true;
  }

  function hideDecisionModal() {
    clearKuniGaeStep(); // 行動が決まったので、お国替えの選択状態と地図の丸を消す
    document.getElementById('player-decision-modal').hidden = true;
    document.getElementById('decision-reopen-btn').hidden = true;
  }

  function showBattleOverlay(battle) {
    const accumulatedEl = document.getElementById('battle-accumulated');
    if (battle.accumulatedBonus) {
      accumulatedEl.textContent = `💥 蓄積ダメージ！！（5連続未勝利・${battle.attackerName}の攻撃力+${ACCUMULATED_DRAW_BONUS}）`;
      accumulatedEl.hidden = false;
    } else {
      accumulatedEl.hidden = true;
    }

    const desperationEl = document.getElementById('battle-desperation');
    if (battle.desperation) {
      desperationEl.textContent = `🐭 キュウソネコカミ発動！！（${battle.attackerName}の攻撃力+${DESPERATION_BONUS}）`;
      desperationEl.hidden = false;
    } else {
      desperationEl.hidden = true;
    }

    document.getElementById('battle-attacker-name').textContent = battle.attackerName;
    document.getElementById('battle-attacker-stat').textContent = battle.forced ? 'チップ埋め込み（判定なし）' : `攻撃力 ${battle.atk}`;
    document.getElementById('battle-defender-name').textContent = battle.defenderName;
    document.getElementById('battle-defender-stat').textContent = battle.forced ? '洗脳された…' : `守備力 ${battle.def}`;

    const resultEl = document.getElementById('battle-result');
    if (battle.forced) {
      resultEl.textContent = `→ ${battle.defenderName} は無条件で ${battle.attackerName} の属国になった`;
      resultEl.style.color = 'var(--danger)';
    } else if (battle.result === 'win') {
      resultEl.textContent = `→ ${battle.attackerName} の勝利！`;
      resultEl.style.color = 'var(--win)';
    } else if (battle.result === 'draw') {
      resultEl.textContent = '→ 引き分け';
      resultEl.style.color = 'var(--text-dim)';
    } else {
      resultEl.textContent = `→ ${battle.defenderName} が防衛成功`;
      resultEl.style.color = 'var(--danger)';
    }

    const overlay = document.getElementById('battle-overlay');
    overlay.hidden = false;
    clearTimeout(overlay._hideTimer);
    overlay._hideTimer = setTimeout(() => { overlay.hidden = true; }, 1300);
  }

  // プレイヤーの勢力が絡む戦闘の勝敗を、地図中央上部に大きく表示する。
  // タップして続行されるまで消えない（呼び出し側でタイムラインを一時停止する）。
  function showPlayerBattleBanner(playerBanner) {
    const banner = document.getElementById('player-battle-banner');
    const accumulatedEl = document.getElementById('player-battle-accumulated');
    const desperationEl = document.getElementById('player-battle-desperation');
    const headlineEl = document.getElementById('player-battle-headline');

    // 世界イベントのバナー（黒船来航など）と同時に出るときは、その白文字バナーの真下に来るよう位置をずらして、メッセージが隠れないようにする
    if (!document.getElementById('world-event-banner').hidden) {
      const wrapBottom = document.querySelector('.world-event-wrap').getBoundingClientRect().bottom;
      banner.style.top = `${Math.max(window.innerHeight * 0.22, wrapBottom + 12)}px`;
    } else {
      banner.style.top = '';
    }

    accumulatedEl.hidden = !playerBanner.accumulatedBonus;
    desperationEl.hidden = !playerBanner.desperation;

    // 主語は常にプレイヤー自身の県にする（攻撃側／防御側どちらでも同じ）
    const self = `${playerBanner.selfName}（主国:${playerBanner.selfSovereign}）`;
    const opponent = `${playerBanner.opponentName}（主国:${playerBanner.opponentSovereign}）`;

    headlineEl.classList.remove('win', 'lose', 'draw');
    if (playerBanner.playerOutcome === 'draw') {
      headlineEl.textContent = `${self}と${opponent}が引き分け`;
    } else if (playerBanner.playerOutcome === 'win') {
      // 自分が防御側で勝った（＝防衛成功）場合は「勝利」ではなく「防衛」と表現する
      headlineEl.textContent = playerBanner.playerWasAttacker
        ? `${self}が${opponent}に勝利！！`
        : `${self}が${opponent}から防衛！！`;
    } else {
      headlineEl.textContent = `${self}は${opponent}に敗北！！`;
    }
    headlineEl.classList.add(playerBanner.playerOutcome);

    // 属国化／新主国独立の結果は、勝敗バナーの下にもう1つの小さな1行バナーとして添える
    // 戦闘メッセージ（県同士のやり取り）は、勝敗バナーの直上に出す。定義が無い戦闘・OFFのときは出さない
    const quipEl = document.getElementById('player-battle-quip');
    if (playerBanner.quip) {
      quipEl.textContent = playerBanner.quip;
      quipEl.hidden = false;
    } else {
      quipEl.hidden = true;
    }

    const noteEl = document.getElementById('player-battle-note');
    if (playerBanner.note) {
      noteEl.textContent = playerBanner.note;
      noteEl.hidden = false;
    } else {
      noteEl.hidden = true;
    }

    banner.hidden = false;
  }

  function hidePlayerBattleBanner() {
    document.getElementById('player-battle-banner').hidden = true;
  }

  // オソロシア・宇宙人などの侵略イベント発生を、画面上部に大きく知らせる。
  // タップして続行されるまで消えない（呼び出し側でタイムラインを一時停止する）。
  function showWorldEventBanner(worldEvent) {
    const banner = document.getElementById('world-event-banner');
    banner.textContent = worldEvent.headline;
    banner.hidden = false;

    // 戦闘メッセージ（黒船来航の「開国シテクダサーイ！」など）は見出しの直上に出す。無い場合・OFFのときは出さない
    const quipEl = document.getElementById('world-event-quip');
    if (worldEvent.quip) {
      quipEl.textContent = worldEvent.quip;
      quipEl.hidden = false;
    } else {
      quipEl.hidden = true;
    }

    // 返り咲き・侵略・独立などのとき、詳しい内容を見出しの下に白文字の小さなバナーで添える（各文は改行して表示）
    const noteEl = document.getElementById('world-event-note');
    if (worldEvent.notes && worldEvent.notes.length > 0) {
      noteEl.textContent = worldEvent.notes.join('\n');
      noteEl.hidden = false;
    } else {
      noteEl.hidden = true;
    }
  }

  function hideWorldEventBanner() {
    document.getElementById('world-event-banner').hidden = true;
    document.getElementById('world-event-quip').hidden = true;
    document.getElementById('world-event-note').hidden = true;
  }

  // 真クリア（15代目の江戸幕府を全滅させた状態での日本一統）の背景を金色にし、花吹雪を舞わせる。
  // 花びらはDOM要素を作り直さず、表示のたびに数だけランダムに再生成する（表示頻度が低いため毎フレーム最適化は不要）。
  const CLEAR_PETAL_COUNT = 18;
  function renderClearPetals() {
    const petalsEl = document.getElementById('clear-petals');
    petalsEl.innerHTML = Array.from({ length: CLEAR_PETAL_COUNT }, () => {
      const left = (Math.random() * 100).toFixed(1);
      const delay = (Math.random() * 3).toFixed(2);
      const duration = (3.2 + Math.random() * 2.6).toFixed(2);
      const size = (14 + Math.random() * 10).toFixed(0);
      return `<span class="petal" style="left:${left}%; animation-delay:${delay}s; animation-duration:${duration}s; font-size:${size}px;">🌸</span>`;
    }).join('');
  }

  function showClearOverlay(state) {
    const winnerName = factionDisplayName(state, state.winnerRootId);
    const badEnding = isBadEnding(state);
    // バッドエンドは「！」を付けない淡々とした文言にする（プレイヤー自身が徳川家を率いていた場合も同じ）
    document.getElementById('clear-title').textContent = badEnding ? '日本一統達成' : '日本一統達成！';
    document.getElementById('clear-message').textContent = `${winnerName}が日本一統を達成しました${badEnding ? '' : '！'}`;
    // 離島が出現していれば、その分も「出現数 / 出現数」で一緒に表示する（未出現の島は分母に含めない）
    const islandCount = ISLAND_IDS.filter((id) => state.prefs[id]).length;
    const islandEl = document.getElementById('clear-island-count');
    if (islandCount > 0) {
      islandEl.textContent = `${islandCount} / ${islandCount} 離島`;
      islandEl.hidden = false;
    } else {
      islandEl.hidden = true;
    }

    const clearBox = document.getElementById('clear-box');
    const trueBadge = document.getElementById('clear-true-badge');
    const petalsEl = document.getElementById('clear-petals');
    // バッドエンドは暗い紫。真クリアの条件を満たしていても、侵略者等に一統されたらバッドエンドを優先する
    clearBox.classList.toggle('bad-ending', badEnding);
    if (state.tokugawaFinalDefeated && !badEnding) {
      clearBox.classList.add('true-ending');
      trueBadge.hidden = false;
      petalsEl.hidden = false;
      renderClearPetals();
    } else {
      clearBox.classList.remove('true-ending');
      trueBadge.hidden = true;
      petalsEl.hidden = true;
      petalsEl.innerHTML = '';
    }

    document.getElementById('clear-overlay').hidden = false;
  }

  function populatePlayerPrefSelect() {
    const select = document.getElementById('player-pref-select');
    select.innerHTML = PREFECTURES.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  }

  // iPhone Safariは、タップ直後に画面が更新され続けているとclickを発火しないことがある。
  // 動作中は常に画面が更新されるため、指を離した時点（touchend）で直接ボタンを押す。
  // preventDefault()でその後の（あれば）clickは抑止するので二重に反応しない。
  const TAP_SELECTOR = 'button, .decision-option, [data-goto], .timeline-item';
  function installTapFallback() {
    let start = null;
    document.addEventListener('touchstart', (evt) => {
      const t = evt.touches[0];
      const el = evt.target.closest && evt.target.closest(TAP_SELECTOR);
      start = evt.touches.length === 1 && el ? { el, x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    document.addEventListener('touchend', (evt) => {
      if (!start) return;
      const { el, x, y } = start;
      start = null;
      const t = evt.changedTouches[0];
      if (Math.hypot(t.clientX - x, t.clientY - y) > 10) return; // スクロール等は対象外
      if (el.disabled) return;
      evt.preventDefault();
      el.click();
    }, { passive: false });
    document.addEventListener('touchcancel', () => { start = null; }, { passive: true });
  }

  function init(handlers) {
    installTapFallback();
    onSelectPref = handlers.onSelectPref;
    onSubmitAction = handlers.onSubmitAction;
    onCloseDecision = handlers.onCloseDecision;
    onReopenDecision = handlers.onReopenDecision;

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
      });
    });

    document.getElementById('decision-reopen-btn').addEventListener('click', () => onReopenDecision());
  }

  return {
    init,
    renderPrefInfo,
    renderFactionInfo,
    renderLog,
    renderTimeline,
    updateFactionCount,
    toggleFactionGraph,
    updateFactionGraph,
    showDecisionModal,
    hideDecisionModal,
    showReopenButton,
    showBattleOverlay,
    showPlayerBattleBanner,
    hidePlayerBattleBanner,
    showWorldEventBanner,
    hideWorldEventBanner,
    showClearOverlay,
    populatePlayerPrefSelect,
  };
})();
