/* ============================================================
   stats.js — Season Stat Aggregation Engine
   ============================================================ */

const Stats = (() => {
    'use strict';

    /**
     * Aggregate batting stats for a single player across multiple games.
     * Player matched by name (case-insensitive trim).
     */
    function calcSeasonBatting(games, playerName, filters) {
        const totals = {
            g: 0, ab: 0, r: 0, h: 0,
            '2b': 0, '3b': 0, hr: 0,
            rbi: 0, bb: 0, hbp: 0, so: 0,
            sf: 0, sac: 0, sb: 0
        };

        const target = playerName.trim().toLowerCase();

        for (const game of games) {
            if (!passesFilter(game, filters)) continue;

            for (const teamKey of ['awayTeam', 'homeTeam']) {
                const team = game[teamKey];
                const side = teamKey === 'awayTeam' ? 'away' : 'home';
                const playerIdx = team.players.findIndex(
                    p => p.name && p.name.trim().toLowerCase() === target
                );
                if (playerIdx === -1) continue;

                let appearedInGame = false;
                for (let inn = 1; inn <= (game.innings || 9); inn++) {
                    const key = `${side}-${playerIdx}-${inn}`;
                    const ab = game.atBats[key];
                    if (!ab || !ab.result) continue;
                    appearedInGame = true;

                    if (Scoring.countsAsAtBat(ab.result)) totals.ab++;
                    if (ab.bases && ab.bases.home) totals.r++;
                    if (Scoring.isHit(ab.result)) totals.h++;
                    if (ab.result === '2B') totals['2b']++;
                    if (ab.result === '3B') totals['3b']++;
                    if (ab.result === 'HR') totals.hr++;
                    totals.rbi += ab.rbiCount || 0;
                    if (ab.result === 'BB') totals.bb++;
                    if (ab.result === 'HBP') totals.hbp++;
                    if (Scoring.isStrikeout(ab.result)) totals.so++;
                    if (ab.result === 'SF') totals.sf++;
                    if (ab.result === 'SAC') totals.sac++;
                }

                // Count SBs: look at all atBats for runner advancements involving this player
                for (const abKey of Object.keys(game.atBats)) {
                    if (!abKey.startsWith(side + '-')) continue;
                    const ab = game.atBats[abKey];
                    if (!ab) continue;
                    // Check advanceReasons on this player's at-bat for SB
                    if (ab.advanceReasons && parseInt(abKey.split('-')[1], 10) === playerIdx) {
                        for (const reason of Object.values(ab.advanceReasons)) {
                            if (reason === 'SB') totals.sb++;
                        }
                    }
                    // Check runnerAdvancements on other players' at-bats
                    if (ab.runnerAdvancements) {
                        for (const adv of ab.runnerAdvancements) {
                            if (adv.playerIdx === playerIdx && adv.reason === 'SB' && !adv.out) {
                                totals.sb++;
                            }
                        }
                    }
                }

                if (appearedInGame) totals.g++;
            }
        }

        return deriveBattingStats(totals);
    }

    function deriveBattingStats(totals) {
        totals['1b'] = totals.h - totals['2b'] - totals['3b'] - totals.hr;
        const tb = totals['1b'] + (totals['2b'] * 2) + (totals['3b'] * 3) + (totals.hr * 4);
        totals.avg = totals.ab > 0 ? (totals.h / totals.ab) : 0;
        totals.slg = totals.ab > 0 ? (tb / totals.ab) : 0;
        const obpDenom = totals.ab + totals.bb + totals.hbp + totals.sf;
        totals.obp = obpDenom > 0
            ? ((totals.h + totals.bb + totals.hbp) / obpDenom)
            : 0;
        totals.ops = totals.obp + totals.slg;
        totals.tb = tb;
        return totals;
    }

    /**
     * Aggregate pitching stats for a named pitcher across games.
     */
    function calcSeasonPitching(games, pitcherName, filters) {
        const totals = {
            g: 0, ip: 0, h: 0, r: 0, er: 0,
            bb: 0, so: 0, totalPitches: 0, strikes: 0,
            hbp: 0, hr: 0
        };

        const target = pitcherName.trim().toLowerCase();
        const STRIKE_OUTCOMES = ['CS', 'SS', 'F', 'IP'];

        for (const game of games) {
            if (!passesFilter(game, filters)) continue;

            for (const teamKey of ['awayTeam', 'homeTeam']) {
                const team = game[teamKey];
                const side = teamKey === 'awayTeam' ? 'away' : 'home';
                const pitcherIdx = team.pitchers.findIndex(
                    p => p.name && p.name.trim().toLowerCase() === target
                );
                if (pitcherIdx === -1) continue;

                totals.g++;

                // Approximate IP from innings range
                const pitcher = team.pitchers[pitcherIdx];
                const startInn = pitcher.startInning || 1;
                const endInn = pitcher.endInning || (game.innings || 9);
                totals.ip += (endInn - startInn + 1);

                // Scan at-bats faced by this pitcher
                // Pitcher faces the OTHER team's batters
                const battingSide = side === 'away' ? 'home' : 'away';
                for (const abKey of Object.keys(game.atBats)) {
                    if (!abKey.startsWith(battingSide + '-')) continue;
                    const ab = game.atBats[abKey];
                    if (!ab || !ab.pitcherInfo) continue;
                    if (ab.pitcherInfo.team !== side || ab.pitcherInfo.pitcherIdx !== pitcherIdx) continue;

                    if (Scoring.isHit(ab.result)) totals.h++;
                    if (ab.result === 'HR') totals.hr++;
                    if (ab.bases && ab.bases.home) totals.r++;
                    if (ab.bases && ab.bases.home && ab.result !== 'E') totals.er++;
                    if (ab.result === 'BB') totals.bb++;
                    if (ab.result === 'HBP') totals.hbp++;
                    if (Scoring.isStrikeout(ab.result)) totals.so++;

                    if (ab.pitches) {
                        for (const p of ab.pitches) {
                            totals.totalPitches++;
                            if (STRIKE_OUTCOMES.includes(p.outcome)) {
                                totals.strikes++;
                            }
                        }
                    }
                }
            }
        }

        // Derived
        totals.era = totals.ip > 0 ? ((totals.er / totals.ip) * 9) : 0;
        totals.whip = totals.ip > 0 ? ((totals.bb + totals.h) / totals.ip) : 0;
        return totals;
    }

    /**
     * Get all unique player names with metadata across all games.
     */
    function getAllPlayers(games, filters) {
        const map = {}; // name → { name, teams: Set, positions: Set }

        for (const game of games) {
            if (!passesFilter(game, filters)) continue;
            for (const teamKey of ['awayTeam', 'homeTeam']) {
                const team = game[teamKey];
                for (const p of team.players) {
                    if (!p.name || !p.name.trim()) continue;
                    const key = p.name.trim().toLowerCase();
                    if (!map[key]) {
                        map[key] = { name: p.name.trim(), teams: new Set(), positions: new Set() };
                    }
                    if (team.name) map[key].teams.add(team.name);
                    if (p.position) map[key].positions.add(p.position);
                }
            }
        }

        return Object.values(map).map(p => ({
            name: p.name,
            teams: [...p.teams],
            positions: [...p.positions]
        }));
    }

    /**
     * Get all unique pitcher names across all games.
     */
    function getAllPitchers(games, filters) {
        const map = {};

        for (const game of games) {
            if (!passesFilter(game, filters)) continue;
            for (const teamKey of ['awayTeam', 'homeTeam']) {
                const team = game[teamKey];
                for (const p of (team.pitchers || [])) {
                    if (!p.name || !p.name.trim()) continue;
                    const key = p.name.trim().toLowerCase();
                    if (!map[key]) {
                        map[key] = { name: p.name.trim(), teams: new Set() };
                    }
                    if (team.name) map[key].teams.add(team.name);
                }
            }
        }

        return Object.values(map).map(p => ({
            name: p.name,
            teams: [...p.teams]
        }));
    }

    /**
     * Calculate team win/loss records and run totals.
     */
    function calcTeamStandings(games, filters) {
        const map = {}; // teamName → { w, l, t, rs, ra, g }

        for (const game of games) {
            if (!passesFilter(game, filters)) continue;
            if (game.status !== 'completed') continue;

            const awayName = (game.awayTeam.name || 'Visitors').trim();
            const homeName = (game.homeTeam.name || 'Home').trim();

            if (!map[awayName]) map[awayName] = { name: awayName, w: 0, l: 0, t: 0, rs: 0, ra: 0, g: 0 };
            if (!map[homeName]) map[homeName] = { name: homeName, w: 0, l: 0, t: 0, rs: 0, ra: 0, g: 0 };

            // Calculate total runs
            let awayRuns = 0, homeRuns = 0;
            for (const abKey of Object.keys(game.atBats)) {
                const ab = game.atBats[abKey];
                if (!ab || !ab.bases || !ab.bases.home) continue;
                if (abKey.startsWith('away-')) awayRuns++;
                else if (abKey.startsWith('home-')) homeRuns++;
            }

            map[awayName].g++;
            map[awayName].rs += awayRuns;
            map[awayName].ra += homeRuns;

            map[homeName].g++;
            map[homeName].rs += homeRuns;
            map[homeName].ra += awayRuns;

            if (awayRuns > homeRuns) {
                map[awayName].w++;
                map[homeName].l++;
            } else if (homeRuns > awayRuns) {
                map[homeName].w++;
                map[awayName].l++;
            } else {
                map[awayName].t++;
                map[homeName].t++;
            }
        }

        return Object.values(map).sort((a, b) => {
            const aPct = a.g > 0 ? a.w / a.g : 0;
            const bPct = b.g > 0 ? b.w / b.g : 0;
            return bPct - aPct;
        });
    }

    /**
     * Get all unique team names across all games.
     */
    function getAllTeamNames(games) {
        const names = new Set();
        for (const game of games) {
            if (game.awayTeam.name) names.add(game.awayTeam.name.trim());
            if (game.homeTeam.name) names.add(game.homeTeam.name.trim());
        }
        return [...names].sort();
    }

    function passesFilter(game, filters) {
        if (!filters) return true;
        if (filters.teamName) {
            const t = filters.teamName.trim().toLowerCase();
            const away = (game.awayTeam.name || '').trim().toLowerCase();
            const home = (game.homeTeam.name || '').trim().toLowerCase();
            if (away !== t && home !== t) return false;
        }
        if (filters.dateFrom && game.date < filters.dateFrom) return false;
        if (filters.dateTo && game.date > filters.dateTo) return false;
        return true;
    }

    /**
     * Calculate the final score of a game.
     */
    function calcGameScore(game) {
        let awayRuns = 0, homeRuns = 0;
        for (const abKey of Object.keys(game.atBats || {})) {
            const ab = game.atBats[abKey];
            if (!ab || !ab.bases || !ab.bases.home) continue;
            if (abKey.startsWith('away-')) awayRuns++;
            else if (abKey.startsWith('home-')) homeRuns++;
        }
        return { away: awayRuns, home: homeRuns };
    }

    function fmtAvg(val) {
        if (val === 0) return '.000';
        return val.toFixed(3).replace(/^0/, '');
    }

    function fmtEra(val) {
        return val.toFixed(2);
    }

    return {
        calcSeasonBatting, calcSeasonPitching,
        getAllPlayers, getAllPitchers, getAllTeamNames,
        calcTeamStandings, calcGameScore,
        fmtAvg, fmtEra
    };
})();
