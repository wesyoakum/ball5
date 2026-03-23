/* ============================================================
   scoring.js — Play Notation Logic & Stat Calculations
   ============================================================ */

const Scoring = (() => {

    // Play categories
    const HIT_RESULTS = ['1B', '2B', '3B', 'HR'];
    const WALK_RESULTS = ['BB', 'HBP'];
    const OUT_RESULTS = ['K', 'KL', 'FO', 'GO', 'LO', 'PO', 'DP', 'TP'];
    const SPECIAL_RESULTS = ['FC', 'SAC', 'SF', 'E'];

    // Results that count as at-bats (everything except BB, HBP, SAC, SF)
    const NON_AB_RESULTS = ['BB', 'HBP', 'SAC', 'SF'];

    function isHit(result) {
        return HIT_RESULTS.includes(result);
    }

    function isWalk(result) {
        return WALK_RESULTS.includes(result);
    }

    function isOut(result) {
        return OUT_RESULTS.includes(result) || SPECIAL_RESULTS.includes(result);
    }

    function isStrikeout(result) {
        return result === 'K' || result === 'KL';
    }

    function countsAsAtBat(result) {
        return !NON_AB_RESULTS.includes(result);
    }

    /**
     * Auto-set bases reached based on play result.
     * Returns default base state for a given result.
     */
    function defaultBasesForResult(result) {
        switch (result) {
            case '1B': return { first: true, second: false, third: false, home: false };
            case '2B': return { first: true, second: true, third: false, home: false };
            case '3B': return { first: true, second: true, third: true, home: false };
            case 'HR': return { first: true, second: true, third: true, home: true };
            case 'BB':
            case 'HBP': return { first: true, second: false, third: false, home: false };
            case 'E':
            case 'FC': return { first: true, second: false, third: false, home: false };
            default: return { first: false, second: false, third: false, home: false };
        }
    }

    /**
     * Build the display notation string.
     * If fielder notation exists, combine with result prefix as needed.
     */
    function buildNotation(result, fielderNotation) {
        if (!result) return fielderNotation || '';

        // For outs with fielder notation, show like "6-3", "F8", "L7"
        if (fielderNotation) {
            if (result === 'GO') return fielderNotation;
            if (result === 'FO') return 'F' + fielderNotation;
            if (result === 'LO') return 'L' + fielderNotation;
            if (result === 'PO') return 'P' + fielderNotation;
            if (result === 'DP') return 'DP ' + fielderNotation;
            if (result === 'TP') return 'TP ' + fielderNotation;
            if (result === 'E') return 'E' + fielderNotation;
            if (result === 'FC') return 'FC ' + fielderNotation;
            if (result === 'SAC') return 'SAC ' + fielderNotation;
            if (result === 'SF') return 'SF ' + fielderNotation;
            return result;
        }

        return result;
    }

    /**
     * Calculate stats for a single player across all innings.
     * @param {object[]} atBats - array of AtBat objects for this player
     * @returns {{ ab, r, h, rbi, bb, so }}
     */
    function calcPlayerStats(atBats) {
        const stats = { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0 };

        for (const ab of atBats) {
            if (!ab || !ab.result) continue;

            if (countsAsAtBat(ab.result)) stats.ab++;
            if (ab.bases && ab.bases.home) stats.r++;
            if (isHit(ab.result)) stats.h++;
            stats.rbi += ab.rbiCount || 0;
            if (isWalk(ab.result)) stats.bb++;
            if (isStrikeout(ab.result)) stats.so++;
        }

        return stats;
    }

    /**
     * Calculate inning totals for a team.
     * @param {Map} atBatMap - the game's atBat map
     * @param {string} teamKey - 'away' or 'home'
     * @param {number} inning - inning number
     * @param {number} playerCount - number of players
     * @returns {{ r, h, e }}
     */
    function calcInningTotals(atBatMap, teamKey, inning, playerCount) {
        const totals = { r: 0, h: 0, e: 0 };

        for (let p = 0; p < playerCount; p++) {
            const key = `${teamKey}-${p}-${inning}`;
            const ab = atBatMap.get(key);
            if (!ab || !ab.result) continue;

            if (ab.bases && ab.bases.home) totals.r++;
            if (isHit(ab.result)) totals.h++;
            if (ab.result === 'E') totals.e++;
        }

        return totals;
    }

    // ---- Baserunner Tracking ----

    /**
     * Determine the batting order within an inning by finding which players
     * have at-bats recorded. Returns array of playerIdx in batting order.
     * In a standard game, batting order wraps around the lineup.
     */
    function getInningBattingOrder(atBats, teamKey, inning, playerCount) {
        const order = [];
        for (let p = 0; p < playerCount; p++) {
            const key = `${teamKey}-${p}-${inning}`;
            if (atBats[key]) {
                order.push(p);
            }
        }
        return order;
    }

    /**
     * Compute who is currently on each base at the point in the inning
     * just BEFORE a given batter's at-bat.
     *
     * Scans all at-bats in the inning for this team that were recorded
     * for players earlier in the batting order. Tracks each batter's
     * final base position based on their own bases{} and any
     * runnerAdvancements applied to them by later batters.
     *
     * @param {object} atBats - the game.atBats map
     * @param {string} teamKey - 'away' or 'home'
     * @param {number} inning
     * @param {number} currentBatterIdx - the playerIdx about to bat
     * @param {number} playerCount
     * @returns {{ first: number|null, second: number|null, third: number|null }}
     *          playerIdx on each base, or null if empty
     */
    function getBaseRunners(atBats, teamKey, inning, currentBatterIdx, playerCount) {
        const runners = { first: null, second: null, third: null };

        // Build a map of each player's final base position in this inning
        // A player's position is determined by:
        // 1. Their own at-bat bases{} (where they reached initially)
        // 2. Any runnerAdvancements from subsequent batters that moved them
        const playerPositions = {}; // playerIdx → 'first'|'second'|'third'|'home'|'out'|null

        // Get all batters who have already batted this inning (before current batter)
        const battedPlayers = [];
        for (let p = 0; p < playerCount; p++) {
            if (p === currentBatterIdx) continue;
            const key = `${teamKey}-${p}-${inning}`;
            if (atBats[key]) {
                battedPlayers.push(p);
            }
        }

        // First pass: set initial position from each batter's own at-bat
        for (const p of battedPlayers) {
            const ab = atBats[`${teamKey}-${p}-${inning}`];
            if (!ab || !ab.result) continue;

            if (ab.bases && ab.bases.home) {
                playerPositions[p] = 'home'; // scored on own at-bat
            } else if (ab.bases && ab.bases.third) {
                playerPositions[p] = 'third';
            } else if (ab.bases && ab.bases.second) {
                playerPositions[p] = 'second';
            } else if (ab.bases && ab.bases.first) {
                playerPositions[p] = 'first';
            } else {
                // Made an out, not on base
                playerPositions[p] = 'out';
            }
        }

        // Second pass: apply runnerAdvancements from all at-bats
        // (later batters may have advanced earlier runners)
        for (const p of battedPlayers) {
            const ab = atBats[`${teamKey}-${p}-${inning}`];
            if (!ab || !ab.runnerAdvancements) continue;

            for (const adv of ab.runnerAdvancements) {
                if (adv.out) {
                    playerPositions[adv.playerIdx] = 'out';
                } else {
                    playerPositions[adv.playerIdx] = adv.endBase;
                }
            }
        }

        // Also apply advancements from the current batter's existing at-bat
        // (in case they're re-editing)
        const currentAb = atBats[`${teamKey}-${currentBatterIdx}-${inning}`];
        if (currentAb && currentAb.runnerAdvancements) {
            for (const adv of currentAb.runnerAdvancements) {
                if (adv.out) {
                    playerPositions[adv.playerIdx] = 'out';
                } else {
                    playerPositions[adv.playerIdx] = adv.endBase;
                }
            }
        }

        // Build the runners object from final positions
        // Only include players still on a base (not home/out)
        for (const [pStr, pos] of Object.entries(playerPositions)) {
            const pIdx = parseInt(pStr, 10);
            if (pos === 'first' || pos === 'second' || pos === 'third') {
                runners[pos] = pIdx;
            }
        }

        return runners;
    }

    const BASE_ORDER = ['first', 'second', 'third', 'home'];

    function nextBase(base) {
        const idx = BASE_ORDER.indexOf(base);
        return idx >= 0 && idx < BASE_ORDER.length - 1 ? BASE_ORDER[idx + 1] : null;
    }

    /**
     * Determine automatic runner advancements for unambiguous plays.
     * Returns { advancements, ambiguousRunners }.
     * - advancements: array of { playerIdx, startBase, endBase, out }
     * - ambiguousRunners: array of { playerIdx, startBase } that need user input
     *
     * @param {string} result - the play result
     * @param {{ first, second, third }} runners - playerIdx on each base
     * @returns {{ advancements: array, ambiguousRunners: array }}
     */
    function resolveRunnerAdvancements(result, runners) {
        const advancements = [];
        const ambiguousRunners = [];

        const hasFirst = runners.first !== null;
        const hasSecond = runners.second !== null;
        const hasThird = runners.third !== null;
        const anyRunners = hasFirst || hasSecond || hasThird;

        if (!anyRunners) {
            return { advancements, ambiguousRunners };
        }

        // HR: everyone scores
        if (result === 'HR') {
            if (hasThird) advancements.push({ playerIdx: runners.third, startBase: 'third', endBase: 'home', out: false });
            if (hasSecond) advancements.push({ playerIdx: runners.second, startBase: 'second', endBase: 'home', out: false });
            if (hasFirst) advancements.push({ playerIdx: runners.first, startBase: 'first', endBase: 'home', out: false });
            return { advancements, ambiguousRunners };
        }

        // BB/HBP: forced advances only
        if (result === 'BB' || result === 'HBP') {
            // Forces work from the bottom up: runner on 1st forced to 2nd,
            // runner on 2nd forced to 3rd ONLY IF runner on 1st is being forced there,
            // runner on 3rd forced home ONLY IF runner on 2nd is being forced there.
            if (hasFirst) {
                advancements.push({ playerIdx: runners.first, startBase: 'first', endBase: 'second', out: false });
                if (hasSecond) {
                    advancements.push({ playerIdx: runners.second, startBase: 'second', endBase: 'third', out: false });
                    if (hasThird) {
                        advancements.push({ playerIdx: runners.third, startBase: 'third', endBase: 'home', out: false });
                    }
                }
            }
            // Non-forced runners hold
            return { advancements, ambiguousRunners };
        }

        // Pure outs with no batter reaching base: runners hold
        if (result === 'K' || result === 'KL') {
            return { advancements, ambiguousRunners };
        }

        // GO/FO/LO/PO: batter is out, but runners COULD advance (tag up on fly, advance on ground)
        // These are ambiguous — runners might advance or hold
        if (result === 'GO' || result === 'FO' || result === 'LO' || result === 'PO') {
            if (hasThird) ambiguousRunners.push({ playerIdx: runners.third, startBase: 'third' });
            if (hasSecond) ambiguousRunners.push({ playerIdx: runners.second, startBase: 'second' });
            if (hasFirst) ambiguousRunners.push({ playerIdx: runners.first, startBase: 'first' });
            return { advancements, ambiguousRunners };
        }

        // DP: ambiguous — could be different combinations
        if (result === 'DP' || result === 'TP') {
            if (hasThird) ambiguousRunners.push({ playerIdx: runners.third, startBase: 'third' });
            if (hasSecond) ambiguousRunners.push({ playerIdx: runners.second, startBase: 'second' });
            if (hasFirst) ambiguousRunners.push({ playerIdx: runners.first, startBase: 'first' });
            return { advancements, ambiguousRunners };
        }

        // 1B: forced runners advance, non-forced are ambiguous
        if (result === '1B') {
            if (hasFirst && hasSecond && hasThird) {
                // All forced
                advancements.push({ playerIdx: runners.first, startBase: 'first', endBase: 'second', out: false });
                advancements.push({ playerIdx: runners.second, startBase: 'second', endBase: 'third', out: false });
                // Runner on 3rd is ambiguous (could score or not, though usually scores)
                ambiguousRunners.push({ playerIdx: runners.third, startBase: 'third' });
            } else if (hasFirst && hasSecond) {
                // 1st forced to 2nd, 2nd is ambiguous
                advancements.push({ playerIdx: runners.first, startBase: 'first', endBase: 'second', out: false });
                ambiguousRunners.push({ playerIdx: runners.second, startBase: 'second' });
            } else if (hasFirst && hasThird) {
                // 1st forced to 2nd, 3rd is ambiguous
                advancements.push({ playerIdx: runners.first, startBase: 'first', endBase: 'second', out: false });
                ambiguousRunners.push({ playerIdx: runners.third, startBase: 'third' });
            } else if (hasSecond && hasThird) {
                // No force — both ambiguous
                ambiguousRunners.push({ playerIdx: runners.third, startBase: 'third' });
                ambiguousRunners.push({ playerIdx: runners.second, startBase: 'second' });
            } else if (hasFirst) {
                // Forced to 2nd
                advancements.push({ playerIdx: runners.first, startBase: 'first', endBase: 'second', out: false });
            } else if (hasSecond) {
                ambiguousRunners.push({ playerIdx: runners.second, startBase: 'second' });
            } else if (hasThird) {
                ambiguousRunners.push({ playerIdx: runners.third, startBase: 'third' });
            }
            return { advancements, ambiguousRunners };
        }

        // 2B: runner on 1st ambiguous (could score or hold 3rd), others likely score
        if (result === '2B') {
            if (hasThird) advancements.push({ playerIdx: runners.third, startBase: 'third', endBase: 'home', out: false });
            if (hasSecond) advancements.push({ playerIdx: runners.second, startBase: 'second', endBase: 'home', out: false });
            if (hasFirst) ambiguousRunners.push({ playerIdx: runners.first, startBase: 'first' });
            return { advancements, ambiguousRunners };
        }

        // 3B: all runners score
        if (result === '3B') {
            if (hasThird) advancements.push({ playerIdx: runners.third, startBase: 'third', endBase: 'home', out: false });
            if (hasSecond) advancements.push({ playerIdx: runners.second, startBase: 'second', endBase: 'home', out: false });
            if (hasFirst) advancements.push({ playerIdx: runners.first, startBase: 'first', endBase: 'home', out: false });
            return { advancements, ambiguousRunners };
        }

        // E, FC, SAC, SF — all ambiguous with runners
        if (hasThird) ambiguousRunners.push({ playerIdx: runners.third, startBase: 'third' });
        if (hasSecond) ambiguousRunners.push({ playerIdx: runners.second, startBase: 'second' });
        if (hasFirst) ambiguousRunners.push({ playerIdx: runners.first, startBase: 'first' });

        return { advancements, ambiguousRunners };
    }

    /**
     * Get advancement options for a runner on a given base.
     * Returns array of { label, endBase, out } options.
     */
    function getAdvancementOptions(startBase) {
        const options = [{ label: 'Hold', endBase: startBase, out: false }];
        const idx = BASE_ORDER.indexOf(startBase);
        for (let i = idx + 1; i < BASE_ORDER.length; i++) {
            const base = BASE_ORDER[i];
            const label = base === 'home' ? 'Scores' : `→ ${base.charAt(0).toUpperCase() + base.slice(1)}`;
            options.push({ label, endBase: base, out: false });
        }
        options.push({ label: 'Out', endBase: startBase, out: true });
        return options;
    }

    // ---- Pitch Tracking Helpers ----

    const STRIKE_ZONES = [
        'up-in', 'up-mid', 'up-away',
        'mid-in', 'mid-mid', 'mid-away',
        'down-in', 'down-mid', 'down-away'
    ];

    const OUTSIDE_ZONES = [
        'off-up-in', 'off-up', 'off-up-away',
        'off-in', 'off-away',
        'off-down-in', 'off-down', 'off-down-away'
    ];

    const WAY_OUTSIDE_ZONES = [
        'way-up', 'way-down', 'way-in', 'way-away'
    ];

    function isZoneStrike(zone) {
        return STRIKE_ZONES.includes(zone);
    }

    function isZoneOutside(zone) {
        return OUTSIDE_ZONES.includes(zone) || WAY_OUTSIDE_ZONES.includes(zone);
    }

    /**
     * Determine if a pitch is a missed call.
     * - Ball called on a pitch in the strike zone
     * - Called strike on a pitch outside the zone
     * Accepts either a zone string or x,y coordinates in the 180x210 viewBox.
     */
    function isMissedCall(zone, outcome, pitchX, pitchY) {
        // If we have coordinates, check against the strike zone rectangle bounds
        if (pitchX != null && pitchY != null) {
            const inZone = isPitchInStrikeZone(pitchX, pitchY);
            if (outcome === 'B' && inZone) return true;
            if (outcome === 'CS' && !inZone) return true;
            return false;
        }
        // Fallback to zone-based check
        if (outcome === 'B' && isZoneStrike(zone)) return true;
        if (outcome === 'CS' && isZoneOutside(zone)) return true;
        return false;
    }

    /**
     * Check if pitch coordinates (in the 180x210 viewBox) fall inside the strike zone.
     * Strike zone rectangle: x: 50-128, y: 45-123
     */
    function isPitchInStrikeZone(px, py) {
        return px >= 50 && px <= 128 && py >= 45 && py <= 123;
    }

    /**
     * Calculate the count from a pitch array.
     * @param {object[]} pitches
     * @returns {{ balls: number, strikes: number }}
     */
    function calcCount(pitches) {
        let balls = 0, strikes = 0;
        for (const p of pitches) {
            if (p.outcome === 'B') {
                balls++;
            } else if (p.outcome === 'CS' || p.outcome === 'SS') {
                strikes++;
            } else if (p.outcome === 'F') {
                // Fouls only add strikes if count < 2
                if (strikes < 2) strikes++;
            }
            // IP and HBP don't change the count (they end the at-bat)
        }
        return { balls: Math.min(balls, 4), strikes: Math.min(strikes, 3) };
    }

    /**
     * Get the display label for a zone based on batter handedness.
     * @param {string} zone - zone identifier
     * @param {string} hand - 'R' or 'L'
     * @returns {string}
     */
    function getZoneLabel(zone, hand) {
        // For LHB, "in" and "away" swap visually but the stored data stays the same
        const labels = {
            'up-in': 'Up & In', 'up-mid': 'Up Middle', 'up-away': 'Up & Away',
            'mid-in': 'Middle In', 'mid-mid': 'Middle Middle', 'mid-away': 'Middle Away',
            'down-in': 'Down & In', 'down-mid': 'Down Middle', 'down-away': 'Down & Away',
            'off-up-in': 'Off Up & In', 'off-up': 'Off Up', 'off-up-away': 'Off Up & Away',
            'off-in': 'Off In', 'off-away': 'Off Away',
            'off-down-in': 'Off Down & In', 'off-down': 'Off Down', 'off-down-away': 'Off Down & Away',
            'way-up': 'Way Up', 'way-down': 'Way Down', 'way-in': 'Way In', 'way-away': 'Way Away'
        };
        return labels[zone] || zone;
    }

    /**
     * Calculate pitcher stats by aggregating pitches from at-bats they faced.
     * @param {object} allAtBats - game.atBats map
     * @param {string} pitcherTeam - 'away' or 'home'
     * @param {number} pitcherIdx - index into team.pitchers array
     * @returns {{ totalPitches, strikes, balls, allPitches[] }}
     */
    function calcPitcherStats(allAtBats, pitcherTeam, pitcherIdx) {
        let totalPitches = 0, strikes = 0, balls = 0;
        const allPitches = [];
        const STRIKE_OUTCOMES = ['CS', 'SS', 'F', 'IP'];

        for (const ab of Object.values(allAtBats)) {
            if (!ab || !ab.pitcherInfo) continue;
            if (ab.pitcherInfo.team !== pitcherTeam || ab.pitcherInfo.pitcherIdx !== pitcherIdx) continue;
            if (!ab.pitches || ab.pitches.length === 0) continue;

            for (const p of ab.pitches) {
                totalPitches++;
                if (STRIKE_OUTCOMES.includes(p.outcome)) {
                    strikes++;
                } else {
                    balls++;
                }
                allPitches.push(p);
            }
        }

        return { totalPitches, strikes, balls, allPitches };
    }

    return {
        HIT_RESULTS, WALK_RESULTS, OUT_RESULTS, SPECIAL_RESULTS,
        isHit, isWalk, isOut, isStrikeout, countsAsAtBat,
        defaultBasesForResult, buildNotation,
        calcPlayerStats, calcInningTotals,
        getBaseRunners, resolveRunnerAdvancements, getAdvancementOptions,
        BASE_ORDER, nextBase,
        STRIKE_ZONES, OUTSIDE_ZONES, WAY_OUTSIDE_ZONES,
        isZoneStrike, isZoneOutside, isMissedCall, isPitchInStrikeZone, calcCount, getZoneLabel,
        calcPitcherStats
    };
})();
