/* ============================================================
   app.js — Game State, UI Rendering, Event Handling, Save/Load
   ============================================================ */

(function () {
    'use strict';

    // ---- Game State ----
    const PLAYER_COUNT = 10;
    let game = createEmptyGame();
    let cachedTeams = []; // populated from Storage for datalist dropdowns

    function createEmptyGame() {
        return {
            id: 'game-' + Date.now(),
            date: new Date().toISOString().slice(0, 10),
            status: 'in-progress',
            createdAt: new Date().toISOString(),
            completedAt: null,
            innings: 9,
            awayTeam: {
                teamId: null,
                name: '',
                players: createEmptyLineup(),
                pitchers: [{ name: '', startInning: 1, endInning: null }],
                currentPitcherIdx: 0
            },
            homeTeam: {
                teamId: null,
                name: '',
                players: createEmptyLineup(),
                pitchers: [{ name: '', startInning: 1, endInning: null }],
                currentPitcherIdx: 0
            },
            atBats: {} // key: "team-playerIdx-inning" → AtBat
        };
    }

    function createEmptyLineup() {
        const players = [];
        for (let i = 0; i < PLAYER_COUNT; i++) {
            players.push({ name: '', number: '', position: '' });
        }
        return players;
    }

    function emptyBases() {
        return { first: false, second: false, third: false, home: false };
    }

    function getTeamData(team) {
        return team === 'away' ? game.awayTeam : game.homeTeam;
    }

    function getOpposingTeam(team) {
        return team === 'away' ? 'home' : 'away';
    }

    function getPitcherInfo(battingTeam) {
        const pTeam = getOpposingTeam(battingTeam);
        const pIdx = getTeamData(pTeam).currentPitcherIdx || 0;
        return { team: pTeam, pitcherIdx: pIdx };
    }

    function createEmptyAtBat(battingTeam) {
        return {
            result: null,
            fielderNotation: '',
            bases: emptyBases(),
            outNumber: 0,
            rbiCount: 0,
            notes: '',
            sprayChart: null,
            pitches: [],
            count: { balls: 0, strikes: 0 },
            batterHand: 'R',
            runnerAdvancements: [],
            pitcherInfo: battingTeam ? getPitcherInfo(battingTeam) : null
        };
    }

    function getRunnerChoice(playerIdx, startBase) {
        return pendingRunnerChoices.find(
            c => c.playerIdx === playerIdx && c.startBase === startBase
        );
    }

    function atBatKey(team, playerIdx, inning) {
        return `${team}-${playerIdx}-${inning}`;
    }

    function getAtBat(team, playerIdx, inning) {
        return game.atBats[atBatKey(team, playerIdx, inning)] || null;
    }

    function setAtBat(team, playerIdx, inning, data) {
        game.atBats[atBatKey(team, playerIdx, inning)] = data;
        persistCurrentGame();
    }

    function clearAtBat(team, playerIdx, inning) {
        delete game.atBats[atBatKey(team, playerIdx, inning)];
        persistCurrentGame();
    }

    // ---- Auto-Save (debounced) ----
    let persistTimer = null;
    let readOnlyMode = false;

    let teamSaveTimer = null;

    function persistCurrentGame() {
        if (readOnlyMode) return;
        game.updatedAt = new Date().toISOString();
        clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            Storage.put('currentGame', 'current', game).catch(err => {
                console.warn('Auto-save failed:', err);
            });
        }, 300);

        // Auto-save teams (debounced separately, less frequent)
        clearTimeout(teamSaveTimer);
        teamSaveTimer = setTimeout(() => {
            if (game.awayTeam.name) saveTeamToStorage(game.awayTeam).catch(() => {});
            if (game.homeTeam.name) saveTeamToStorage(game.homeTeam).catch(() => {});
        }, 2000);
    }

    // ---- Team/Player Datalist Helpers ----

    async function populateTeamDatalist() {
        const savedTeams = await Storage.getAll('teams');
        cachedTeams = savedTeams.map(t => t.value);
        const dl = document.getElementById('saved-teams-list');
        if (!dl) return;
        dl.innerHTML = '';
        for (const team of cachedTeams) {
            const opt = document.createElement('option');
            opt.value = team.name;
            dl.appendChild(opt);
        }
    }

    function populateRosterDatalist(teamKey, teamName) {
        const dl = document.getElementById('roster-' + teamKey);
        if (!dl) return;
        dl.innerHTML = '';
        if (!teamName) return;
        const team = cachedTeams.find(t => t.name && t.name.trim().toLowerCase() === teamName.trim().toLowerCase());
        if (!team) return;
        for (const p of team.players) {
            if (!p.name || !p.name.trim()) continue;
            const opt = document.createElement('option');
            opt.value = p.name;
            dl.appendChild(opt);
        }
    }

    function handleTeamNameChange(teamKey) {
        const teamData = teamKey === 'away' ? game.awayTeam : game.homeTeam;
        const inputEl = teamKey === 'away' ? document.getElementById('away-team-name') : document.getElementById('home-team-name');
        const newName = inputEl.value.trim();

        teamData.name = inputEl.value;

        // Check if name matches a saved team — auto-fill lineup
        const match = cachedTeams.find(t => t.name && t.name.trim().toLowerCase() === newName.toLowerCase());
        if (match) {
            teamData.teamId = match.id;
            for (let i = 0; i < PLAYER_COUNT && i < match.players.length; i++) {
                teamData.players[i] = { ...match.players[i] };
            }
        }

        populateRosterDatalist(teamKey, newName);
        persistCurrentGame();
        renderAll();
    }

    // ---- DOM References ----
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const awayGrid = $('#away-grid');
    const homeGrid = $('#home-grid');
    const awayTotals = $('#away-totals');
    const homeTotals = $('#home-totals');
    const awayTeamName = $('#away-team-name');
    const homeTeamName = $('#home-team-name');

    // Modal
    const playModal = $('#play-modal');
    const modalTitle = $('#modal-title');
    const modalDiamondPreview = $('#modal-diamond-preview');
    const resultButtons = $$('#play-result-buttons .play-btn');
    // Sub-option checkboxes for out results
    const optBackwardK = $('#opt-backward-k');
    const optSacBunt = $('#opt-sac-bunt');
    const optLineOut = $('#opt-line-out');
    const optSacFly = $('#opt-sac-fly');
    const fielderButtons = $$('#fielder-buttons .fielder-btn');
    const fielderNotationDisplay = $('#fielder-notation-display');
    const clearFieldersBtn = $('#clear-fielders');
    const baseCheckboxes = {
        first: $('#base-1st'),
        second: $('#base-2nd'),
        third: $('#base-3rd'),
        home: $('#base-home')
    };
    const outButtons = $$('.out-num-btn, .out-num-btn-sm');
    const rbiDisplay = $('#rbi-display');
    const playNotes = $('#play-notes');

    // New Game modal
    const newGameModal = $('#new-game-modal');

    // Runner modal
    const runnerModal = $('#runner-modal');
    const runnerModalTitle = $('#runner-modal-title');
    const runnerRowsContainer = $('#runner-rows');

    // Pending play data (stored while runner modal is open)
    let pendingPlay = null;
    let pendingRunnerChoices = []; // { playerIdx, startBase, endBase, out }

    // Spray chart controls (slider/buttons removed — now click-and-drag)
    const sprayClearBtn = $('#spray-clear');

    // Pitch phase controls
    const pitchPhase = $('#pitch-phase');
    const resultPhase = $('#result-phase');
    const resultPhaseFooter = $('#result-phase-footer');
    const strikeZoneContainer = $('#strike-zone-container');
    const pitchSelectedZone = $('#pitch-selected-zone');
    const pitchLog = $('#pitch-log');
    const countBalls = $('#count-balls');
    const countStrikes = $('#count-strikes');
    const handButtons = $$('.hand-btn');
    const pitchTypeButtons = $$('#pitch-type-buttons .pitch-type-btn');
    const pitchOutcomeButtons = $$('#pitch-outcome-buttons .pitch-outcome-btn');

    // ---- Current edit state ----
    let editState = {
        team: null,
        playerIdx: null,
        inning: null,
        result: null,
        fielders: [],
        bases: emptyBases(),
        outNumber: 0,
        rbiCount: 0,
        notes: '',
        sprayChart: null,
        pitches: [],
        currentZone: null,
        currentPitchX: null,
        currentPitchY: null,
        currentPitchType: 'FB',
        batterHand: 'R'
    };

    // ---- Mobile: Hamburger toggle ----
    const navToggle = $('#nav-toggle');
    const navActions = $('#site-nav-actions');
    if (navToggle && navActions) {
        navToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            navActions.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!navActions.contains(e.target) && e.target !== navToggle) {
                navActions.classList.remove('open');
            }
        });
    }

    // ---- Active cell tracking (tap-to-select on touch) ----
    // First tap selects a cell (makes it editable), second tap opens modal.
    // Non-active cells allow scrolling; only active cell captures touch for drag.
    let activeCell = null;
    let zoomBtn = null; // set by initMobileZoom

    // Drag handlers for the active cell (spray chart)
    let activeDragState = null;
    let activeSuppressClick = false;
    let activeDragHandlers = null;

    function attachDragHandlers(cell) {
        const team = cell.dataset.team;
        const pIdx = parseInt(cell.dataset.playerIdx, 10);
        const inning = parseInt(cell.dataset.inn, 10);

        function onPointerDown(e) {
            const target = e.target;
            if ((target.tagName === 'text' && target.hasAttribute('data-quick-result')) ||
                target.hasAttribute('data-base-click') ||
                target.hasAttribute('data-quick-pitch')) {
                return;
            }
            const svg = cell.querySelector('svg');
            if (!svg) return;
            e.preventDefault();
            cell.setPointerCapture(e.pointerId);
            const rect = svg.getBoundingClientRect();
            // CSS zoom scales getBoundingClientRect but not clientX/clientY
            const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
            const vbX = (e.clientX * zoom - rect.left) * (64 / rect.width);
            const vbY = (e.clientY * zoom - rect.top) * (64 / rect.height);
            activeDragState = { startX: e.clientX, startY: e.clientY, vbX, vbY, dragged: false };
        }

        function onPointerMove(e) {
            if (!activeDragState) return;
            const dx = e.clientX - activeDragState.startX;
            const dy = e.clientY - activeDragState.startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                activeDragState.dragged = true;
            }
            if (activeDragState.dragged) {
                const deltaY = activeDragState.startY - e.clientY;
                let style, slider;
                if (deltaY > 5) {
                    style = 'air'; slider = Math.min(100, Math.round((deltaY - 5) * 1.5));
                } else if (deltaY < -5) {
                    style = 'ground'; slider = Math.min(100, Math.round((-deltaY - 5) * 1.5));
                } else {
                    style = 'ground'; slider = 0;
                }
                const abPreview = getAtBat(team, pIdx, inning) || {};
                const previewData = { ...abPreview, sprayChart: { endX: activeDragState.vbX, endY: activeDragState.vbY, slider, style } };
                const container = cell.querySelector('.diamond-container');
                if (container) {
                    container.innerHTML = '';
                    container.appendChild(Diamond.render(previewData));
                }
            }
        }

        function onPointerUp(e) {
            if (!activeDragState) return;
            const wasDrag = activeDragState.dragged;
            if (wasDrag) {
                const deltaY = activeDragState.startY - e.clientY;
                let style, slider;
                if (deltaY > 5) {
                    style = 'air'; slider = Math.min(100, Math.round((deltaY - 5) * 1.5));
                } else if (deltaY < -5) {
                    style = 'ground'; slider = Math.min(100, Math.round((-deltaY - 5) * 1.5));
                } else {
                    style = 'ground'; slider = 0;
                }
                const ab = getAtBat(team, pIdx, inning) || {};
                ab.sprayChart = { endX: activeDragState.vbX, endY: activeDragState.vbY, slider, style };
                setAtBat(team, pIdx, inning, ab);
                renderAll();
            }
            if (wasDrag) activeSuppressClick = true;
            activeDragState = null;
        }

        cell.addEventListener('pointerdown', onPointerDown);
        cell.addEventListener('pointermove', onPointerMove);
        cell.addEventListener('pointerup', onPointerUp);

        activeDragHandlers = { cell, onPointerDown, onPointerMove, onPointerUp };
    }

    function detachDragHandlers() {
        if (activeDragHandlers) {
            const { cell, onPointerDown, onPointerMove, onPointerUp } = activeDragHandlers;
            cell.removeEventListener('pointerdown', onPointerDown);
            cell.removeEventListener('pointermove', onPointerMove);
            cell.removeEventListener('pointerup', onPointerUp);
            activeDragHandlers = null;
        }
        activeDragState = null;
    }

    function setActiveCell(cell) {
        if (activeCell && activeCell !== cell) {
            activeCell.classList.remove('cell-active');
            detachDragHandlers();
        }
        activeCell = cell;
        if (cell) {
            cell.classList.add('cell-active');
            attachDragHandlers(cell);
            // Auto-zoom on mobile when selecting a cell
            if ('ontouchstart' in window && zoomBtn && !document.body.classList.contains('scorebook-zoomed')) {
                zoomBtn.click();
            }
        }
        if (zoomBtn) zoomBtn.classList.toggle('zoom-toggle-visible', !!cell);
    }

    let _clearingActive = false;
    function clearActiveCell() {
        if (_clearingActive) return;
        _clearingActive = true;
        if (activeCell) {
            activeCell.classList.remove('cell-active');
            detachDragHandlers();
            activeCell = null;
        }
        if (zoomBtn) zoomBtn.classList.remove('zoom-toggle-visible');
        // Auto-unzoom on mobile when clearing selection
        if ('ontouchstart' in window && document.body.classList.contains('scorebook-zoomed') && zoomBtn) {
            zoomBtn.click();
        }
        _clearingActive = false;
    }

    // Tapping outside any cell clears the selection
    document.addEventListener('click', (e) => {
        if (activeCell && !e.target.closest('.cell-inning')) {
            clearActiveCell();
        }
    });

    // Delegated click handler for all score cells (no per-cell listeners needed)
    document.addEventListener('click', (e) => {
        const cell = e.target.closest('.cell-inning:not(.header-cell)');
        if (!cell || !cell.dataset.team) return;
        if (activeSuppressClick) { activeSuppressClick = false; return; }

        const team = cell.dataset.team;
        const pIdx = parseInt(cell.dataset.playerIdx, 10);
        const inning = parseInt(cell.dataset.inn, 10);

        // Touch: first tap selects, second tap opens modal
        if ('ontouchstart' in window && activeCell !== cell) {
            e.stopPropagation();
            setActiveCell(cell);
            return;
        }

        const target = e.target;
        if (target.tagName === 'text' && target.hasAttribute('data-quick-result')) {
            e.stopPropagation();
            quickAddPlay(team, pIdx, inning, target.getAttribute('data-quick-result'));
            return;
        }
        if (target.hasAttribute('data-base-click')) {
            e.stopPropagation();
            openBaseAdvancePopup(e, team, pIdx, inning, target.getAttribute('data-base-click'));
            return;
        }
        if (target.hasAttribute('data-quick-pitch')) {
            e.stopPropagation();
            quickAddPitch(team, pIdx, inning, target.getAttribute('data-quick-pitch'));
            return;
        }
        if (target.hasAttribute('data-quick-out')) {
            e.stopPropagation();
            openQuickOutPopup(e, team, pIdx, inning);
            return;
        }
        openPlayModal(team, pIdx, inning);
    });

    // ---- Render Scorebook Grid ----
    function renderGrid(gridEl, teamKey, teamData) {
        // Remove existing player rows (keep header)
        const existingRows = gridEl.querySelectorAll('.grid-player-row');
        existingRows.forEach(r => r.remove());

        // Ensure at least PLAYER_COUNT slots exist
        while (teamData.players.length < PLAYER_COUNT) {
            teamData.players.push({ name: '', number: '', position: '' });
        }

        const playerCount = teamData.players.length;
        for (let p = 0; p < playerCount; p++) {
            const player = teamData.players[p];
            const row = document.createElement('div');
            row.className = 'grid-player-row';

            // Player number
            const numCell = document.createElement('div');
            numCell.className = 'cell cell-number';
            const numInput = document.createElement('input');
            numInput.type = 'text';
            numInput.className = 'player-number-input';
            numInput.value = player.number;
            numInput.maxLength = 3;
            numInput.setAttribute('data-team', teamKey);
            numInput.setAttribute('data-player', p);
            numInput.addEventListener('change', (e) => {
                teamData.players[p].number = e.target.value;
                persistCurrentGame();
            });
            numCell.appendChild(numInput);
            row.appendChild(numCell);

            // Player name
            const nameCell = document.createElement('div');
            nameCell.className = 'cell cell-player';
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'player-name-input';
            nameInput.value = player.name;
            nameInput.placeholder = `Player ${p + 1}`;
            nameInput.setAttribute('data-team', teamKey);
            nameInput.setAttribute('data-player', p);
            nameInput.setAttribute('list', 'roster-' + teamKey);
            nameInput.addEventListener('change', (e) => {
                teamData.players[p].name = e.target.value;
                // Auto-fill number/position if player matches a roster entry
                const team = cachedTeams.find(t => t.name && t.name.trim().toLowerCase() === (teamData.name || '').trim().toLowerCase());
                if (team) {
                    const rosterPlayer = team.players.find(r => r.name === e.target.value);
                    if (rosterPlayer) {
                        if (rosterPlayer.number) teamData.players[p].number = rosterPlayer.number;
                        if (rosterPlayer.position) teamData.players[p].position = rosterPlayer.position;
                    }
                }
                updateLinescore();
                persistCurrentGame();
                renderAll();
            });
            nameCell.appendChild(nameInput);
            row.appendChild(nameCell);

            // Position
            const posCell = document.createElement('div');
            posCell.className = 'cell cell-pos';
            const posInput = document.createElement('input');
            posInput.type = 'text';
            posInput.className = 'player-pos-input';
            posInput.value = player.position;
            posInput.maxLength = 3;
            posInput.setAttribute('data-team', teamKey);
            posInput.setAttribute('data-player', p);
            posInput.addEventListener('change', (e) => {
                teamData.players[p].position = e.target.value.toUpperCase();
                e.target.value = e.target.value.toUpperCase();
                persistCurrentGame();
            });
            posCell.appendChild(posInput);
            row.appendChild(posCell);

            // Inning cells
            for (let inn = 1; inn <= game.innings; inn++) {
                const innCell = document.createElement('div');
                innCell.className = 'cell cell-inning';
                innCell.setAttribute('data-inning', inn);
                innCell.setAttribute('data-team', teamKey);
                innCell.setAttribute('data-player', p);

                const ab = getAtBat(teamKey, p, inn);

                // Only show runner indicator on the current batter's cell
                const isCurrentBatter = !ab && p === getCurrentBatterIdx(teamKey, inn, teamData.players.length);
                let runnerState = null;
                if (isCurrentBatter) {
                    const runners = Scoring.getBaseRunners(
                        game.atBats, teamKey, inn, p, teamData.players.length
                    );
                    runnerState = {
                        first: runners.first !== null,
                        second: runners.second !== null,
                        third: runners.third !== null
                    };
                }

                if (ab) {
                    innCell.classList.add('has-play');
                    const container = document.createElement('div');
                    container.className = 'diamond-container';
                    const svg = Diamond.render(ab);
                    container.appendChild(svg);
                    innCell.appendChild(container);
                } else {
                    // Empty diamond
                    const container = document.createElement('div');
                    container.className = 'diamond-container';
                    const svg = Diamond.render(null);
                    if (runnerState) Diamond.drawRunnerIndicator(svg, runnerState);
                    container.appendChild(svg);
                    innCell.appendChild(container);
                }

                // Store cell metadata as data attributes for event delegation
                innCell.dataset.team = teamKey;
                innCell.dataset.playerIdx = p;
                innCell.dataset.inn = inn;
                row.appendChild(innCell);
            }

            // Stat cells
            const atBatsForPlayer = [];
            for (let inn = 1; inn <= game.innings; inn++) {
                atBatsForPlayer.push(getAtBat(teamKey, p, inn));
            }
            const stats = Scoring.calcPlayerStats(atBatsForPlayer);

            for (const statKey of ['ab', 'r', 'h', 'rbi', 'bb', 'so']) {
                const statCell = document.createElement('div');
                statCell.className = 'cell cell-stat';
                statCell.textContent = stats[statKey] || '';
                row.appendChild(statCell);
            }

            // Composite spray chart cell
            const sprayCell = document.createElement('div');
            sprayCell.className = 'cell cell-spray-composite';
            sprayCell.style.cursor = 'pointer';
            const sprayContainer = document.createElement('div');
            sprayContainer.className = 'diamond-container';
            sprayContainer.appendChild(Diamond.renderCompositeSpray(atBatsForPlayer));
            sprayCell.appendChild(sprayContainer);
            // Click to open lightbox with enlarged spray chart
            const playerAtBats = [...atBatsForPlayer];
            sprayCell.addEventListener('click', () => {
                openChartLightbox(Diamond.renderCompositeSpray(playerAtBats));
            });
            row.appendChild(sprayCell);

            gridEl.appendChild(row);
        }
    }

    // ---- Render Inning Totals Row ----
    function renderTotals(totalsEl, teamKey) {
        totalsEl.innerHTML = '';

        const labelCell = document.createElement('div');
        labelCell.className = 'cell cell-label';
        labelCell.textContent = 'R / H / E';
        totalsEl.appendChild(labelCell);

        const atBatMap = new Map(Object.entries(game.atBats));

        for (let inn = 1; inn <= game.innings; inn++) {
            const td = teamKey === 'away' ? game.awayTeam : game.homeTeam;
            const t = Scoring.calcInningTotals(atBatMap, teamKey, inn, td.players.length);
            const cell = document.createElement('div');
            cell.className = 'cell cell-inning';
            cell.setAttribute('data-inning', inn);
            cell.style.cursor = 'default';
            cell.style.minHeight = '28px';
            cell.style.fontSize = '0.8rem';
            cell.style.fontFamily = 'var(--font-handwriting)';
            cell.style.fontWeight = '700';

            if (t.r || t.h || t.e) {
                cell.textContent = `${t.r}-${t.h}-${t.e}`;
            }
            totalsEl.appendChild(cell);
        }

        // Empty stat cells to fill the row
        for (let i = 0; i < 6; i++) {
            const sc = document.createElement('div');
            sc.className = 'cell cell-stat';
            totalsEl.appendChild(sc);
        }
    }

    // ---- Render Linescore ----
    function updateLinescore() {
        const headerRow = $('#linescore-header');
        const awayRow = $('#linescore-away');
        const homeRow = $('#linescore-home');

        headerRow.innerHTML = '<th></th>';
        awayRow.innerHTML = '';
        homeRow.innerHTML = '';

        // Team name cells
        const awayNameCell = document.createElement('td');
        awayNameCell.className = 'linescore-team-name';
        awayNameCell.textContent = game.awayTeam.name || 'Visitors';
        awayRow.appendChild(awayNameCell);

        const homeNameCell = document.createElement('td');
        homeNameCell.className = 'linescore-team-name';
        homeNameCell.textContent = game.homeTeam.name || 'Home';
        homeRow.appendChild(homeNameCell);

        const atBatMap = new Map(Object.entries(game.atBats));
        let awayTotalR = 0, awayTotalH = 0, awayTotalE = 0;
        let homeTotalR = 0, homeTotalH = 0, homeTotalE = 0;

        for (let inn = 1; inn <= game.innings; inn++) {
            // Header
            const th = document.createElement('th');
            th.textContent = inn;
            headerRow.appendChild(th);

            // Away
            const awayPC = game.awayTeam.players.length;
            const awayT = Scoring.calcInningTotals(atBatMap, 'away', inn, awayPC);
            const awayTd = document.createElement('td');
            let awayHasPlays = false;
            for (let p = 0; p < awayPC; p++) {
                if (game.atBats[`away-${p}-${inn}`]) { awayHasPlays = true; break; }
            }
            awayTd.textContent = awayHasPlays ? awayT.r : '';
            awayRow.appendChild(awayTd);

            // Home
            const homePC = game.homeTeam.players.length;
            const homeT = Scoring.calcInningTotals(atBatMap, 'home', inn, homePC);
            let homeHasPlays = false;
            for (let p = 0; p < homePC; p++) {
                if (game.atBats[`home-${p}-${inn}`]) { homeHasPlays = true; break; }
            }
            const homeTd = document.createElement('td');
            homeTd.textContent = homeHasPlays ? homeT.r : '';
            homeRow.appendChild(homeTd);

            awayTotalR += awayT.r; awayTotalH += awayT.h; awayTotalE += awayT.e;
            homeTotalR += homeT.r; homeTotalH += homeT.h; homeTotalE += homeT.e;
        }

        // Totals columns: R, H, E
        for (const label of ['R', 'H', 'E']) {
            const th = document.createElement('th');
            th.className = 'linescore-total';
            th.textContent = label;
            headerRow.appendChild(th);
        }

        // Away totals
        for (const val of [awayTotalR, awayTotalH, awayTotalE]) {
            const td = document.createElement('td');
            td.className = 'linescore-total';
            td.textContent = val;
            awayRow.appendChild(td);
        }
        // Home totals
        for (const val of [homeTotalR, homeTotalH, homeTotalE]) {
            const td = document.createElement('td');
            td.className = 'linescore-total';
            td.textContent = val;
            homeRow.appendChild(td);
        }
    }

    // ---- Full re-render ----
    function renderAll() {
        awayTeamName.value = game.awayTeam.name;
        homeTeamName.value = game.homeTeam.name;

        // Update header inning columns if innings changed
        updateInningHeaders(awayGrid);
        updateInningHeaders(homeGrid);

        renderGrid(awayGrid, 'away', game.awayTeam);
        renderGrid(homeGrid, 'home', game.homeTeam);
        renderTotals(awayTotals, 'away');
        renderTotals(homeTotals, 'home');
        updateLinescore();

        // Pitcher sections: away batting grid shows home pitchers, and vice versa
        renderPitcherSection('away-pitcher-rows', 'home');
        renderPitcherSection('home-pitcher-rows', 'away');

        // Populate roster datalists for player name dropdowns
        populateRosterDatalist('away', game.awayTeam.name);
        populateRosterDatalist('home', game.homeTeam.name);
    }

    /**
     * Render pitcher summary rows for the given pitcher team.
     * Shows each pitcher's name, pitch count, and composite pitch chart.
     */
    function renderPitcherSection(containerId, pitcherTeam) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const teamData = pitcherTeam === 'away' ? game.awayTeam : game.homeTeam;
        const pitchers = teamData.pitchers || [];

        for (let i = 0; i < pitchers.length; i++) {
            const pitcher = pitchers[i];
            const stats = Scoring.calcPitcherStats(game.atBats, pitcherTeam, i);

            const row = document.createElement('div');
            row.className = 'pitcher-row';

            // Name input
            const nameInput = document.createElement('input');
            nameInput.className = 'pitcher-name';
            nameInput.type = 'text';
            nameInput.value = pitcher.name || '';
            nameInput.placeholder = `Pitcher ${i + 1}`;
            nameInput.addEventListener('change', () => {
                pitcher.name = nameInput.value;
                persistCurrentGame();
            });
            row.appendChild(nameInput);

            // IP display
            const ipEl = document.createElement('span');
            ipEl.className = 'pitcher-ip';
            const startInn = pitcher.startInning || 1;
            const endInn = pitcher.endInning || game.innings;
            const ip = endInn - startInn + (pitcher.endInning ? 0 : 0);
            ipEl.textContent = `${startInn}-${pitcher.endInning || ''}`;
            row.appendChild(ipEl);

            // Pitch count
            const countEl = document.createElement('div');
            countEl.className = 'pitcher-count';
            countEl.innerHTML = `<strong>${stats.totalPitches}</strong> pitches<br>` +
                `<span class="pitcher-count-detail">${stats.strikes}K / ${stats.balls}B</span>`;
            row.appendChild(countEl);

            // Composite pitch chart
            const chartEl = document.createElement('div');
            chartEl.className = 'pitcher-chart';
            chartEl.style.cursor = 'pointer';
            chartEl.appendChild(Diamond.renderCompositePitchChart(stats.allPitches));
            const pitcherPitches = [...stats.allPitches];
            chartEl.addEventListener('click', () => {
                openChartLightbox(Diamond.renderCompositePitchChart(pitcherPitches));
            });
            row.appendChild(chartEl);

            container.appendChild(row);
        }
    }

    function updateInningHeaders(gridEl) {
        const headerRow = gridEl.querySelector('.grid-header-row');
        // Remove existing inning headers
        headerRow.querySelectorAll('.cell-inning.header-cell').forEach(el => el.remove());
        // Remove existing stat headers and spray header
        const statHeaders = headerRow.querySelectorAll('.cell-stat.header-cell, .cell-spray-composite.header-cell');
        statHeaders.forEach(el => el.remove());

        // Add inning headers
        for (let inn = 1; inn <= game.innings; inn++) {
            const div = document.createElement('div');
            div.className = 'cell cell-inning header-cell';
            div.setAttribute('data-inning', inn);
            div.textContent = inn;
            headerRow.appendChild(div);
        }

        // Re-add stat headers
        for (const label of ['AB', 'R', 'H', 'RBI', 'BB', 'SO']) {
            const div = document.createElement('div');
            div.className = 'cell cell-stat header-cell';
            div.textContent = label;
            headerRow.appendChild(div);
        }

        // Spray chart composite header
        const sprayHeader = document.createElement('div');
        sprayHeader.className = 'cell cell-spray-composite header-cell';
        sprayHeader.textContent = 'Spray';
        headerRow.appendChild(sprayHeader);
    }

    // ---- Play Modal ----
    function openPlayModal(team, playerIdx, inning) {
        const teamData = getTeamData(team);
        const playerName = teamData.players[playerIdx].name || `Player ${playerIdx + 1}`;
        const teamName = teamData.name || (team === 'away' ? 'Visitors' : 'Home');

        modalTitle.textContent = `${playerName} — ${teamName} — Inning ${inning}`;

        // Load existing at-bat or defaults
        const existing = getAtBat(team, playerIdx, inning);
        editState = {
            team,
            playerIdx,
            inning,
            result: existing ? existing.result : null,
            fielders: existing && existing.fielderNotation ? parseFielderNotation(existing.fielderNotation) : [],
            bases: existing ? { ...existing.bases } : emptyBases(),
            outNumber: existing ? existing.outNumber : 0,
            rbiCount: existing ? existing.rbiCount : 0,
            notes: existing ? (existing.notes || '') : '',
            sprayChart: existing && existing.sprayChart ? { ...existing.sprayChart } : null,
            pitches: existing && existing.pitches ? existing.pitches.map(p => ({ ...p })) : [],
            currentZone: null,
            currentPitchX: null,
            currentPitchY: null,
            currentPitchType: 'FB',
            batterHand: existing && existing.batterHand ? existing.batterHand : 'R'
        };

        // Show pitch phase first
        showPitchPhase();
        renderStrikeZone();
        renderPitchLog();
        updateCountDisplay();
        syncPitchControls();

        syncModalUI();
        playModal.hidden = false;
        document.body.classList.add('modal-open');
    }

    function parseFielderNotation(notation) {
        if (!notation) return [];
        return notation.split('-').map(n => parseInt(n, 10)).filter(n => !isNaN(n));
    }

    function closePlayModal() {
        playModal.hidden = true;
        document.body.classList.remove('modal-open');
    }

    function syncModalUI() {
        // Result buttons — map derivative results back to their parent button
        const resultForBtn = {
            'KL': 'K',   // backward K maps to K button
            'SAC': 'GO', // sac bunt maps to GO button
            'LO': 'FO',  // line out maps to FO button
            'SF': 'FO'   // sac fly maps to FO button
        };
        const activeBtn = resultForBtn[editState.result] || editState.result;
        resultButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.result === activeBtn);
        });

        // Fielder buttons
        fielderButtons.forEach(btn => {
            btn.classList.toggle('active', editState.fielders.includes(parseInt(btn.dataset.pos, 10)));
        });

        // Fielder notation display
        fielderNotationDisplay.textContent = editState.fielders.join('-');

        // Base checkboxes
        baseCheckboxes.first.checked = editState.bases.first;
        baseCheckboxes.second.checked = editState.bases.second;
        baseCheckboxes.third.checked = editState.bases.third;
        baseCheckboxes.home.checked = editState.bases.home;

        // Out buttons
        outButtons.forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.out, 10) === editState.outNumber);
        });

        // RBI
        rbiDisplay.textContent = editState.rbiCount;

        // Sub-option checkboxes — set checked state
        optBackwardK.checked = editState.result === 'KL';
        optSacBunt.checked = editState.result === 'SAC';
        optLineOut.checked = editState.result === 'LO';
        optSacFly.checked = editState.result === 'SF';

        // Show sub-options only when parent out button is active
        document.querySelectorAll('.out-btn-with-options').forEach(wrapper => {
            const btn = wrapper.querySelector('.play-btn');
            const isActive = btn && btn.classList.contains('active');
            wrapper.querySelectorAll('.out-sub-option').forEach(opt => {
                opt.style.display = isActive ? '' : 'none';
            });
        });

        // Notes
        playNotes.value = editState.notes;

        // Preview diamond
        updateModalPreview();
    }

    function updateModalPreview() {
        modalDiamondPreview.innerHTML = '';
        const notation = editState.fielders.length > 0 ? editState.fielders.join('-') : '';
        const displayNotation = Scoring.buildNotation(editState.result, notation);
        const atBatData = {
            result: editState.result,
            fielderNotation: displayNotation,
            bases: editState.bases,
            outNumber: editState.outNumber,
            rbiCount: editState.rbiCount,
            sprayChart: editState.sprayChart
        };
        const interactive = Diamond.renderInteractive(atBatData, (x, y, slider, style, isPreview) => {
            editState.sprayChart = { endX: x, endY: y, slider, style };
            updateModalPreview();
        });
        modalDiamondPreview.appendChild(interactive);
    }

    function savePlay() {
        const notation = editState.fielders.length > 0 ? editState.fielders.join('-') : '';
        const displayNotation = Scoring.buildNotation(editState.result, notation);

        if (!editState.result && !notation) {
            clearAtBat(editState.team, editState.playerIdx, editState.inning);
            closePlayModal();
            renderAll();
            return;
        }

        // Build the at-bat data
        const pInfo = getPitcherInfo(editState.team);
        const playData = {
            result: editState.result,
            fielderNotation: displayNotation,
            bases: { ...editState.bases },
            outNumber: editState.outNumber,
            rbiCount: editState.rbiCount,
            notes: editState.notes,
            sprayChart: editState.sprayChart ? { ...editState.sprayChart } : null,
            pitches: editState.pitches.map(p => ({ ...p })),
            count: Scoring.calcCount(editState.pitches),
            batterHand: editState.batterHand,
            runnerAdvancements: [],
            pitcherInfo: pInfo
        };

        // Check for runners on base
        const editTeamData = getTeamData(editState.team);
        const runners = Scoring.getBaseRunners(
            game.atBats, editState.team, editState.inning,
            editState.playerIdx, editTeamData.players.length
        );

        const anyRunners = runners.first !== null || runners.second !== null || runners.third !== null;

        if (!anyRunners) {
            // No runners — save directly
            setAtBat(editState.team, editState.playerIdx, editState.inning, playData);
            closePlayModal();
            renderAll();
            return;
        }

        // Resolve runner advancements
        const { advancements, ambiguousRunners } = Scoring.resolveRunnerAdvancements(
            editState.result, runners
        );

        if (ambiguousRunners.length === 0) {
            // All unambiguous — auto-apply and save
            playData.runnerAdvancements = advancements;
            applyRunnerAdvancements(playData, advancements);
            setAtBat(editState.team, editState.playerIdx, editState.inning, playData);
            closePlayModal();
            renderAll();
            return;
        }

        // Has ambiguous runners — show runner modal
        pendingPlay = playData;
        pendingPlay.runnerAdvancements = [...advancements]; // start with auto ones

        // Initialize choices: auto-advanced runners are pre-set,
        // ambiguous runners default to "hold"
        pendingRunnerChoices = [];
        for (const adv of advancements) {
            pendingRunnerChoices.push({ ...adv });
        }
        for (const runner of ambiguousRunners) {
            pendingRunnerChoices.push({
                playerIdx: runner.playerIdx,
                startBase: runner.startBase,
                endBase: runner.startBase, // default: hold
                out: false
            });
        }

        closePlayModal();
        openRunnerModal(ambiguousRunners, advancements);
    }

    /**
     * Quick-add a play from the grid cell without opening the modal.
     * Handles BB, 1B, 2B, 3B, HR — sets bases and result, then saves.
     */
    /**
     * Quick-add/cycle pitches from clicking the count boxes on the score sheet.
     * Cycles:
     *   Strike: 0 → 1 → 2 → KL (out) → K (out) → 0 (reset all strikes)
     *   Ball:   0 → 1 → 2 → 3 → BB → 0 (reset all balls)
     */
    function quickAddPitch(team, playerIdx, inning, type) {
        let ab = getAtBat(team, playerIdx, inning);

        // Get or create at-bat
        if (!ab) {
            ab = createEmptyAtBat(team);
        }

        if (!ab.pitches) ab.pitches = [];
        const currentCount = Scoring.calcCount(ab.pitches);

        if (type === 'strike') {
            if (ab.result === 'KL') {
                // KL → K (swinging strikeout)
                ab.result = 'K';
                ab.bases = Scoring.defaultBasesForResult('K');
            } else if (ab.result === 'K') {
                // K → 0 strikes (remove all strike pitches, clear result)
                ab.pitches = ab.pitches.filter(p => !['CS', 'SS', 'F'].includes(p.outcome));
                ab.result = null;
                ab.fielderNotation = '';
                ab.bases = emptyBases();
                ab.outNumber = 0;
            } else if (currentCount.strikes >= 2) {
                // 2 strikes → 3rd strike → KL
                ab.pitches.push({
                    number: ab.pitches.length + 1,
                    pitchX: null, pitchY: null,
                    zone: 'strike', type: 'FB', outcome: 'CS', missedCall: false
                });
                ab.result = 'KL';
                ab.bases = Scoring.defaultBasesForResult('KL');
                const currentOuts = countOutsInInning(team, inning);
                ab.outNumber = Math.min(currentOuts + 1, 3);
            } else {
                // 0 or 1 → add a strike
                ab.pitches.push({
                    number: ab.pitches.length + 1,
                    pitchX: null, pitchY: null,
                    zone: 'strike', type: 'FB', outcome: 'CS', missedCall: false
                });
            }
        } else {
            // Ball
            if (ab.result === 'BB') {
                // BB → 0 balls (remove all ball pitches, clear result)
                ab.pitches = ab.pitches.filter(p => p.outcome !== 'B');
                ab.result = null;
                ab.fielderNotation = '';
                ab.bases = emptyBases();
            } else if (currentCount.balls >= 3) {
                // 3 balls → 4th ball → BB
                ab.pitches.push({
                    number: ab.pitches.length + 1,
                    pitchX: null, pitchY: null,
                    zone: 'ball', type: 'FB', outcome: 'B', missedCall: false
                });
                ab.result = 'BB';
                ab.bases = Scoring.defaultBasesForResult('BB');
            } else {
                // 0-2 → add a ball
                ab.pitches.push({
                    number: ab.pitches.length + 1,
                    pitchX: null, pitchY: null,
                    zone: 'ball', type: 'FB', outcome: 'B', missedCall: false
                });
            }
        }

        // Renumber pitches and update count
        ab.pitches.forEach((p, i) => p.number = i + 1);
        ab.count = Scoring.calcCount(ab.pitches);

        // Clean up empty at-bats (no pitches, no result)
        if (ab.pitches.length === 0 && !ab.result) {
            clearAtBat(team, playerIdx, inning);
        } else {
            setAtBat(team, playerIdx, inning, ab);
        }
        renderAll();
    }

    function quickAddPlay(team, playerIdx, inning, result) {
        // Toggle off: if this result is already set, clear the play
        const existing = getAtBat(team, playerIdx, inning);
        if (existing && existing.result === result) {
            clearAtBat(team, playerIdx, inning);
            renderAll();
            return;
        }

        const basesMap = {
            'BB':  { first: true, second: false, third: false, home: false },
            '1B':  { first: true, second: false, third: false, home: false },
            '2B':  { first: false, second: true, third: false, home: false },
            '3B':  { first: false, second: false, third: true, home: false },
            'HR':  { first: false, second: false, third: false, home: true }
        };

        const bases = basesMap[result] || emptyBases();

        const playData = createEmptyAtBat(team);
        playData.result = result;
        playData.bases = bases;
        playData.rbiCount = result === 'HR' ? 1 : 0;

        // Check for existing runners
        const qaTeamData = getTeamData(team);
        const runners = Scoring.getBaseRunners(
            game.atBats, team, inning, playerIdx, qaTeamData.players.length
        );
        const anyRunners = runners.first !== null || runners.second !== null || runners.third !== null;

        if (!anyRunners) {
            setAtBat(team, playerIdx, inning, playData);
            renderAll();
            return;
        }

        // Resolve runner advancements
        const { advancements, ambiguousRunners } = Scoring.resolveRunnerAdvancements(result, runners);

        if (ambiguousRunners.length === 0) {
            playData.runnerAdvancements = advancements;
            // Need to set editState temporarily for applyRunnerAdvancements
            const savedEditState = { ...editState };
            editState.team = team;
            editState.playerIdx = playerIdx;
            editState.inning = inning;
            applyRunnerAdvancements(playData, advancements);
            editState = savedEditState;
            setAtBat(team, playerIdx, inning, playData);
            renderAll();
            return;
        }

        // Ambiguous — fall back to full modal
        openPlayModal(team, playerIdx, inning);
    }

    // ---- Base Advance Popup (click base on score sheet) ----

    const baseAdvPopup = document.getElementById('base-advance-popup');
    const baseAdvTitle = document.getElementById('base-advance-title');
    const baseAdvCancel = document.getElementById('base-advance-cancel');
    const baseAdvFielders = document.getElementById('base-adv-fielders');
    const baseAdvNotationDisplay = document.getElementById('base-adv-notation-display');
    const baseAdvNotationClear = document.getElementById('base-adv-notation-clear');
    const baseAdvConfirm = document.getElementById('base-adv-confirm');
    const baseAdvDpBtn = document.getElementById('base-adv-dp');
    const baseAdvTpBtn = document.getElementById('base-adv-tp');
    const baseAdvReachedSection = document.getElementById('base-adv-reached');
    let baseAdvState = null; // { team, playerIdx, inning, baseName, reason?, isOut?, fielders?, dpTag? }

    function openBaseAdvancePopup(event, team, playerIdx, inning, baseName) {
        const baseLabels = { first: '1st Base', second: '2nd Base', third: '3rd Base', home: 'Home (Scored)' };
        baseAdvTitle.textContent = `→ ${baseLabels[baseName] || baseName}`;
        baseAdvState = { team, playerIdx, inning, baseName, reason: null, isOut: false, fielders: [], dpTag: null };

        // Reset: show reason buttons, hide fielder step
        baseAdvFielders.hidden = true;
        baseAdvPopup.querySelectorAll('.base-advance-options, .base-adv-section-label').forEach(el => el.style.display = '');
        baseAdvNotationDisplay.textContent = '';
        baseAdvDpBtn.classList.remove('active');
        baseAdvTpBtn.classList.remove('active');

        // Show "Reached Base" section only when clicking 1st base
        // (HBP, Dropped 3rd Strike, CI, Error — batter reaching base)
        if (baseName === 'first') {
            baseAdvReachedSection.style.display = '';

            // Show/hide D3S based on whether the play has a K result
            const ab = getAtBat(team, playerIdx, inning);
            const d3sBtn = baseAdvReachedSection.querySelector('[data-reached="D3S"]');
            if (d3sBtn) {
                d3sBtn.style.display = (ab && (ab.result === 'K' || ab.result === 'KL')) ? '' : 'none';
            }
        } else {
            baseAdvReachedSection.style.display = 'none';
        }

        const popup = baseAdvPopup;
        popup.hidden = false;
        const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
        const px = (event.clientX + 8) * zoom;
        const py = (event.clientY - 40) * zoom;
        popup.style.left = Math.min(px, window.innerWidth * zoom - 200) + 'px';
        popup.style.top = Math.max(py, 4) + 'px';
    }

    function closeBaseAdvancePopup() {
        baseAdvPopup.hidden = true;
        baseAdvState = null;
    }

    baseAdvCancel.addEventListener('click', closeBaseAdvancePopup);

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
        if (!baseAdvPopup.hidden && !baseAdvPopup.contains(e.target) && !e.target.hasAttribute('data-base-click')) {
            closeBaseAdvancePopup();
        }
    });

    // ---- Quick Out Popup ----
    const quickOutPopup = $('#quick-out-popup');
    const quickOutFielders = $('#quick-out-fielders');
    const quickOutNotation = $('#quick-out-notation');
    let quickOutState = null;

    function openQuickOutPopup(event, team, playerIdx, inning) {
        quickOutState = { team, playerIdx, inning, outType: null, fielders: [] };
        quickOutFielders.hidden = true;
        quickOutNotation.textContent = '';
        quickOutPopup.querySelectorAll('.quick-out-btn').forEach(b => b.classList.remove('active'));

        quickOutPopup.hidden = false;
        const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
        const px = (event.clientX + 8) * zoom;
        const py = (event.clientY - 40) * zoom;
        quickOutPopup.style.left = Math.min(px, window.innerWidth * zoom - 200) + 'px';
        quickOutPopup.style.top = Math.max(py, 4) + 'px';
    }

    function closeQuickOutPopup() {
        quickOutPopup.hidden = true;
        quickOutState = null;
    }

    // Out type selection
    quickOutPopup.querySelectorAll('.quick-out-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!quickOutState) return;
            quickOutState.outType = btn.dataset.outType;
            quickOutPopup.querySelectorAll('.quick-out-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Show fielder selection
            quickOutState.fielders = [];
            quickOutNotation.textContent = '';
            quickOutFielders.hidden = false;
            quickOutFielders.querySelectorAll('.quick-out-pos-btn').forEach(b => b.classList.remove('active'));
        });
    });

    // Fielder position buttons
    quickOutPopup.querySelectorAll('.quick-out-pos-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!quickOutState) return;
            const pos = parseInt(btn.dataset.pos, 10);
            quickOutState.fielders.push(pos);
            btn.classList.add('active');
            quickOutNotation.textContent = quickOutState.fielders.join('-');
        });
    });

    // Clear fielder notation
    $('#quick-out-notation-clear').addEventListener('click', () => {
        if (!quickOutState) return;
        quickOutState.fielders = [];
        quickOutNotation.textContent = '';
        quickOutFielders.querySelectorAll('.quick-out-pos-btn').forEach(b => b.classList.remove('active'));
    });

    // Confirm quick out
    $('#quick-out-confirm').addEventListener('click', () => {
        if (!quickOutState || !quickOutState.outType) return;
        const { team, playerIdx, inning, outType, fielders } = quickOutState;
        const ab = getAtBat(team, playerIdx, inning) || {};
        ab.result = outType;
        const notation = fielders.length > 0 ? fielders.join('-') : '';
        ab.fielderNotation = Scoring.buildNotation(outType, notation);
        // Auto-assign next out number
        const nextOut = countOutsInInning(team, inning) + 1;
        ab.outNumber = Math.min(nextOut, 3);
        // Half-line toward 1st (batter didn't reach)
        ab.bases = ab.bases || emptyBases();
        setAtBat(team, playerIdx, inning, ab);
        closeQuickOutPopup();
        renderAll();
    });

    $('#quick-out-cancel').addEventListener('click', closeQuickOutPopup);

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
        if (!quickOutPopup.hidden && !quickOutPopup.contains(e.target) && !e.target.hasAttribute('data-quick-out')) {
            closeQuickOutPopup();
        }
    });

    /**
     * Count existing outs in an inning to auto-assign the next out number.
     */
    /**
     * Find the current batter index for an inning — the first player
     * in the batting order without a completed at-bat (has a result).
     * Returns -1 if all players have batted (inning complete).
     */
    function getCurrentBatterIdx(team, inning, playerCount) {
        for (let p = 0; p < playerCount; p++) {
            const ab = getAtBat(team, p, inning);
            if (!ab || !ab.result) return p;
        }
        return -1; // all have batted
    }

    function countOutsInInning(team, inning) {
        let outs = 0;
        const teamData = getTeamData(team);
        const pc = teamData.players.length;
        for (let p = 0; p < pc; p++) {
            const ab = getAtBat(team, p, inning);
            if (!ab) continue;
            // Count plate appearance outs
            if (ab.outNumber && ab.outNumber >= 1) outs++;
            // Count base-running outs
            if (ab.baseRunOuts) {
                for (const outInfo of Object.values(ab.baseRunOuts)) {
                    if (outInfo.out) outs++;
                }
            }
        }
        return outs;
    }

    function applyBaseAdvance() {
        if (!baseAdvState) return;
        const { team, playerIdx, inning, baseName, reason, isOut, fielders, dpTag } = baseAdvState;

        let ab = getAtBat(team, playerIdx, inning);
        if (!ab) {
            ab = createEmptyAtBat(team);
            ab.result = reason;
        }

        const baseOrder = ['first', 'second', 'third', 'home'];
        const targetIdx = baseOrder.indexOf(baseName);

        if (isOut) {
            // Mark bases up to the PREVIOUS base only
            for (let i = 0; i < targetIdx; i++) {
                ab.bases[baseOrder[i]] = true;
            }
            // Auto-assign next out number
            const currentOuts = countOutsInInning(team, inning);
            const outNum = Math.min(currentOuts + 1, 3);

            if (!ab.baseRunOuts) ab.baseRunOuts = {};
            const notation = fielders.length > 0 ? fielders.join('-') : '';
            ab.baseRunOuts[baseName] = { reason, out: true, fielders: notation, outNumber: outNum, dpTag: dpTag || null };

            // Also set the outNumber on the at-bat so the circled number draws
            ab.outNumber = outNum;

            // Store dpTag on the at-bat itself for rendering
            if (dpTag) ab.dpTag = dpTag;
        } else {
            for (let i = 0; i <= targetIdx; i++) {
                ab.bases[baseOrder[i]] = true;
            }
        }

        // Store the advancement reason label (with fielder notation and DP/TP tag)
        if (!ab.advanceReasons) ab.advanceReasons = {};
        let label = reason;
        if (isOut && fielders.length > 0) label = `${reason} ${fielders.join('-')}`;
        if (dpTag) label = `${dpTag} ${label}`;
        ab.advanceReasons[baseName] = label;

        setAtBat(team, playerIdx, inning, ab);
        closeBaseAdvancePopup();
        renderAll();
    }

    // Handle "Reached Base" button clicks (HBP, D3S, CI, E)
    baseAdvPopup.addEventListener('click', (e) => {
        const reachedBtn = e.target.closest('.base-adv-reached-btn');
        if (!reachedBtn || !baseAdvState) return;

        const reached = reachedBtn.getAttribute('data-reached');
        const { team, playerIdx, inning } = baseAdvState;

        let ab = getAtBat(team, playerIdx, inning);
        if (!ab) {
            ab = createEmptyAtBat(team);
        }

        if (reached === 'HBP') {
            ab.result = 'HBP';
            ab.bases = { first: true, second: false, third: false, home: false };
            ab.outNumber = 0;
        } else if (reached === 'D3S') {
            // Dropped 3rd strike: keep K/KL result, remove out, reach 1st
            // Result stays as K or KL
            ab.bases.first = true;
            ab.outNumber = 0;
            if (!ab.advanceReasons) ab.advanceReasons = {};
            ab.advanceReasons['first'] = 'D3S';
        } else if (reached === 'CI') {
            ab.result = 'CI';
            ab.bases = { first: true, second: false, third: false, home: false };
            ab.outNumber = 0;
        } else if (reached === 'E') {
            ab.result = 'E';
            ab.bases = { first: true, second: false, third: false, home: false };
            ab.outNumber = 0;
        }

        ab.count = Scoring.calcCount(ab.pitches || []);
        setAtBat(team, playerIdx, inning, ab);

        // Handle runner advancement for plays that put batter on base
        if (reached !== 'D3S') {
            const baTeamData = getTeamData(team);
            const runners = Scoring.getBaseRunners(game.atBats, team, inning, playerIdx, baTeamData.players.length);
            const anyRunners = runners.first !== null || runners.second !== null || runners.third !== null;
            if (anyRunners) {
                const { advancements, ambiguousRunners } = Scoring.resolveRunnerAdvancements(ab.result, runners);
                if (ambiguousRunners.length > 0) {
                    editState.team = team;
                    editState.playerIdx = playerIdx;
                    editState.inning = inning;
                    pendingPlay = ab;
                    pendingRunnerChoices = [];
                    for (const adv of advancements) pendingRunnerChoices.push({ ...adv });
                    for (const runner of ambiguousRunners) {
                        pendingRunnerChoices.push({
                            playerIdx: runner.playerIdx, startBase: runner.startBase,
                            endBase: runner.startBase, out: false
                        });
                    }
                    closeBaseAdvancePopup();
                    openRunnerModal(ambiguousRunners, advancements);
                    return;
                } else if (advancements.length > 0) {
                    const savedEditState = { ...editState };
                    editState.team = team;
                    editState.playerIdx = playerIdx;
                    editState.inning = inning;
                    applyRunnerAdvancements(ab, advancements);
                    editState = savedEditState;
                }
            }
        }

        closeBaseAdvancePopup();
        renderAll();
        return; // Don't fall through to the regular handler
    });

    // Handle advancement reason button clicks
    baseAdvPopup.addEventListener('click', (e) => {
        const btn = e.target.closest('.base-adv-btn:not(.base-adv-reached-btn)');
        if (!btn || !baseAdvState) return;

        const reason = btn.getAttribute('data-reason');
        const isOut = btn.getAttribute('data-out') === 'true';

        baseAdvState.reason = reason;
        baseAdvState.isOut = isOut;
        baseAdvState.fielders = [];

        if (isOut) {
            // Show fielder step — hide reason buttons
            baseAdvPopup.querySelectorAll('.base-advance-options, .base-adv-section-label').forEach(el => el.style.display = 'none');
            baseAdvFielders.hidden = false;
            baseAdvNotationDisplay.textContent = reason;
            // Reset position button highlights
            baseAdvFielders.querySelectorAll('.base-adv-pos-btn').forEach(b => b.classList.remove('active'));
        } else {
            // Safe advancement — apply immediately
            applyBaseAdvance();
        }
    });

    // Fielder position button clicks in the popup
    baseAdvFielders.addEventListener('click', (e) => {
        const posBtn = e.target.closest('.base-adv-pos-btn');
        if (!posBtn || !baseAdvState) return;

        const pos = parseInt(posBtn.dataset.pos, 10);
        baseAdvState.fielders.push(pos);
        posBtn.classList.add('active');
        baseAdvNotationDisplay.textContent = `${baseAdvState.reason} ${baseAdvState.fielders.join('-')}`;
    });

    // Clear fielder notation
    baseAdvNotationClear.addEventListener('click', () => {
        if (!baseAdvState) return;
        baseAdvState.fielders = [];
        baseAdvNotationDisplay.textContent = baseAdvState.reason || '';
        baseAdvFielders.querySelectorAll('.base-adv-pos-btn').forEach(b => b.classList.remove('active'));
    });

    // DP/TP toggle buttons
    baseAdvDpBtn.addEventListener('click', () => {
        if (!baseAdvState) return;
        if (baseAdvState.dpTag === 'DP') {
            baseAdvState.dpTag = null;
            baseAdvDpBtn.classList.remove('active');
        } else {
            baseAdvState.dpTag = 'DP';
            baseAdvDpBtn.classList.add('active');
            baseAdvTpBtn.classList.remove('active');
        }
    });

    baseAdvTpBtn.addEventListener('click', () => {
        if (!baseAdvState) return;
        if (baseAdvState.dpTag === 'TP') {
            baseAdvState.dpTag = null;
            baseAdvTpBtn.classList.remove('active');
        } else {
            baseAdvState.dpTag = 'TP';
            baseAdvTpBtn.classList.add('active');
            baseAdvDpBtn.classList.remove('active');
        }
    });

    // Confirm out with fielders
    baseAdvConfirm.addEventListener('click', () => {
        applyBaseAdvance();
    });

    /**
     * Apply runner advancements to previous batters' at-bat data.
     * Updates their bases{} to reflect where they ended up.
     */
    function applyRunnerAdvancements(playData, advancements) {
        for (const adv of advancements) {
            const runnerAb = getAtBat(editState.team, adv.playerIdx, editState.inning);
            if (!runnerAb) continue;

            if (adv.out) {
                // Runner was thrown out — mark with out detail on their at-bat
                const outNum = countOutsInInning(editState.team, editState.inning) + 1;

                if (!runnerAb.baseRunOuts) runnerAb.baseRunOuts = {};
                runnerAb.baseRunOuts[adv.endBase] = {
                    reason: adv.outReason || 'TOB',
                    out: true,
                    fielders: adv.outFielders || '',
                    outNumber: Math.min(outNum, 3),
                    dpTag: adv.dpTag || null
                };
                runnerAb.outNumber = Math.min(outNum, 3);
                if (adv.dpTag) runnerAb.dpTag = adv.dpTag;

                // Build advance reason label
                let label = adv.outReason || 'TOB';
                if (adv.outFielders) label += ` ${adv.outFielders}`;
                if (adv.dpTag) label = `${adv.dpTag} ${label}`;
                if (!runnerAb.advanceReasons) runnerAb.advanceReasons = {};
                runnerAb.advanceReasons[adv.endBase] = label;

                setAtBat(editState.team, adv.playerIdx, editState.inning, runnerAb);
                continue;
            }

            // Update the runner's diamond to show they advanced
            const newBases = { ...runnerAb.bases };
            const baseOrder = Scoring.BASE_ORDER;
            const endIdx = baseOrder.indexOf(adv.endBase);
            for (let i = 0; i <= endIdx && i < baseOrder.length; i++) {
                newBases[baseOrder[i]] = true;
            }

            runnerAb.bases = newBases;
            setAtBat(editState.team, adv.playerIdx, editState.inning, runnerAb);
        }

        // Auto-count RBIs: count runners who scored
        let runnersScored = 0;
        for (const adv of advancements) {
            if (adv.endBase === 'home' && !adv.out) {
                runnersScored++;
            }
        }
        // Add batter's own run if HR
        const batterScored = playData.bases && playData.bases.home ? 1 : 0;
        const totalRbi = runnersScored + (playData.result === 'HR' ? 0 : 0);

        // Only auto-set RBI if user hasn't manually adjusted it
        // For HR: 1 (self) + runners. For others: just runners who scored.
        if (playData.result === 'HR') {
            playData.rbiCount = 1 + runnersScored;
        } else if (runnersScored > 0 && playData.rbiCount === 0) {
            // Don't override if user already set RBI (e.g., FC no RBI)
            // But suggest the scored count
            playData.rbiCount = runnersScored;
        }
    }

    // ---- Runner Advancement Modal ----

    function openRunnerModal(ambiguousRunners, autoAdvancements) {
        const teamData = getTeamData(editState.team);
        runnerModalTitle.textContent = `Runners — Inning ${editState.inning}`;
        runnerRowsContainer.innerHTML = '';

        // Show auto-advanced runners first (read-only display)
        for (const adv of autoAdvancements) {
            const player = teamData.players[adv.playerIdx];
            const name = player.name || `Player ${adv.playerIdx + 1}`;
            const row = document.createElement('div');
            row.className = 'runner-row';
            row.style.opacity = '0.7';

            const endLabel = adv.endBase === 'home' ? 'Scores' : `→ ${adv.endBase}`;
            row.innerHTML = `
                <div class="runner-info">
                    <div class="runner-name">${name}</div>
                    <div class="runner-base-label">On ${adv.startBase} — ${endLabel} (auto)</div>
                </div>
            `;
            runnerRowsContainer.appendChild(row);
        }

        // Show ambiguous runners with buttons
        for (const runner of ambiguousRunners) {
            const player = teamData.players[runner.playerIdx];
            const name = player.name || `Player ${runner.playerIdx + 1}`;
            const options = Scoring.getAdvancementOptions(runner.startBase);

            const row = document.createElement('div');
            row.className = 'runner-row';

            const infoDiv = document.createElement('div');
            infoDiv.className = 'runner-info';
            infoDiv.innerHTML = `
                <div class="runner-name">${name}</div>
                <div class="runner-base-label">On ${runner.startBase}</div>
            `;
            row.appendChild(infoDiv);

            const optionsDiv = document.createElement('div');
            optionsDiv.className = 'runner-options';

            for (const opt of options) {
                const btn = document.createElement('button');
                btn.className = 'runner-opt-btn';
                if (opt.out) btn.classList.add('runner-opt-out');
                if (opt.endBase === 'home' && !opt.out) btn.classList.add('runner-opt-score');
                btn.textContent = opt.label;
                btn.dataset.playerIdx = runner.playerIdx;
                btn.dataset.startBase = runner.startBase;
                btn.dataset.endBase = opt.endBase;
                btn.dataset.out = opt.out;

                // Default: "Hold" is active
                if (opt.endBase === runner.startBase && !opt.out) {
                    btn.classList.add('active');
                }

                btn.addEventListener('click', () => {
                    // Deactivate siblings
                    optionsDiv.querySelectorAll('.runner-opt-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    // Update pending choice
                    const choice = getRunnerChoice(runner.playerIdx, runner.startBase);
                    if (choice) {
                        choice.endBase = opt.endBase;
                        choice.out = opt.out;
                    }

                    // Show/hide out detail panel
                    const detailPanel = row.querySelector('.runner-out-detail');
                    if (opt.out && detailPanel) {
                        detailPanel.style.display = 'block';
                    } else if (detailPanel) {
                        detailPanel.style.display = 'none';
                    }
                });

                optionsDiv.appendChild(btn);
            }

            // Out detail panel — fielder positions + DP/TP tag (hidden initially)
            const detailPanel = document.createElement('div');
            detailPanel.className = 'runner-out-detail';
            detailPanel.style.display = 'none';

            // Reason buttons row
            const reasonRow = document.createElement('div');
            reasonRow.className = 'runner-out-reasons';
            for (const reason of ['TOB', 'FC', 'CS', 'PO', 'TODB']) {
                const rb = document.createElement('button');
                rb.className = 'runner-reason-btn';
                rb.textContent = reason;
                rb.addEventListener('click', () => {
                    reasonRow.querySelectorAll('.runner-reason-btn').forEach(b => b.classList.remove('active'));
                    rb.classList.add('active');
                    const choice = getRunnerChoice(runner.playerIdx, runner.startBase);
                    if (choice) choice.outReason = reason;
                });
                reasonRow.appendChild(rb);
            }
            detailPanel.appendChild(reasonRow);

            // Fielder position buttons (compact)
            const fielderRow = document.createElement('div');
            fielderRow.className = 'runner-out-fielders';
            const runnerFielders = [];
            const fielderDisplay = document.createElement('span');
            fielderDisplay.className = 'runner-fielder-display';
            for (let pos = 1; pos <= 9; pos++) {
                const fb = document.createElement('button');
                fb.className = 'runner-fielder-btn';
                fb.textContent = pos;
                fb.addEventListener('click', () => {
                    runnerFielders.push(pos);
                    fb.classList.add('active');
                    fielderDisplay.textContent = runnerFielders.join('-');
                    const choice = getRunnerChoice(runner.playerIdx, runner.startBase);
                    if (choice) choice.outFielders = runnerFielders.join('-');
                });
                fielderRow.appendChild(fb);
            }
            const clearFb = document.createElement('button');
            clearFb.className = 'runner-fielder-clear';
            clearFb.textContent = '×';
            clearFb.addEventListener('click', () => {
                runnerFielders.length = 0;
                fielderRow.querySelectorAll('.runner-fielder-btn').forEach(b => b.classList.remove('active'));
                fielderDisplay.textContent = '';
                const choice = getRunnerChoice(runner.playerIdx, runner.startBase);
                if (choice) choice.outFielders = '';
            });
            fielderRow.appendChild(clearFb);
            fielderRow.appendChild(fielderDisplay);
            detailPanel.appendChild(fielderRow);

            // DP/TP toggle
            const dpRow = document.createElement('div');
            dpRow.className = 'runner-out-dp-row';
            for (const tag of ['DP', 'TP']) {
                const db = document.createElement('button');
                db.className = 'runner-dp-btn';
                db.textContent = tag;
                db.addEventListener('click', () => {
                    const choice = getRunnerChoice(runner.playerIdx, runner.startBase);
                    if (db.classList.contains('active')) {
                        db.classList.remove('active');
                        if (choice) choice.dpTag = null;
                    } else {
                        dpRow.querySelectorAll('.runner-dp-btn').forEach(b => b.classList.remove('active'));
                        db.classList.add('active');
                        if (choice) choice.dpTag = tag;
                    }
                });
                dpRow.appendChild(db);
            }
            detailPanel.appendChild(dpRow);

            row.appendChild(detailPanel);

            row.appendChild(optionsDiv);
            runnerRowsContainer.appendChild(row);
        }

        runnerModal.hidden = false;
    }

    function confirmRunners() {
        if (!pendingPlay) return;

        pendingPlay.runnerAdvancements = [...pendingRunnerChoices];
        applyRunnerAdvancements(pendingPlay, pendingRunnerChoices);
        setAtBat(editState.team, editState.playerIdx, editState.inning, pendingPlay);

        pendingPlay = null;
        pendingRunnerChoices = [];
        runnerModal.hidden = true;
        renderAll();
    }

    // ---- Pitch Tracking ----

    function showPitchPhase() {
        // Combined layout: both always visible
        pitchPhase.style.display = '';
        resultPhase.style.display = '';
        resultPhaseFooter.style.display = 'flex';
    }

    function showResultPhase() {
        // Combined layout: both always visible
        pitchPhase.style.display = '';
        resultPhase.style.display = '';
        resultPhaseFooter.style.display = 'flex';
        syncModalUI();
    }

    function syncPitchControls() {
        // Hand buttons
        handButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.hand === editState.batterHand);
        });
        // Pitch type buttons
        pitchTypeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === editState.currentPitchType);
        });
        // Selected location display
        const hasLocation = editState.currentPitchX != null;
        if (hasLocation) {
            const inZone = Scoring.isPitchInStrikeZone(editState.currentPitchX, editState.currentPitchY);
            pitchSelectedZone.textContent = inZone ? 'In Zone' : 'Outside Zone';
            pitchSelectedZone.style.borderColor = 'var(--header-bg)';
        } else {
            pitchSelectedZone.textContent = 'Location optional';
            pitchSelectedZone.style.borderColor = '';
        }
        // Outcome buttons always enabled — location is optional
        pitchOutcomeButtons.forEach(btn => {
            btn.disabled = false;
        });
    }

    function updateCountDisplay() {
        const count = Scoring.calcCount(editState.pitches);
        countBalls.textContent = count.balls;
        countStrikes.textContent = count.strikes;
    }

    /**
     * Render the strike zone SVG with pitch dots.
     */
    // Strike zone bounds in the 180x210 viewBox
    const SZ = { x: 50, y: 45, w: 78, h: 78 }; // inner strike zone rect

    function renderStrikeZone() {
        strikeZoneContainer.innerHTML = '';
        const isRHB = editState.batterHand === 'R';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 180 210');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.style.cursor = 'crosshair';

        // Background (clickable area)
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', 0); bg.setAttribute('y', 0);
        bg.setAttribute('width', 180); bg.setAttribute('height', 210);
        bg.setAttribute('fill', '#f0ece0');
        svg.appendChild(bg);

        // Outside zone shading (just off plate)
        const offRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        offRect.setAttribute('x', SZ.x - 18); offRect.setAttribute('y', SZ.y - 18);
        offRect.setAttribute('width', SZ.w + 36); offRect.setAttribute('height', SZ.h + 36);
        offRect.setAttribute('fill', '#d8d0c0'); offRect.setAttribute('fill-opacity', '0.3');
        offRect.setAttribute('stroke', '#8a8070'); offRect.setAttribute('stroke-width', '0.5');
        svg.appendChild(offRect);

        // Strike zone fill
        const szFill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        szFill.setAttribute('x', SZ.x); szFill.setAttribute('y', SZ.y);
        szFill.setAttribute('width', SZ.w); szFill.setAttribute('height', SZ.h);
        szFill.setAttribute('fill', '#c8dcc0'); szFill.setAttribute('fill-opacity', '0.4');
        svg.appendChild(szFill);

        // Strike zone grid lines (3x3)
        const cw = SZ.w / 3, ch = SZ.h / 3;
        for (let i = 1; i < 3; i++) {
            const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            vLine.setAttribute('x1', SZ.x + cw * i); vLine.setAttribute('y1', SZ.y);
            vLine.setAttribute('x2', SZ.x + cw * i); vLine.setAttribute('y2', SZ.y + SZ.h);
            vLine.setAttribute('stroke', '#5a7a50'); vLine.setAttribute('stroke-width', '0.3');
            vLine.setAttribute('stroke-dasharray', '2,2');
            vLine.style.pointerEvents = 'none';
            svg.appendChild(vLine);

            const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            hLine.setAttribute('x1', SZ.x); hLine.setAttribute('y1', SZ.y + ch * i);
            hLine.setAttribute('x2', SZ.x + SZ.w); hLine.setAttribute('y2', SZ.y + ch * i);
            hLine.setAttribute('stroke', '#5a7a50'); hLine.setAttribute('stroke-width', '0.3');
            hLine.setAttribute('stroke-dasharray', '2,2');
            hLine.style.pointerEvents = 'none';
            svg.appendChild(hLine);
        }

        // Strike zone border (thick)
        const szBorder = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        szBorder.setAttribute('x', SZ.x); szBorder.setAttribute('y', SZ.y);
        szBorder.setAttribute('width', SZ.w); szBorder.setAttribute('height', SZ.h);
        szBorder.setAttribute('fill', 'none');
        szBorder.setAttribute('stroke', '#3a5a3a'); szBorder.setAttribute('stroke-width', '1.5');
        szBorder.style.pointerEvents = 'none';
        svg.appendChild(szBorder);

        // "In" / "Away" labels
        for (const [label, isIn] of [['IN', true], ['AWAY', false]]) {
            const lx = (isIn === isRHB) ? SZ.x - 12 : SZ.x + SZ.w + 12;
            const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.setAttribute('x', lx); txt.setAttribute('y', SZ.y + SZ.h / 2);
            txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('font-size', '7');
            txt.setAttribute('fill', '#888'); txt.setAttribute('font-family', "'Inter', sans-serif");
            txt.setAttribute('transform', `rotate(${(isIn === isRHB) ? -90 : 90} ${lx} ${SZ.y + SZ.h / 2})`);
            txt.textContent = label; txt.style.pointerEvents = 'none';
            svg.appendChild(txt);
        }

        // Current click position indicator
        if (editState.currentPitchX != null) {
            const crossSize = 4;
            const px = editState.currentPitchX, py = editState.currentPitchY;
            for (const [x1, y1, x2, y2] of [
                [px - crossSize, py, px + crossSize, py],
                [px, py - crossSize, px, py + crossSize]
            ]) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', x1); line.setAttribute('y1', y1);
                line.setAttribute('x2', x2); line.setAttribute('y2', y2);
                line.setAttribute('stroke', '#d44'); line.setAttribute('stroke-width', '1.5');
                line.style.pointerEvents = 'none';
                svg.appendChild(line);
            }
        }

        // Draw pitch dots for logged pitches
        for (const p of editState.pitches) {
            const cx = p.pitchX != null ? p.pitchX : 90;
            const cy = p.pitchY != null ? p.pitchY : 105;

            const isStrike = (p.outcome === 'CS' || p.outcome === 'SS' || p.outcome === 'F');
            const color = p.missedCall ? '#cc2222' : '#228833';

            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
            dot.setAttribute('r', '7');
            dot.style.pointerEvents = 'none';

            if (isStrike) {
                // Filled circle for strikes
                dot.setAttribute('fill', color);
                dot.setAttribute('fill-opacity', '0.85');
            } else {
                // Empty circle for balls
                dot.setAttribute('fill', 'none');
                dot.setAttribute('stroke', color);
                dot.setAttribute('stroke-width', '1.5');
            }
            svg.appendChild(dot);

            // Pitch number
            const numText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            numText.setAttribute('x', cx); numText.setAttribute('y', cy + 1);
            numText.setAttribute('text-anchor', 'middle');
            numText.setAttribute('dominant-baseline', 'middle');
            numText.setAttribute('font-size', '7'); numText.setAttribute('font-weight', '700');
            numText.setAttribute('font-family', "'Inter', sans-serif");
            numText.setAttribute('fill', isStrike ? 'white' : color);
            numText.style.pointerEvents = 'none';
            numText.textContent = p.number;
            svg.appendChild(numText);

            // Pitch type label below
            const typeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            typeText.setAttribute('x', cx); typeText.setAttribute('y', cy + 14);
            typeText.setAttribute('text-anchor', 'middle');
            typeText.setAttribute('font-size', '5'); typeText.setAttribute('font-weight', '600');
            typeText.setAttribute('font-family', "'Inter', sans-serif");
            typeText.setAttribute('fill', '#333');
            typeText.style.pointerEvents = 'none';
            typeText.textContent = p.type;
            svg.appendChild(typeText);
        }

        // Click handler — free positioning
        svg.addEventListener('click', (e) => {
            const rect = svg.getBoundingClientRect();
            const scaleX = 180 / rect.width;
            const scaleY = 210 / rect.height;
            editState.currentPitchX = (e.clientX - rect.left) * scaleX;
            editState.currentPitchY = (e.clientY - rect.top) * scaleY;
            editState.currentZone = Scoring.isPitchInStrikeZone(editState.currentPitchX, editState.currentPitchY) ? 'strike' : 'ball';
            renderStrikeZone();
            syncPitchControls();
        });

        strikeZoneContainer.appendChild(svg);
    }

    function renderPitchLog() {
        pitchLog.innerHTML = '';
        if (editState.pitches.length === 0) {
            pitchLog.innerHTML = '<div class="pitch-log-empty">No pitches recorded</div>';
            return;
        }

        for (const p of editState.pitches) {
            const entry = document.createElement('div');
            entry.className = 'pitch-log-entry';

            const num = document.createElement('span');
            num.className = 'pitch-log-num';
            num.textContent = `#${p.number}`;
            entry.appendChild(num);

            const type = document.createElement('span');
            type.className = 'pitch-log-type';
            type.textContent = p.type;
            entry.appendChild(type);

            const outcome = document.createElement('span');
            outcome.className = `pitch-log-outcome outcome-${p.outcome}`;
            const outcomeLabels = { CS: 'Called', SS: 'Swing', F: 'Foul', B: 'Ball', IP: 'In Play', HBP: 'HBP' };
            outcome.textContent = outcomeLabels[p.outcome] || p.outcome;
            entry.appendChild(outcome);

            const zone = document.createElement('span');
            zone.className = 'pitch-log-zone';
            zone.textContent = Scoring.getZoneLabel(p.zone, editState.batterHand);
            entry.appendChild(zone);

            if (p.missedCall) {
                const missed = document.createElement('span');
                missed.className = 'pitch-log-missed';
                missed.textContent = 'MISS';
                entry.appendChild(missed);
            }

            pitchLog.appendChild(entry);
        }

        // Scroll to bottom
        pitchLog.scrollTop = pitchLog.scrollHeight;
    }

    function logPitch(outcome) {
        // Location is optional — record without coordinates if none selected
        const hasLocation = editState.currentPitchX != null;
        const pitch = {
            number: editState.pitches.length + 1,
            pitchX: hasLocation ? editState.currentPitchX : null,
            pitchY: hasLocation ? editState.currentPitchY : null,
            zone: hasLocation
                ? (Scoring.isPitchInStrikeZone(editState.currentPitchX, editState.currentPitchY) ? 'strike' : 'ball')
                : (outcome === 'B' ? 'ball' : 'strike'),
            type: editState.currentPitchType,
            outcome,
            missedCall: hasLocation
                ? Scoring.isMissedCall(null, outcome, editState.currentPitchX, editState.currentPitchY)
                : false
        };

        editState.pitches.push(pitch);
        editState.currentPitchX = null;
        editState.currentPitchY = null;
        editState.currentZone = null;

        updateCountDisplay();
        renderPitchLog();
        renderStrikeZone();
        syncPitchControls();

        // Check for auto-complete
        const count = Scoring.calcCount(editState.pitches);

        if (outcome === 'IP') {
            // Ball put in play — transition to result phase
            showResultPhase();
            return;
        }

        if (outcome === 'HBP') {
            // Hit by pitch — auto-set result and transition
            editState.result = 'HBP';
            editState.bases = Scoring.defaultBasesForResult('HBP');
            showResultPhase();
            return;
        }

        if (count.strikes >= 3) {
            // Strikeout — check if swinging or looking
            const lastPitch = editState.pitches[editState.pitches.length - 1];
            editState.result = lastPitch.outcome === 'SS' ? 'K' : 'KL';
            editState.bases = Scoring.defaultBasesForResult(editState.result);
            // Auto-assign next out number
            const currentOuts = countOutsInInning(editState.team, editState.inning);
            editState.outNumber = Math.min(currentOuts + 1, 3);
            showResultPhase();
            return;
        }

        if (count.balls >= 4) {
            // Walk
            editState.result = 'BB';
            editState.bases = Scoring.defaultBasesForResult('BB');
            showResultPhase();
            return;
        }
    }

    function undoLastPitch() {
        if (editState.pitches.length === 0) return;
        editState.pitches.pop();
        updateCountDisplay();
        renderPitchLog();
        renderStrikeZone();
    }

    // ---- Event Listeners ----

    // Result buttons
    resultButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            let result = btn.dataset.result;

            // Apply sub-options when clicking the parent button
            if (result === 'K' && optBackwardK.checked) result = 'KL';
            if (result === 'GO' && optSacBunt.checked) result = 'SAC';
            if (result === 'FO' && optLineOut.checked) result = 'LO';
            if (result === 'FO' && optSacFly.checked) result = 'SF';

            // Check if toggling off (account for derivative results too)
            const derivativeMap = { 'K': ['K', 'KL'], 'GO': ['GO', 'SAC'], 'FO': ['FO', 'LO', 'SF'] };
            const family = derivativeMap[btn.dataset.result] || [btn.dataset.result];
            if (family.includes(editState.result)) {
                editState.result = null; // toggle off
                editState.outNumber = 0; // reset out number when deselecting
            } else {
                editState.result = result;
                // Auto-set bases
                const defaultBases = Scoring.defaultBasesForResult(result);
                editState.bases = { ...defaultBases };

                // Auto-set out number for out results (not E — batter usually reaches on error)
                const isOutResult = Scoring.isOut(result) && !Scoring.isHit(result) && !Scoring.isWalk(result) && result !== 'E';
                if (isOutResult) {
                    if (editState.outNumber === 0) {
                        // Auto-assign next out number (user can still manually override)
                        const currentOuts = countOutsInInning(editState.team, editState.inning);
                        editState.outNumber = Math.min(currentOuts + 1, 3);
                    }
                } else {
                    editState.outNumber = 0;
                }

                // Auto-set RBI for HR
                if (result === 'HR' && editState.rbiCount === 0) {
                    editState.rbiCount = 1;
                }
            }
            syncModalUI();
        });
    });

    // Sub-option: Backward K — when checked, set result to KL instead of K
    optBackwardK.addEventListener('change', () => {
        if (optBackwardK.checked && editState.result === 'K') {
            editState.result = 'KL';
        } else if (!optBackwardK.checked && editState.result === 'KL') {
            editState.result = 'K';
        }
        syncModalUI();
    });

    // Sub-option: Sac Bunt — mark GO as SAC
    optSacBunt.addEventListener('change', () => {
        if (optSacBunt.checked && editState.result === 'GO') {
            editState.result = 'SAC';
        } else if (!optSacBunt.checked && editState.result === 'SAC') {
            editState.result = 'GO';
        }
        syncModalUI();
    });

    // Sub-option: Line Out — replace FO with LO
    optLineOut.addEventListener('change', () => {
        if (optLineOut.checked) {
            if (editState.result === 'FO') editState.result = 'LO';
            optSacFly.checked = false; // mutually exclusive
        } else if (editState.result === 'LO') {
            editState.result = 'FO';
        }
        syncModalUI();
    });

    // Sub-option: Sac Fly — mark FO as SF
    optSacFly.addEventListener('change', () => {
        if (optSacFly.checked) {
            if (editState.result === 'FO') editState.result = 'SF';
            optLineOut.checked = false; // mutually exclusive
        } else if (editState.result === 'SF') {
            editState.result = 'FO';
        }
        syncModalUI();
    });

    // Fielder buttons
    fielderButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const pos = parseInt(btn.dataset.pos, 10);
            const idx = editState.fielders.indexOf(pos);
            if (idx >= 0) {
                editState.fielders.splice(idx, 1);
            } else {
                editState.fielders.push(pos);
            }
            syncModalUI();
        });
    });

    // Clear fielders
    clearFieldersBtn.addEventListener('click', () => {
        editState.fielders = [];
        syncModalUI();
    });

    // Clear spray chart
    sprayClearBtn.addEventListener('click', () => {
        editState.sprayChart = null;
        updateModalPreview();
    });

    // Base checkboxes
    for (const [key, checkbox] of Object.entries(baseCheckboxes)) {
        checkbox.addEventListener('change', () => {
            editState.bases[key] = checkbox.checked;
            updateModalPreview();
        });
    }

    // Out buttons
    outButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            editState.outNumber = parseInt(btn.dataset.out, 10);
            syncModalUI();
        });
    });

    // RBI
    $('#rbi-minus').addEventListener('click', () => {
        editState.rbiCount = Math.max(0, editState.rbiCount - 1);
        rbiDisplay.textContent = editState.rbiCount;
        updateModalPreview();
    });

    $('#rbi-plus').addEventListener('click', () => {
        editState.rbiCount = Math.min(9, editState.rbiCount + 1);
        rbiDisplay.textContent = editState.rbiCount;
        updateModalPreview();
    });

    // Notes
    playNotes.addEventListener('input', () => {
        editState.notes = playNotes.value;
    });

    // Modal actions
    $('#modal-close').addEventListener('click', closePlayModal);
    $('#btn-cancel-play').addEventListener('click', closePlayModal);
    $('#btn-save-play').addEventListener('click', savePlay);
    $('#btn-clear-play').addEventListener('click', () => {
        clearAtBat(editState.team, editState.playerIdx, editState.inning);
        closePlayModal();
        renderAll();
    });

    // Close modal on overlay click
    playModal.addEventListener('click', (e) => {
        if (e.target === playModal) closePlayModal();
    });

    // Runner modal
    $('#btn-confirm-runners').addEventListener('click', confirmRunners);
    runnerModal.addEventListener('click', (e) => {
        // Don't allow closing runner modal by clicking overlay — must confirm
    });

    // Pitch phase controls
    handButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            editState.batterHand = btn.dataset.hand;
            handButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderStrikeZone();
        });
    });

    pitchTypeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            editState.currentPitchType = btn.dataset.type;
            pitchTypeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    pitchOutcomeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            logPitch(btn.dataset.outcome);
        });
    });

    $('#btn-undo-pitch').addEventListener('click', undoLastPitch);

    // Nav buttons removed — combined layout

    // Team name inputs
    // Team name change: use 'change' event for datalist selection + auto-fill
    awayTeamName.addEventListener('change', () => handleTeamNameChange('away'));
    homeTeamName.addEventListener('change', () => handleTeamNameChange('home'));
    // Also update on plain typing (input event) for linescore, but no auto-fill
    awayTeamName.addEventListener('input', () => {
        game.awayTeam.name = awayTeamName.value;
        updateLinescore();
    });
    homeTeamName.addEventListener('input', () => {
        game.homeTeam.name = homeTeamName.value;
        updateLinescore();
    });

    // ---- Add Player to Lineup ----
    function addPlayerToTeam(side) {
        const teamData = side === 'away' ? game.awayTeam : game.homeTeam;
        teamData.players.push({ name: '', number: '', position: '' });
        persistCurrentGame();
        // Only re-render the affected grid, not both
        const gridEl = side === 'away' ? awayGrid : homeGrid;
        const teamKey = side;
        renderGrid(gridEl, teamKey, teamData);
    }

    $('#btn-add-player-away').addEventListener('click', (e) => {
        e.stopPropagation();
        addPlayerToTeam('away');
    });
    $('#btn-add-player-home').addEventListener('click', (e) => {
        e.stopPropagation();
        addPlayerToTeam('home');
    });

    // ---- Add Extra Inning ----
    $('#btn-add-inning').addEventListener('click', () => {
        game.innings++;
        persistCurrentGame();
        renderAll();
    });

    // ---- Change Pitcher ----
    function changePitcher(pitcherTeam) {
        const name = prompt('New pitcher name:');
        if (!name) return;

        const teamData = pitcherTeam === 'away' ? game.awayTeam : game.homeTeam;

        // End current pitcher at current inning (approximate)
        const currentIdx = teamData.currentPitcherIdx || 0;
        if (teamData.pitchers[currentIdx]) {
            teamData.pitchers[currentIdx].endInning = game.innings; // rough — could track more precisely
        }

        // Add new pitcher
        teamData.pitchers.push({ name, startInning: game.innings, endInning: null });
        teamData.currentPitcherIdx = teamData.pitchers.length - 1;

        persistCurrentGame();
        renderAll();
    }

    // "home" button changes home team's pitcher (shown below away batting grid)
    document.getElementById('btn-change-pitcher-home').addEventListener('click', () => changePitcher('home'));
    // "away" button changes away team's pitcher (shown below home batting grid)
    document.getElementById('btn-change-pitcher-away').addEventListener('click', () => changePitcher('away'));

    // ---- Chart Lightbox ----
    const chartLightbox = document.getElementById('chart-lightbox');
    const chartLightboxContent = document.getElementById('chart-lightbox-content');

    function openChartLightbox(svgElement) {
        chartLightboxContent.innerHTML = '';
        chartLightboxContent.appendChild(svgElement);
        chartLightbox.hidden = false;
    }

    chartLightbox.addEventListener('click', (e) => {
        // Close when clicking the overlay background (not the content)
        if (e.target === chartLightbox) {
            chartLightbox.hidden = true;
        }
    });

    // Also close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !chartLightbox.hidden) {
            chartLightbox.hidden = true;
        }
    });

    // ---- Export / Import (JSON file) ----
    $('#btn-save').addEventListener('click', () => {
        const data = JSON.stringify(game, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const awayName = game.awayTeam.name || 'visitors';
        const homeName = game.homeTeam.name || 'home';
        a.download = `scorebook-${awayName}-vs-${homeName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    $('#btn-load').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const loaded = JSON.parse(evt.target.result);
                if (loaded.atBats && loaded.awayTeam && loaded.homeTeam) {
                    game = loaded;
                    if (!game.innings) game.innings = 9;
                    if (!game.id) game.id = 'game-' + Date.now();
                    if (!game.status) game.status = 'in-progress';
                    readOnlyMode = false;
                    document.body.classList.remove('scorebook-readonly');
                    persistCurrentGame();
                    renderAll();
                } else {
                    alert('Invalid scorebook file.');
                }
            } catch (err) {
                alert('Error reading file: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // reset so same file can be re-loaded
    });

    // ---- Team Persistence Helpers ----
    async function saveTeamToStorage(teamData) {
        if (!teamData.name || !teamData.name.trim()) return;
        const teamId = teamData.teamId || ('team-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
        teamData.teamId = teamId;
        await Storage.put('teams', teamId, {
            id: teamId,
            name: teamData.name.trim(),
            players: teamData.players.map(p => ({
                name: p.name || '', number: p.number || '', position: p.position || ''
            })),
            updatedAt: new Date().toISOString()
        });
        return teamId;
    }

    async function archiveCurrentGame() {
        const hasPlays = Object.keys(game.atBats).length > 0;
        const hasTeams = game.awayTeam.name || game.homeTeam.name;
        if (!hasPlays && !hasTeams) return;

        game.status = 'completed';
        game.completedAt = new Date().toISOString();

        // Save teams
        if (game.awayTeam.name) await saveTeamToStorage(game.awayTeam);
        if (game.homeTeam.name) await saveTeamToStorage(game.homeTeam);

        // Archive game
        await Storage.put('games', game.id, game);
        // Clear current game slot
        await Storage.del('currentGame', 'current');
    }

    // ---- End Game ----
    $('#btn-end-game').addEventListener('click', async () => {
        const hasPlays = Object.keys(game.atBats).length > 0;
        if (!hasPlays) {
            alert('No plays recorded yet.');
            return;
        }
        if (!confirm('End this game and archive it?')) return;

        await archiveCurrentGame();
        game = createEmptyGame();
        readOnlyMode = false;
        document.body.classList.remove('scorebook-readonly');
        await Storage.put('currentGame', 'current', game);
        renderAll();
    });

    // ---- New Game ----
    $('#btn-new-game').addEventListener('click', async () => {
        // Clear form inputs from previous use
        $('#new-away-name').value = '';
        $('#new-home-name').value = '';

        // Set date to today
        const dateInput = $('#new-game-date');
        if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

        // Populate team selects from saved teams
        const savedTeams = await Storage.getAll('teams');
        for (const side of ['away', 'home']) {
            const select = $(`#new-${side}-team-select`);
            select.innerHTML = '<option value="">-- New Team --</option>';
            for (const { key, value } of savedTeams) {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = value.name;
                select.appendChild(opt);
            }
        }

        // Build lineup inputs
        for (const side of ['away', 'home']) {
            const container = $(`#new-${side}-lineup`);
            container.innerHTML = '';
            for (let i = 0; i < PLAYER_COUNT; i++) {
                const row = document.createElement('div');
                row.className = 'lineup-row';
                row.innerHTML = `
                    <span class="lineup-order">${i + 1}.</span>
                    <input type="text" class="lineup-num" placeholder="#" data-side="${side}" data-idx="${i}" data-field="number">
                    <input type="text" class="lineup-name" placeholder="Player Name" data-side="${side}" data-idx="${i}" data-field="name">
                    <input type="text" class="lineup-pos" placeholder="Pos" data-side="${side}" data-idx="${i}" data-field="position">
                `;
                container.appendChild(row);
            }
        }

        // Team select change handler: auto-fill lineup
        for (const side of ['away', 'home']) {
            const select = $(`#new-${side}-team-select`);
            select.onchange = async () => {
                const teamId = select.value;
                if (!teamId) return;
                const team = await Storage.get('teams', teamId);
                if (!team) return;
                $(`#new-${side}-name`).value = team.name;
                for (let i = 0; i < PLAYER_COUNT && i < team.players.length; i++) {
                    const p = team.players[i];
                    const numInput = $(`input[data-side="${side}"][data-idx="${i}"][data-field="number"]`);
                    const nameInput = $(`input[data-side="${side}"][data-idx="${i}"][data-field="name"]`);
                    const posInput = $(`input[data-side="${side}"][data-idx="${i}"][data-field="position"]`);
                    if (numInput) numInput.value = p.number || '';
                    if (nameInput) nameInput.value = p.name || '';
                    if (posInput) posInput.value = p.position || '';
                }
            };
        }

        newGameModal.hidden = false;
    });

    $('#btn-cancel-new').addEventListener('click', () => {
        newGameModal.hidden = true;
    });

    $('#btn-start-game').addEventListener('click', async () => {
        // Archive current game if it has data
        const hasPlays = Object.keys(game.atBats).length > 0;
        const hasTeams = game.awayTeam.name || game.homeTeam.name;
        if (hasPlays || hasTeams) {
            await archiveCurrentGame();
        }

        game = createEmptyGame();
        const dateInput = $('#new-game-date');
        if (dateInput && dateInput.value) game.date = dateInput.value;
        game.awayTeam.name = $('#new-away-name').value;
        game.homeTeam.name = $('#new-home-name').value;

        // Apply team IDs from selects
        const awaySelect = $('#new-away-team-select');
        const homeSelect = $('#new-home-team-select');
        if (awaySelect.value) game.awayTeam.teamId = awaySelect.value;
        if (homeSelect.value) game.homeTeam.teamId = homeSelect.value;

        // Read lineup inputs
        for (const side of ['away', 'home']) {
            const teamData = side === 'away' ? game.awayTeam : game.homeTeam;
            for (let i = 0; i < PLAYER_COUNT; i++) {
                const numInput = $(`input[data-side="${side}"][data-idx="${i}"][data-field="number"]`);
                const nameInput = $(`input[data-side="${side}"][data-idx="${i}"][data-field="name"]`);
                const posInput = $(`input[data-side="${side}"][data-idx="${i}"][data-field="position"]`);
                teamData.players[i] = {
                    number: numInput ? numInput.value : '',
                    name: nameInput ? nameInput.value : '',
                    position: posInput ? posInput.value.toUpperCase() : ''
                };
            }
        }

        // Save teams if checkbox checked
        if ($('#save-away-team').checked && game.awayTeam.name) {
            await saveTeamToStorage(game.awayTeam);
        }
        if ($('#save-home-team').checked && game.homeTeam.name) {
            await saveTeamToStorage(game.homeTeam);
        }

        readOnlyMode = false;
        document.body.classList.remove('scorebook-readonly');
        await Storage.put('currentGame', 'current', game);
        newGameModal.hidden = true;
        renderAll();
    });

    newGameModal.addEventListener('click', (e) => {
        if (e.target === newGameModal) newGameModal.hidden = true;
    });

    // ---- Game History ----
    const historyModal = $('#history-modal');

    $('#btn-history').addEventListener('click', async () => {
        const gameList = $('#game-list');
        gameList.innerHTML = '';

        const allGames = await Storage.getAll('games');
        if (allGames.length === 0) {
            gameList.innerHTML = '<p class="stats-empty">No archived games yet.</p>';
            historyModal.hidden = false;
            return;
        }

        // Sort by date descending
        allGames.sort((a, b) => (b.value.date || '').localeCompare(a.value.date || ''));

        for (const { key, value: g } of allGames) {
            const score = Stats.calcGameScore(g);
            const card = document.createElement('div');
            card.className = 'game-card';
            card.innerHTML = `
                <div class="game-card-date">${g.date || 'Unknown date'}</div>
                <div class="game-card-teams">
                    <span class="game-card-team ${score.away > score.home ? 'game-card-winner' : ''}">${g.awayTeam.name || 'Visitors'}</span>
                    <span class="game-card-score">${score.away} - ${score.home}</span>
                    <span class="game-card-team ${score.home > score.away ? 'game-card-winner' : ''}">${g.homeTeam.name || 'Home'}</span>
                </div>
                <div class="game-card-actions">
                    <button class="game-card-btn game-card-view" data-game-id="${key}">View</button>
                    <button class="game-card-btn game-card-delete" data-game-id="${key}">Delete</button>
                </div>
            `;
            gameList.appendChild(card);
        }

        // View handler
        gameList.addEventListener('click', async (e) => {
            const viewBtn = e.target.closest('.game-card-view');
            if (viewBtn) {
                const id = viewBtn.dataset.gameId;
                const g = await Storage.get('games', id);
                if (g) {
                    game = g;
                    readOnlyMode = true;
                    document.body.classList.add('scorebook-readonly');
                    historyModal.hidden = true;
                    renderAll();
                }
            }
            const delBtn = e.target.closest('.game-card-delete');
            if (delBtn) {
                if (!confirm('Delete this game permanently?')) return;
                const id = delBtn.dataset.gameId;
                await Storage.del('games', id);
                delBtn.closest('.game-card').remove();
                if (gameList.children.length === 0) {
                    gameList.innerHTML = '<p class="stats-empty">No archived games yet.</p>';
                }
            }
        });

        historyModal.hidden = false;
    });

    $('#history-close').addEventListener('click', () => {
        historyModal.hidden = true;
    });

    historyModal.addEventListener('click', (e) => {
        if (e.target === historyModal) historyModal.hidden = true;
    });

    // ---- Return to current game from read-only ----
    // Clicking "New Game" or "End Game" while in read-only exits back
    function exitReadOnlyMode() {
        if (!readOnlyMode) return;
        readOnlyMode = false;
        document.body.classList.remove('scorebook-readonly');
    }

    // ---- Keyboard shortcuts ----
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!playModal.hidden) closePlayModal();
            if (!newGameModal.hidden) newGameModal.hidden = true;
            if (!historyModal.hidden) historyModal.hidden = true;
        }
    });

    // ---- Floating zoom toggle for mobile scorebook ----
    // If a cell is selected: zooms into that cell specifically.
    // If no cell selected: toggles full scorebook zoom.
    // Zooming out also deselects any active cell.
    function initMobileZoom() {
        const btn = document.createElement('button');
        btn.className = 'zoom-toggle-btn';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="10" cy="10" r="6"/><line x1="10" y1="7" x2="10" y2="13"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="14.5" y1="14.5" x2="20" y2="20"/></svg>';
        btn.setAttribute('aria-label', 'Toggle zoom');
        document.body.appendChild(btn);
        zoomBtn = btn; // store reference for setActiveCell/clearActiveCell

        let zoomed = false;

        function zoomIn() {
            zoomed = true;
            document.body.classList.add('scorebook-zoomed');
            btn.classList.add('zoom-toggle-active');
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="10" cy="10" r="6"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="14.5" y1="14.5" x2="20" y2="20"/></svg>';
        }

        function zoomOut() {
            zoomed = false;
            document.body.classList.remove('scorebook-zoomed');
            btn.classList.remove('zoom-toggle-active');
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="10" cy="10" r="6"/><line x1="10" y1="7" x2="10" y2="13"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="14.5" y1="14.5" x2="20" y2="20"/></svg>';
            clearActiveCell();
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (zoomed) {
                zoomOut();
            } else {
                zoomIn();
                // If a cell is selected, scroll it into view after zoom renders
                if (activeCell) {
                    setTimeout(() => {
                        activeCell.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
                    }, 100);
                }
            }
        });
    }

    // Apply zoom on touch-capable devices
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        initMobileZoom();
    }

    // ---- Render default game immediately (before async storage) ----
    renderAll();

    // ---- Initialize with persistence + auto cloud sync ----
    (async function init() {
        await Storage.open();

        // Load local data first (instant)
        const saved = await Storage.get('currentGame', 'current');
        if (saved && saved.atBats) {
            game = saved;
            if (!game.id) game.id = 'game-' + Date.now();
            if (!game.status) game.status = 'in-progress';
            // Ensure both teams have at least PLAYER_COUNT slots
            for (const team of [game.awayTeam, game.homeTeam]) {
                while (team.players.length < PLAYER_COUNT) {
                    team.players.push({ name: '', number: '', position: '' });
                }
            }
        }
        await populateTeamDatalist();
        renderAll();


        // Auto-pull from cloud in background (non-blocking)
        if (Storage.cloudEnabled()) {
            Storage.fullSync().then(async (updated) => {
                if (updated) {
                    const cloudSaved = await Storage.get('currentGame', 'current');
                    if (cloudSaved && cloudSaved.atBats) {
                        game = cloudSaved;
                    }
                    renderAll();
                }
            });

            // ---- Live Collaboration: poll cloud every 5 seconds ----
            setInterval(async () => {
                // Only poll if no modal is open (avoid overwriting mid-edit)
                if (!playModal.hidden || !newGameModal.hidden) return;
                if (readOnlyMode) return;

                try {
                    const res = await fetch(Storage._workerUrl + '/kv/currentGame/current', {
                        headers: { 'X-API-Key': Storage._apiKey }
                    });
                    if (!res || !res.ok) return;
                    const cloudGame = await res.json();
                    if (!cloudGame || !cloudGame.atBats) return;

                    // Compare: only update if cloud has newer data
                    const cloudTime = cloudGame.updatedAt || cloudGame.createdAt || '';
                    const localTime = game.updatedAt || game.createdAt || '';
                    const cloudAtBatCount = Object.keys(cloudGame.atBats).length;
                    const localAtBatCount = Object.keys(game.atBats).length;

                    // Update if cloud has more data or newer timestamp
                    if (cloudTime > localTime || cloudAtBatCount > localAtBatCount) {
                        game = cloudGame;
                        await Storage.put('currentGame', 'current', game);
                        renderAll();
                    }
                } catch (e) {
                    // Silent fail — network issue, no big deal
                }
            }, 5000);
        }
    })();

})();
