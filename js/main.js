/*
 * main.js
 * 画面のイベント配線とゲームループ（requestAnimationFrame）。
 * ここではゲームルールを一切判定せず、state操作は timeline.js の関数だけを呼ぶ。
 */

(() => {
  let state = null;
  let selectedPrefId = null;
  let lastShownBattle = null;
  let lastShownWorldEvent = null;
  let shownDecision = null;
  let decisionModalOpen = false;
  let clearShown = false;
  let lastFrameTime = null;
  let bannerPauseActive = false;
  let worldBannerTimer = null;
  let playerBannerTimer = null;
  const WORLD_BANNER_AUTOHIDE_MS = 2000;
  const PLAYER_BANNER_AUTOHIDE_MS = 2000;
  let lastRenderTime = -Infinity;
  const RENDER_INTERVAL_MS = 100;

  function selectPref(id) {
    selectedPrefId = id;
    MapView.setSelected(id);
    UI.renderPrefInfo(state, id);
    UI.renderFactionInfo(state, factionRoot(state, id));
  }

  function handleSubmitAction(action) {
    submitPlayerAction(state, action);
    UI.hideDecisionModal();
    shownDecision = null;
    decisionModalOpen = false;
  }

  function handleCloseDecision() {
    decisionModalOpen = false;
    UI.showReopenButton(state);
  }

  function handleReopenDecision() {
    decisionModalOpen = true;
    UI.showDecisionModal(state);
  }

  // 世界イベント（オソロシア侵攻・UFO襲来）やプレイヤー絡みの戦闘バナー表示中は
  // タイムラインを一時停止し、再生ボタンを押したら再開する。
  // 実際の一時停止（state.running=false）は発生した瞬間にtimeline.js/invaders.js側で
  // 即座に行われている（画面の検知を待つと次のtick()が先に進んでしまうため）。
  // ここではUI表示（ボタン文言・ヒント）だけを合わせる。
  function enterBannerPause() {
    if (bannerPauseActive) return; // 同一フレームで両方出ても二重処理しない
    bannerPauseActive = true;
    document.getElementById('play-pause-btn').textContent = '▶ 再生';
    document.getElementById('banner-continue-hint').hidden = false;
  }

  function dismissBanners() {
    if (!bannerPauseActive) return;

    // 続けて見せたい世界イベントがキューにあれば（例：UFO襲来→江戸幕府滅亡）、
    // 再開せずに次のバナーをそのまま表示する（bannerPauseActiveは維持する）
    if (state.worldEventQueue && state.worldEventQueue.length > 0) {
      UI.hidePlayerBattleBanner();
      state.worldEvent = state.worldEventQueue.shift(); // 次フレームのframe()がworldEvent変化を検知して表示する
      return;
    }

    bannerPauseActive = false;
    document.getElementById('banner-continue-hint').hidden = true;
    UI.hidePlayerBattleBanner();
    UI.hideWorldEventBanner();
    state.running = true; // 確認後は再開する
    document.getElementById('play-pause-btn').textContent = '⏸ 一時停止';
  }

  function frame(now) {
    if (lastFrameTime === null) lastFrameTime = now;
    const dt = Math.min(0.25, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    if (state) {
      // tick()はstate.winnerRootIdが立っていると内部で何もしないので、勝利後もそのまま呼んでよい
      tick(state, dt);

      if (state.pendingPlayerDecision && state.pendingPlayerDecision !== shownDecision) {
        shownDecision = state.pendingPlayerDecision;
        decisionModalOpen = true;
        UI.showDecisionModal(state);
      }

      const tokugawaModal = document.getElementById('tokugawa-choice-modal');
      if (state.pendingTokugawaChoice && tokugawaModal.hidden) tokugawaModal.hidden = false;

      if (state.worldEvent && state.worldEvent !== lastShownWorldEvent) {
        lastShownWorldEvent = state.worldEvent;
        UI.showWorldEventBanner(state.worldEvent);
        if (state.worldEvent.paused === false) {
          // 「止めない」設定の侵攻イベント：バナーだけ短く表示し、タイムラインはそのまま流し続ける
          clearTimeout(worldBannerTimer);
          worldBannerTimer = setTimeout(() => {
            if (!bannerPauseActive) UI.hideWorldEventBanner();
          }, WORLD_BANNER_AUTOHIDE_MS);
        } else {
          enterBannerPause();
        }
      }

      if (state.lastBattle && state.lastBattle !== lastShownBattle) {
        lastShownBattle = state.lastBattle;
        UI.showBattleOverlay(state.lastBattle);
        if (state.lastBattle.playerBanner) {
          UI.showPlayerBattleBanner(state.lastBattle.playerBanner);
          if (state.pauseOnPlayerBattle) {
            enterBannerPause();
          } else {
            // 「自勢力の戦闘結果で一時停止」がOFFのときは、世界イベントの「止めない」設定と同様に
            // 少しだけ表示してから自動で消し、タイムラインは止めずに進め続ける
            clearTimeout(playerBannerTimer);
            playerBannerTimer = setTimeout(() => {
              if (!bannerPauseActive) UI.hidePlayerBattleBanner();
            }, PLAYER_BANNER_AUTOHIDE_MS);
          }
        }
      }

      // 描画は約10fpsに間引く（毎フレーム全DOMを更新するとiPhone Safariが重くなり、ボタンのタップが効かなくなる）
      if (now - lastRenderTime >= RENDER_INTERVAL_MS) {
        lastRenderTime = now;
        MapView.update(state);
        UI.renderTimeline(state);
        UI.updateFactionCount(state);
        UI.updateFactionGraph(state);
        UI.renderLog(state);
        if (selectedPrefId) {
          UI.renderPrefInfo(state, selectedPrefId);
          UI.renderFactionInfo(state, factionRoot(state, selectedPrefId));
        }
      }

      if (state.winnerRootId && !clearShown) {
        clearShown = true;
        UI.showClearOverlay(state);
      }
    }

    requestAnimationFrame(frame);
  }

  function startGame() {
    const mode = document.getElementById('mode-select').value;
    state = createInitialState();
    state.mode = mode;
    state.running = false; // 開始直後は情勢を確認できるよう一時停止しておく

    if (mode === 'manual') {
      state.playerPrefId = document.getElementById('player-pref-select').value;
    } else {
      state.playerPrefId = null;
    }
    state.kuniGaeMode = document.getElementById('kunigae-mode-select').value === 'on';

    clearShown = false;
    lastShownBattle = null;
    lastShownWorldEvent = null;
    shownDecision = null;
    decisionModalOpen = false;
    selectedPrefId = null;
    lastFrameTime = null;
    bannerPauseActive = false;
    document.getElementById('banner-continue-hint').hidden = true;

    document.getElementById('setup-panel').hidden = true;
    document.getElementById('restart-btn').hidden = false;
    document.getElementById('game-area').hidden = false;
    document.getElementById('timeline-bar').hidden = false;

    updateSpecialEventPauseUI();
    updateBattleQuipUI();
    updateOperationModeUI();
    updatePauseOnPlayerBattleUI();
    MapView.init(selectPref);
    MapView.update(state);
    UI.renderTimeline(state);
    UI.updateFactionCount(state);

    document.getElementById('play-pause-btn').textContent = '▶ 再生';
  }

  function wireSetupPanel() {
    UI.populatePlayerPrefSelect();

    const modeSelect = document.getElementById('mode-select');
    const playerLabel = document.getElementById('player-pref-label');
    modeSelect.addEventListener('change', () => {
      playerLabel.style.display = modeSelect.value === 'manual' ? '' : 'none';
    });

    document.getElementById('start-btn').addEventListener('click', startGame);
    document.getElementById('restart-btn').addEventListener('click', () => {
      window.location.reload();
    });
  }

  function wirePlaybackControls() {
    document.getElementById('play-pause-btn').addEventListener('click', () => {
      if (!state) return;
      if (bannerPauseActive) {
        dismissBanners();
        return;
      }
      state.running = !state.running;
      document.getElementById('play-pause-btn').textContent = state.running ? '⏸ 一時停止' : '▶ 再生';
    });

    document.querySelectorAll('#speed-controls button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!state) return;
        state.speed = parseFloat(btn.dataset.speed);
        document.querySelectorAll('#speed-controls button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  // 設定パネル（⚙）。今は「特殊イベントで自動停止」だけだが、他の設定もここに足せる。
  // 手動モードでは5x・10xのときだけ効くので、その旨をパネル内の補足文で示す。
  function updateSpecialEventPauseUI() {
    if (!state) return;
    const btn = document.getElementById('special-event-pause-btn');
    btn.textContent = state.pauseOnInvasion ? 'ON' : 'OFF';
    btn.classList.toggle('active', state.pauseOnInvasion);
    document.getElementById('special-event-pause-note').textContent = state.mode === 'auto'
      ? '全スピードで有効。OFFにすると、止まらずそのまま進みます。'
      : '5x・10xのときだけ有効（それ未満のスピードでは常に停止）。OFFにすると、止まらずそのまま進みます。';
  }

  function updateBattleQuipUI() {
    if (!state) return;
    const btn = document.getElementById('battle-quip-btn');
    btn.textContent = state.showBattleQuips ? 'ON' : 'OFF';
    btn.classList.toggle('active', state.showBattleQuips);
  }

  // 操作設定（手動／自動A／自動B）は排他選択。選択中のボタンだけ.activeにする
  function updateOperationModeUI() {
    if (!state) return;
    const isAuto = state.mode === 'auto';
    document.getElementById('operation-mode-row').hidden = isAuto;
    document.getElementById('operation-mode-note').hidden = isAuto;
    document.querySelectorAll('#operation-mode-controls button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === state.operationMode);
    });
  }

  function updatePauseOnPlayerBattleUI() {
    if (!state) return;
    const btn = document.getElementById('pause-on-player-battle-btn');
    btn.textContent = state.pauseOnPlayerBattle ? 'ON' : 'OFF';
    btn.classList.toggle('active', state.pauseOnPlayerBattle);
  }

  function wireSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    document.getElementById('settings-btn').addEventListener('click', () => {
      panel.hidden = !panel.hidden;
    });
    document.getElementById('settings-close-btn').addEventListener('click', () => {
      panel.hidden = true;
    });
    document.getElementById('special-event-pause-btn').addEventListener('click', () => {
      if (!state) return;
      state.pauseOnInvasion = !state.pauseOnInvasion;
      updateSpecialEventPauseUI();
    });
    document.getElementById('battle-quip-btn').addEventListener('click', () => {
      if (!state) return;
      state.showBattleQuips = !state.showBattleQuips;
      updateBattleQuipUI();
    });
    document.querySelectorAll('#operation-mode-controls button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!state) return;
        state.operationMode = btn.dataset.mode;
        updateOperationModeUI();
      });
    });
    document.getElementById('pause-on-player-battle-btn').addEventListener('click', () => {
      if (!state) return;
      state.pauseOnPlayerBattle = !state.pauseOnPlayerBattle;
      updatePauseOnPlayerBattleUI();
    });
  }

  function wireTokugawaChoice() {
    document.querySelectorAll('[data-tokugawa-choice]').forEach((el) => {
      el.addEventListener('click', () => {
        if (!state || !state.pendingTokugawaChoice) return;
        chooseTokugawaPlay(state, el.dataset.tokugawaChoice === 'yes');
        document.getElementById('tokugawa-choice-modal').hidden = true;
        // 開府バナーで止まっていなければ（「特殊イベントで自動停止」OFF等）、選んだらそのまま再開する
        if (!bannerPauseActive) {
          state.running = true;
          document.getElementById('play-pause-btn').textContent = '⏸ 一時停止';
        }
      });
    });
  }

  function wireOverlays() {
    document.getElementById('clear-close-btn').addEventListener('click', () => {
      document.getElementById('clear-overlay').hidden = true;
    });
    document.getElementById('faction-graph-toggle-btn').addEventListener('click', () => {
      if (!state) return;
      UI.toggleFactionGraph(state);
    });
  }

  wireSetupPanel();
  wirePlaybackControls();
  wireOverlays();
  wireSettingsPanel();
  wireTokugawaChoice();
  UI.init({
    onSelectPref: selectPref,
    onSubmitAction: handleSubmitAction,
    onCloseDecision: handleCloseDecision,
    onReopenDecision: handleReopenDecision,
  });

  requestAnimationFrame(frame);
})();
