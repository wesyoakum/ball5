/* ============================================================
   diamond.js — SVG Diamond Rendering for Baseball Scorebook
   ============================================================ */

const Diamond = (() => {
    // Scorer ink — all marks added by the scorer use this blue, consistent width
    const INK = '#2255aa';
    const INK_W = 1.5; // uniform stroke width for all scorer marks

    // Diamond geometry: center-origin coordinates for a 64x64 viewBox
    const CX = 32, CY = 38;
    const SIZE = 18; // distance from center to base

    // Base positions (home at bottom, 1st right, 2nd top, 3rd left)
    const BASES = {
        home:   { x: CX,        y: CY + SIZE },
        first:  { x: CX + SIZE, y: CY },
        second: { x: CX,        y: CY - SIZE },
        third:  { x: CX - SIZE, y: CY }
    };

    // Path segments between bases
    const PATHS = {
        toFirst:  [BASES.home, BASES.first],
        toSecond: [BASES.first, BASES.second],
        toThird:  [BASES.second, BASES.third],
        toHome:   [BASES.third, BASES.home]
    };

    function createSVG() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 64 64');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        return svg;
    }

    function drawEmptyDiamond(svg, scored) {
        // Diamond outline (shaded if runner scored)
        const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        const points = [
            `${BASES.home.x},${BASES.home.y}`,
            `${BASES.first.x},${BASES.first.y}`,
            `${BASES.second.x},${BASES.second.y}`,
            `${BASES.third.x},${BASES.third.y}`
        ].join(' ');
        diamond.setAttribute('points', points);
        if (scored) {
            diamond.setAttribute('fill', INK);
            diamond.setAttribute('fill-opacity', '0.25');
        } else {
            diamond.setAttribute('fill', '#c8dcc0');
            diamond.setAttribute('fill-opacity', '0.4');
        }
        diamond.setAttribute('stroke', '#5a7a50');
        diamond.setAttribute('stroke-width', '0.8');
        svg.appendChild(diamond);

        // Base squares/dots
        for (const [name, pos] of Object.entries(BASES)) {
            const base = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            const s = name === 'home' ? 4 : 3;
            base.setAttribute('x', pos.x - s / 2);
            base.setAttribute('y', pos.y - s / 2);
            base.setAttribute('width', s);
            base.setAttribute('height', s);
            base.setAttribute('fill', '#5a7a50');
            if (name === 'home') {
                base.setAttribute('transform', `rotate(45 ${pos.x} ${pos.y})`);
            }
            svg.appendChild(base);
        }

        // Invisible larger click targets on all bases for runner advancement
        for (const name of ['first', 'second', 'third', 'home']) {
            const pos = BASES[name];
            const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            hitArea.setAttribute('cx', pos.x);
            hitArea.setAttribute('cy', pos.y);
            hitArea.setAttribute('r', '6');
            hitArea.setAttribute('fill', 'transparent');
            hitArea.setAttribute('data-base-click', name);
            hitArea.style.cursor = 'pointer';
            svg.appendChild(hitArea);
        }
    }

    function drawBasePath(svg, from, to, scored = false) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', from.x);
        line.setAttribute('y1', from.y);
        line.setAttribute('x2', to.x);
        line.setAttribute('y2', to.y);
        line.setAttribute('stroke', INK);
        line.setAttribute('stroke-width', INK_W);
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);
    }

    /**
     * Draw a half-line from previous base toward target base, ending with an X.
     * Used when a runner is thrown out attempting the next base.
     */
    function drawOutOnBasePath(svg, from, to) {
        // Draw line halfway
        const midX = from.x + (to.x - from.x) * 0.55;
        const midY = from.y + (to.y - from.y) * 0.55;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', from.x);
        line.setAttribute('y1', from.y);
        line.setAttribute('x2', midX);
        line.setAttribute('y2', midY);
        line.setAttribute('stroke', INK);
        line.setAttribute('stroke-width', INK_W);
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);

        // Draw X at the end
        const xSize = 2.5;
        const x1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        x1.setAttribute('x1', midX - xSize); x1.setAttribute('y1', midY - xSize);
        x1.setAttribute('x2', midX + xSize); x1.setAttribute('y2', midY + xSize);
        x1.setAttribute('stroke', INK);
        x1.setAttribute('stroke-width', INK_W);
        x1.setAttribute('stroke-linecap', 'round');
        svg.appendChild(x1);

        const x2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        x2.setAttribute('x1', midX + xSize); x2.setAttribute('y1', midY - xSize);
        x2.setAttribute('x2', midX - xSize); x2.setAttribute('y2', midY + xSize);
        x2.setAttribute('stroke', INK);
        x2.setAttribute('stroke-width', INK_W);
        x2.setAttribute('stroke-linecap', 'round');
        svg.appendChild(x2);
    }

    function drawBasePaths(svg, bases, baseRunOuts, outNumber) {
        // bases = { first: bool, second: bool, third: bool, home: bool }
        // baseRunOuts = { baseName: { reason, out: true } } — optional

        const outs = baseRunOuts || {};
        const segments = [
            { from: 'home',   to: 'first',  base: 'first' },
            { from: 'first',  to: 'second', base: 'second' },
            { from: 'second', to: 'third',  base: 'third' },
            { from: 'third',  to: 'home',   base: 'home' }
        ];

        // Determine the furthest base reached (for drawing safe paths)
        const baseOrder = ['first', 'second', 'third', 'home'];
        let furthestSafe = -1;
        for (let i = baseOrder.length - 1; i >= 0; i--) {
            if (bases[baseOrder[i]]) { furthestSafe = i; break; }
        }

        const scored = bases.home;

        // If batter is out and didn't reach any base, draw half-line with X toward 1st
        if (outNumber >= 1 && furthestSafe < 0 && !outs['first']) {
            drawOutOnBasePath(svg, BASES.home, BASES.first);
        }

        // Draw safe base path segments up to the furthest base reached
        for (let i = 0; i <= furthestSafe; i++) {
            const seg = segments[i];
            drawBasePath(svg, BASES[seg.from], BASES[seg.to], scored);
        }

        // Draw out-on-bases: half-line with X for each base the runner was thrown out at
        for (const [baseName, outInfo] of Object.entries(outs)) {
            const segIdx = baseOrder.indexOf(baseName);
            if (segIdx >= 0) {
                const seg = segments[segIdx];
                drawOutOnBasePath(svg, BASES[seg.from], BASES[seg.to]);
            }
        }
    }

    /**
     * Draw advancement reason labels (SB, WP, etc.) near the base they advanced to.
     * Positioned just outside the diamond near the relevant base.
     */
    /**
     * Draw advancement reason labels (SB, WP, etc.) outside the diamond,
     * along the line between the previous base and the destination base.
     */
    function drawAdvanceReasons(svg, advanceReasons) {
        if (!advanceReasons) return;

        // Map destination base → previous base
        const prevBase = {
            first:  'home',
            second: 'first',
            third:  'second',
            home:   'third'
        };

        for (const [destName, reason] of Object.entries(advanceReasons)) {
            const fromName = prevBase[destName];
            if (!fromName) continue;

            const from = BASES[fromName];
            const to = BASES[destName];

            // Midpoint of the base path line
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;

            // Perpendicular outward from diamond center
            const dx = midX - CX;
            const dy = midY - CY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const offset = 8; // how far outside the line to place the label
            const nx = dx / dist * offset;
            const ny = dy / dist * offset;

            const lx = midX + nx;
            const ly = midY + ny;

            // Anchor based on side — keep text inside the viewBox
            // Right side: anchor end so text extends leftward
            // Left side: anchor start so text extends rightward
            const anchor = lx >= CX ? 'end' : 'start';

            // Scale font down for longer labels (e.g., "CS 2-6")
            const fontSize = reason.length <= 3 ? 6 : reason.length <= 5 ? 5.5 : 5;

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', lx);
            text.setAttribute('y', ly);
            text.setAttribute('text-anchor', anchor);
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('font-family', "'Caveat', cursive");
            text.setAttribute('font-size', fontSize);
            text.setAttribute('font-weight', '600');
            text.setAttribute('fill', INK);
            text.setAttribute('stroke', INK);
            text.setAttribute('stroke-width', '0.3');
            text.textContent = reason;
            svg.appendChild(text);
        }
    }

    function drawPlayText(svg, result, fielderNotation, outNumber) {
        const display = fielderNotation || result || '';
        if (!display) return;

        const len = display.length;
        const fontSize = len <= 2 ? 11 : len <= 4 ? 9 : 7.5;

        // If there's an out, circle the play text
        if (outNumber && outNumber >= 1) {
            // Measure approximate text width for the ellipse
            const charWidth = fontSize * 0.55;
            const textWidth = len * charWidth;
            const rx = Math.max(textWidth / 2 + 3, 8);
            const ry = fontSize / 2 + 3;
            const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
            ellipse.setAttribute('cx', CX);
            ellipse.setAttribute('cy', CY + 1);
            ellipse.setAttribute('rx', rx);
            ellipse.setAttribute('ry', ry);
            ellipse.setAttribute('fill', 'none');
            ellipse.setAttribute('stroke', INK);
            ellipse.setAttribute('stroke-width', INK_W);
            svg.appendChild(ellipse);
        }

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', CX);
        text.setAttribute('y', CY + 1);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-family', "'Caveat', cursive");
        text.setAttribute('font-weight', '700');
        text.setAttribute('fill', INK);
        text.setAttribute('font-size', fontSize);
        text.textContent = display;
        svg.appendChild(text);
    }

    /**
     * Draw a small "out" label in bottom-left when no out is recorded.
     * Clickable to trigger out-type selection.
     */
    function drawOutLabel(svg, outNumber) {
        // Only show "out" label if no out is recorded
        if (outNumber && outNumber >= 1) return;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', 3);
        text.setAttribute('y', 62);
        text.setAttribute('text-anchor', 'start');
        text.setAttribute('font-family', "'Caveat', cursive");
        text.setAttribute('font-size', '5');
        text.setAttribute('font-weight', '400');
        text.setAttribute('fill', '#bbb');
        text.setAttribute('data-quick-out', 'true');
        text.style.cursor = 'pointer';
        text.textContent = 'out';
        svg.appendChild(text);
    }

    function drawOutNumber(svg, outNumber) {
        if (!outNumber || outNumber < 1) return;

        // Circled number in bottom-left
        const cx = 9, cy = 57;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', '6');
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', INK);
        circle.setAttribute('stroke-width', INK_W);
        svg.appendChild(circle);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', cx);
        text.setAttribute('y', cy + 1);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-family', "'Caveat', cursive");
        text.setAttribute('font-size', '9');
        text.setAttribute('font-weight', '700');
        text.setAttribute('fill', INK);
        text.textContent = outNumber;
        svg.appendChild(text);
    }

    function drawRBI(svg, rbiCount) {
        if (!rbiCount || rbiCount < 1) return;

        // RBI indicator in top-left
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', 6);
        text.setAttribute('y', 9);
        text.setAttribute('text-anchor', 'start');
        text.setAttribute('font-family', "'Caveat', cursive");
        text.setAttribute('font-size', '8');
        text.setAttribute('font-weight', '700');
        text.setAttribute('fill', INK);
        text.textContent = rbiCount > 1 ? `${rbiCount}` : '•';
        svg.appendChild(text);
    }

    /**
     * Draw a small DP or TP tag in the bottom-left, above the out number.
     */
    function drawDpTag(svg, dpTag) {
        if (!dpTag) return;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', 9);
        text.setAttribute('y', 47);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-family', "'Caveat', cursive");
        text.setAttribute('font-size', '6');
        text.setAttribute('font-weight', '700');
        text.setAttribute('fill', INK);
        text.textContent = dpTag;
        svg.appendChild(text);
    }

    /**
     * Draw ball/strike count boxes in the top-right corner.
     * 3 small squares for balls (green fill when taken), 2 for strikes (red fill).
     */
    /**
     * Draw ball/strike count boxes in the bottom-right corner, stacked:
     * Top row: 2 strike boxes (right-justified)
     * Bottom row: 3 ball boxes (right-justified)
     * Like a traditional paper scorecard.
     */
    function drawCount(svg, count) {
        const balls = count ? count.balls : 0;
        const strikes = count ? count.strikes : 0;
        const boxSize = 3.5, gap = 1;
        const rightEdge = 62;
        const topRowY = 55;
        const botRowY = topRowY + boxSize + gap;

        // Top row: 2 strike boxes (right-justified)
        const strikeRowWidth = 2 * boxSize + gap;
        const strikeStartX = rightEdge - strikeRowWidth;
        for (let i = 0; i < 2; i++) {
            const bx = strikeStartX + i * (boxSize + gap);
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', bx); rect.setAttribute('y', topRowY);
            rect.setAttribute('width', boxSize); rect.setAttribute('height', boxSize);
            rect.setAttribute('rx', '0.3');
            rect.setAttribute('stroke', '#999'); rect.setAttribute('stroke-width', '0.3');
            rect.setAttribute('fill', i < strikes ? '#555' : 'none');
            svg.appendChild(rect);
        }

        // Bottom row: 3 ball boxes (right-justified)
        const ballRowWidth = 3 * boxSize + 2 * gap;
        const ballStartX = rightEdge - ballRowWidth;
        for (let i = 0; i < 3; i++) {
            const bx = ballStartX + i * (boxSize + gap);
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', bx); rect.setAttribute('y', botRowY);
            rect.setAttribute('width', boxSize); rect.setAttribute('height', boxSize);
            rect.setAttribute('rx', '0.3');
            rect.setAttribute('stroke', '#999'); rect.setAttribute('stroke-width', '0.3');
            rect.setAttribute('fill', i < balls ? '#555' : 'none');
            svg.appendChild(rect);
        }

        // Larger invisible click targets over each row for easy clicking
        const hitPad = 3; // extra padding around the boxes
        const strikeHit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        strikeHit.setAttribute('x', strikeStartX - hitPad);
        strikeHit.setAttribute('y', topRowY - hitPad);
        strikeHit.setAttribute('width', strikeRowWidth + hitPad * 2);
        strikeHit.setAttribute('height', boxSize + hitPad * 2);
        strikeHit.setAttribute('fill', 'transparent');
        strikeHit.setAttribute('data-quick-pitch', 'strike');
        strikeHit.style.cursor = 'pointer';
        svg.appendChild(strikeHit);

        const ballHit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        ballHit.setAttribute('x', ballStartX - hitPad);
        ballHit.setAttribute('y', botRowY - hitPad);
        ballHit.setAttribute('width', ballRowWidth + hitPad * 2);
        ballHit.setAttribute('height', boxSize + hitPad * 2);
        ballHit.setAttribute('fill', 'transparent');
        ballHit.setAttribute('data-quick-pitch', 'ball');
        ballHit.style.cursor = 'pointer';
        svg.appendChild(ballHit);
    }

    /**
     * Draw small BB/1B/2B/3B/HR labels stacked vertically in the top-right of the play box.
     * Always visible; the active result is highlighted.
     */
    const QUICK_LABELS = ['BB', '1B', '2B', '3B', 'HR'];
    function drawResultLabels(svg, result) {
        const x = 61;
        const startY = 6;
        const spacing = 7;
        const activeResult = result ? result.toUpperCase() : '';

        QUICK_LABELS.forEach((lbl, i) => {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', x);
            text.setAttribute('y', startY + i * spacing);
            text.setAttribute('text-anchor', 'end');
            text.setAttribute('font-family', "'Caveat', cursive");
            text.setAttribute('font-size', '5');
            text.setAttribute('font-weight', activeResult === lbl ? '800' : '400');
            text.setAttribute('fill', activeResult === lbl ? INK : '#bbb');
            text.textContent = lbl;
            text.setAttribute('data-quick-result', lbl);
            svg.appendChild(text);
        });
    }

    // ---- Spray Chart Line ----

    // Spray chart styles:
    // ground = dashed line (dash length controlled by slider value)
    // air = solid line (arc controlled by slider value)
    const SPRAY_STYLES = {
        ground: { width: INK_W, color: INK },  // dash is dynamic
        air:    { width: INK_W, color: INK }    // solid, arc is dynamic
    };

    /**
     * Calculate the control point for the quadratic bezier arc.
     * The control point is offset perpendicular to the midpoint of the line,
     * curving away from the center of the diamond.
     */
    function calcArcControlPoint(startX, startY, endX, endY, arcAmount) {
        if (arcAmount <= 0) return null;

        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;

        // Direction vector from start to end
        const dx = endX - startX;
        const dy = endY - startY;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.1) return null;

        // Perpendicular vector (normalized)
        const perpX = -dy / len;
        const perpY = dx / len;

        // Determine which side to curve: away from the center of the diamond
        // (ball arcs outward, like a real fly ball trajectory)
        const side = endX >= CX ? 1 : -1;

        // Scale: arc 0-100 maps to 0-30 viewBox units of offset
        const offset = (arcAmount / 100) * 30;

        return {
            x: midX + perpX * offset * side,
            y: midY + perpY * offset * side
        };
    }

    /**
     * Draw a spray chart line/curve from home plate to an endpoint.
     * @param {SVGElement} svg
     * @param {object} sprayChart - { endX, endY, slider, style }
     *   style: 'ground' (dashed, slider=dash length) or 'air' (solid, slider=arc)
     */
    function drawSprayLine(svg, sprayChart) {
        if (!sprayChart || sprayChart.endX == null || sprayChart.endY == null) return;

        const startX = BASES.home.x;
        const startY = BASES.home.y;
        const { endX, endY, slider, style } = sprayChart;
        // Support legacy 'arc' field
        const sliderVal = slider != null ? slider : (sprayChart.arc || 0);
        const s = SPRAY_STYLES[style] || SPRAY_STYLES.ground;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

        if (style === 'air') {
            // Solid line with arc from slider
            const cp = calcArcControlPoint(startX, startY, endX, endY, sliderVal);
            const d = cp
                ? `M ${startX} ${startY} Q ${cp.x} ${cp.y} ${endX} ${endY}`
                : `M ${startX} ${startY} L ${endX} ${endY}`;
            path.setAttribute('d', d);
        } else {
            // Ground ball: straight dashed line, slider controls dash length
            path.setAttribute('d', `M ${startX} ${startY} L ${endX} ${endY}`);
            // Calculate line length to scale dashes
            const dx = endX - startX, dy = endY - startY;
            const lineLen = Math.sqrt(dx * dx + dy * dy);
            const gapLen = 2.5;
            // Slider 0: one long dash with one gap (nearly full line)
            // Slider 100: many short dots (dash=1)
            // At min (0): dashLen = lineLen - gapLen (one gap only)
            // At max (100): dashLen = 1 (dotted)
            const maxDash = Math.max(lineLen - gapLen, 2);
            const dashLen = maxDash - (sliderVal / 100) * (maxDash - 1);
            path.setAttribute('stroke-dasharray', `${dashLen},${gapLen}`);
        }

        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', s.color);
        path.setAttribute('stroke-width', s.width);
        path.setAttribute('stroke-linecap', 'round');
        svg.appendChild(path);

        // Small dot at the endpoint
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', endX);
        dot.setAttribute('cy', endY);
        dot.setAttribute('r', '1.5');
        dot.setAttribute('fill', s.color);
        svg.appendChild(dot);
    }

    /**
     * Render a complete diamond cell
     * @param {object} atBat - { result, fielderNotation, bases, outNumber, rbiCount, sprayChart }
     *                         or null for empty cell
     * @returns {SVGElement}
     */
    function render(atBat) {
        const svg = createSVG();
        const scored = atBat && atBat.bases && atBat.bases.home;
        drawEmptyDiamond(svg, scored);

        // Always draw count boxes, result labels, and out label (even on empty cells)
        drawCount(svg, atBat ? atBat.count : null);
        drawResultLabels(svg, atBat ? atBat.result : null);
        drawOutLabel(svg, atBat ? atBat.outNumber : 0);

        if (atBat) {
            drawSprayLine(svg, atBat.sprayChart);
            drawBasePaths(svg, atBat.bases || {}, atBat.baseRunOuts, atBat.outNumber || 0);
            drawAdvanceReasons(svg, atBat.advanceReasons);
            drawPlayText(svg, atBat.result, atBat.fielderNotation, atBat.outNumber);
            drawOutNumber(svg, atBat.outNumber);
            drawDpTag(svg, atBat.dpTag);
            drawRBI(svg, atBat.rbiCount);
        }

        return svg;
    }

    /**
     * Render a larger preview diamond for the modal
     */
    function renderPreview(atBat) {
        const container = document.createElement('div');
        container.className = 'diamond-container';
        container.appendChild(render(atBat));
        return container;
    }

    /**
     * Render an interactive diamond for the modal with click-to-place spray endpoint.
     * @param {object} atBat
     * @param {function} onClick - called with (x, y) in viewBox coords when user clicks
     * @returns {HTMLElement} container
     */
    function renderInteractive(atBat, onClick) {
        const container = document.createElement('div');
        container.className = 'diamond-container diamond-interactive';

        const svg = createSVG();
        svg.style.cursor = 'crosshair';
        const scored = atBat && atBat.bases && atBat.bases.home;
        drawEmptyDiamond(svg, scored);

        drawCount(svg, atBat ? atBat.count : null);
        drawResultLabels(svg, atBat ? atBat.result : null);

        if (atBat) {
            drawSprayLine(svg, atBat.sprayChart);
            drawBasePaths(svg, atBat.bases || {}, atBat.baseRunOuts, atBat.outNumber || 0);
            drawAdvanceReasons(svg, atBat.advanceReasons);
            drawPlayText(svg, atBat.result, atBat.fielderNotation, atBat.outNumber);
            drawOutNumber(svg, atBat.outNumber);
            drawDpTag(svg, atBat.dpTag);
            drawRBI(svg, atBat.rbiCount);
        }

        // Transparent overlay to capture clicks
        const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        overlay.setAttribute('x', '0');
        overlay.setAttribute('y', '0');
        overlay.setAttribute('width', '64');
        overlay.setAttribute('height', '64');
        overlay.setAttribute('fill', 'transparent');
        overlay.style.cursor = 'crosshair';
        svg.appendChild(overlay);

        // Click-and-drag spray chart:
        // mousedown = set endpoint, drag up = air (arc), drag down = ground (dashes)
        let dragging = false;
        let dragStartScreenY = 0;
        let sprayX = 0, sprayY = 0;

        function screenToViewBox(e) {
            const rect = svg.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) * (64 / rect.width),
                y: (e.clientY - rect.top) * (64 / rect.height)
            };
        }

        svg.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const vb = screenToViewBox(e);
            sprayX = vb.x;
            sprayY = vb.y;
            dragStartScreenY = e.clientY;
            dragging = true;
            // Immediately show with no arc/dash (just a click so far)
            if (onClick) onClick(sprayX, sprayY, 0, 'ground', true); // true = preview
        });

        document.addEventListener('mousemove', function onMove(e) {
            if (!dragging) return;
            const deltaY = dragStartScreenY - e.clientY; // positive = dragged up
            let style, slider;
            if (deltaY > 5) {
                // Dragged up = air, arc amount scales with distance
                style = 'air';
                slider = Math.min(100, Math.round((deltaY - 5) * 1.2));
            } else if (deltaY < -5) {
                // Dragged down = ground, dash intensity scales with distance
                style = 'ground';
                slider = Math.min(100, Math.round((-deltaY - 5) * 1.2));
            } else {
                style = 'ground';
                slider = 0;
            }
            if (onClick) onClick(sprayX, sprayY, slider, style, true); // preview
        });

        document.addEventListener('mouseup', function onUp(e) {
            if (!dragging) return;
            dragging = false;
            const deltaY = dragStartScreenY - e.clientY;
            let style, slider;
            if (deltaY > 5) {
                style = 'air';
                slider = Math.min(100, Math.round((deltaY - 5) * 1.2));
            } else if (deltaY < -5) {
                style = 'ground';
                slider = Math.min(100, Math.round((-deltaY - 5) * 1.2));
            } else {
                style = 'ground';
                slider = 0;
            }
            if (onClick) onClick(sprayX, sprayY, slider, style, false); // commit
        });

        container.appendChild(svg);
        return container;
    }

    /**
     * Render a composite spray chart showing all spray lines for a player.
     * @param {Array} atBats - array of at-bat objects (may contain nulls)
     * @returns {SVGElement}
     */
    function renderCompositeSpray(atBats) {
        const svg = createSVG();

        // Light diamond outline only (no bases, no labels, no count boxes)
        const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        const points = [
            `${BASES.home.x},${BASES.home.y}`,
            `${BASES.first.x},${BASES.first.y}`,
            `${BASES.second.x},${BASES.second.y}`,
            `${BASES.third.x},${BASES.third.y}`
        ].join(' ');
        diamond.setAttribute('points', points);
        diamond.setAttribute('fill', 'none');
        diamond.setAttribute('stroke', '#5a7a50');
        diamond.setAttribute('stroke-width', '0.5');
        diamond.setAttribute('stroke-opacity', '0.4');
        svg.appendChild(diamond);

        // Home plate dot
        const home = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        home.setAttribute('x', BASES.home.x - 1.5);
        home.setAttribute('y', BASES.home.y - 1.5);
        home.setAttribute('width', 3);
        home.setAttribute('height', 3);
        home.setAttribute('fill', '#5a7a50');
        home.setAttribute('fill-opacity', '0.5');
        home.setAttribute('transform', `rotate(45 ${BASES.home.x} ${BASES.home.y})`);
        svg.appendChild(home);

        // Draw all spray lines
        for (const ab of atBats) {
            if (ab && ab.sprayChart) {
                drawSprayLine(svg, ab.sprayChart);
            }
        }

        return svg;
    }

    /**
     * Render a composite pitch chart showing all pitch locations for a pitcher.
     * @param {Array} pitches - array of pitch objects { pitchX, pitchY, outcome, missedCall }
     * @returns {SVGElement}
     */
    function renderCompositePitchChart(pitches) {
        // Use the same viewBox as the strike zone in the modal: 180x210
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 180 210');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        // Strike zone geometry (matches app.js renderStrikeZone)
        const SZ = { x: 50, y: 45, w: 78, h: 78 };

        // Light background
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', 0); bg.setAttribute('y', 0);
        bg.setAttribute('width', 180); bg.setAttribute('height', 210);
        bg.setAttribute('fill', '#f8f6f0');
        bg.setAttribute('rx', '4');
        svg.appendChild(bg);

        // Strike zone rectangle
        const zone = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        zone.setAttribute('x', SZ.x); zone.setAttribute('y', SZ.y);
        zone.setAttribute('width', SZ.w); zone.setAttribute('height', SZ.h);
        zone.setAttribute('fill', 'none');
        zone.setAttribute('stroke', '#999');
        zone.setAttribute('stroke-width', '1');
        svg.appendChild(zone);

        // 3x3 grid lines
        const thirdW = SZ.w / 3, thirdH = SZ.h / 3;
        for (let i = 1; i <= 2; i++) {
            const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            vLine.setAttribute('x1', SZ.x + i * thirdW); vLine.setAttribute('y1', SZ.y);
            vLine.setAttribute('x2', SZ.x + i * thirdW); vLine.setAttribute('y2', SZ.y + SZ.h);
            vLine.setAttribute('stroke', '#ccc'); vLine.setAttribute('stroke-width', '0.5');
            svg.appendChild(vLine);

            const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            hLine.setAttribute('x1', SZ.x); hLine.setAttribute('y1', SZ.y + i * thirdH);
            hLine.setAttribute('x2', SZ.x + SZ.w); hLine.setAttribute('y2', SZ.y + i * thirdH);
            hLine.setAttribute('stroke', '#ccc'); hLine.setAttribute('stroke-width', '0.5');
            svg.appendChild(hLine);
        }

        // Plot pitch dots
        const STRIKE_OUTCOMES = ['CS', 'SS', 'F', 'IP'];
        for (const p of pitches) {
            if (p.pitchX == null || p.pitchY == null) continue;

            const isStrike = STRIKE_OUTCOMES.includes(p.outcome);
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', p.pitchX);
            dot.setAttribute('cy', p.pitchY);
            dot.setAttribute('r', '4');

            const color = p.missedCall ? '#cc2222' : '#228833';
            if (isStrike) {
                dot.setAttribute('fill', color);
                dot.setAttribute('fill-opacity', '0.7');
            } else {
                dot.setAttribute('fill', 'none');
                dot.setAttribute('stroke', color);
                dot.setAttribute('stroke-width', '1.5');
            }
            svg.appendChild(dot);
        }

        return svg;
    }

    return { render, renderPreview, renderInteractive, renderCompositeSpray, renderCompositePitchChart, BASES, SPRAY_STYLES, QUICK_LABELS };
})();
