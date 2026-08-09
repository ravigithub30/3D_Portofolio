// ui/sidePanel.js
export class SidePanel {
    /**
     * @param {boolean} isMobileDevice - pass the same UA-based `isMobile`
     *   flag used elsewhere (index.html). On phones held in portrait, the
     *   panel docks to the TOP or BOTTOM of the screen (see `mobileDock`
     *   on show()) instead of a side strip, leaving the rest of the
     *   screen showing the 3D scene underneath. Desktop/tablet and
     *   mobile-landscape keep the original side panel.
     */
    constructor(isMobileDevice = false) {
        this.isMobileDevice = isMobileDevice;

        // BUILD TAG — if you don't see this line in the console when the
        // page loads, the browser (or GitHub Pages / your host's CDN) is
        // still serving an OLD cached copy of this file, not this one.
        // That's the #1 cause of "I changed the code but nothing changed"
        // for ES module files like this — see the cache-busting note on
        // the <script> import in index.html.
        console.log(
            '[SidePanel] mobile-dock build active — isMobileDevice:',
            isMobileDevice,
            'window:', window.innerWidth, 'x', window.innerHeight
        );

        // How much of the screen height the panel takes up in the mobile
        // docked layout. Tweak this if you want more/less scene visible
        // around the panel.
        this.mobileHeightFraction = 0.65; // 65% of the screen height

        // Which edge the panel docks to on mobile — 'top' or 'bottom'.
        // Set per-open via show(url, side, mobileDock); defaults to 'top'
        // until the first show() call chooses otherwise.
        this._mobileDock = 'top';

        // Fixed margin so the panel never touches the screen edges
        this.margin = 24; // px — tweak this if you want more/less breathing room

        // The notched frame shape (percentages, same shape at every size —
        // proportions stay consistent, safe padding is computed below so
        // nothing ever sits under a notch).
        this.clipPath =
            'polygon(' +
            '7% 8%, 25% 8%, 28% 4%, 75% 4%, 97% 4%, 100% 8%, ' +
            '100% 92%, 96% 100%, 12% 100%, 10% 97%, 10% 95%, ' +
            '10% 66%, 4% 56%, 4% 12%' +
            ')';

        // Deepest cut on each side, as a fraction of width/height — read
        // straight off the polygon above. Used to compute safe padding.
        this.notchDepth = { top: 0.08, right: 0.04, bottom: 0.08, left: 0.10 };

        // ---- OUTER wrapper: positioning/animation only — deliberately NOT
        // clipped and NOT overflow:hidden. clip-path clips everything
        // painted inside an element, including descendants' filter effects
        // (drop-shadow's blur/glow paints outside the element's own box).
        // With clip-path + overflow:hidden on this wrapper before, the
        // middle layer's glow had nowhere to bleed into — it hit this same
        // shape a fraction of a pixel away and was cut off immediately.
        this.overlay = document.createElement('div');
        Object.assign(this.overlay.style, {
            position: 'fixed',
            transition: 'transform 0.5s ease',
            zIndex: '10',
        });
        // Actual top/bottom/left/right/width/height are assigned by
        // _applyLayoutMode() / _applyMobileGeometry() below, since they
        // differ between the desktop side-panel layout and the mobile
        // top/bottom-docked layout.

        // ---- FRAME layer: the solid light-blue border shape ----
        this.frame = document.createElement('div');
        Object.assign(this.frame.style, {
            position: 'absolute',
            inset: '0',
            background: '#3c99e0',
            clipPath: this.clipPath,
            filter: 'drop-shadow(0 12px 40px rgba(0, 0, 0, 0.66))',
        });

        // ---- MIDDLE layer: the glowing blue border. Now a sibling of
        // `frame` under the unclipped `overlay`, so its glow can actually
        // spread past the frame's edge instead of being clipped away.
        this.middle = document.createElement('div');
        Object.assign(this.middle.style, {
            position: 'absolute',
            top: '2px',
            left: '2px',
            right: '2px',
            bottom: '2px',
            background: '#060912',
            clipPath: this.clipPath,
            // layered drop-shadows — tight, medium, wide — for a proper
            // neon glow instead of a single soft blur
            filter:
                'drop-shadow(0 0 4px #9fe4ff) ' +
                'drop-shadow(0 0 14px #2fbaff) ' +
                'drop-shadow(0 0 32px #2fbaff)',
        });

        // ---- INNER layer: dark blue glass panel, holds your real content ----
        this.inner = document.createElement('div');
        Object.assign(this.inner.style, {
            position: 'absolute',
            top: '3px',
            left: '3px',
            right: '3px',
            bottom: '3px',
            background: '#060912', // dark blue with opacity
            clipPath: this.clipPath,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxSizing: 'border-box',
            // padding gets set dynamically by _updateSafePadding()
        });

        // Header bar holds the close button, sits inside the panel itself
        this.header = document.createElement('div');
        Object.assign(this.header.style, {
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '12px',
            background: '#060912',
            flexShrink: '0',
        });

        this.closeBtn = document.createElement('button');
        this.closeBtn.textContent = '✕';
        Object.assign(this.closeBtn.style, {
            padding: '10px 10px',
            background: '#2336df75',
            color: '#fff',
            border: 'none',
            borderRadius: '20px',
            cursor: 'pointer',
            fontFamily: 'sans-serif',
            fontSize: '14px',
            fontWeight: 'bold',
        });

        this.iframe = document.createElement('iframe');
        Object.assign(this.iframe.style, {
            flex: '1',
            border: 'none',
            width: '100%',
        });

        this.header.appendChild(this.closeBtn);
        this.inner.appendChild(this.header);
        this.inner.appendChild(this.iframe);

        this.overlay.appendChild(this.frame);
        this.overlay.appendChild(this.middle);
        this.overlay.appendChild(this.inner);
        document.body.appendChild(this.overlay);

        this._onCloseCallback = null;
        this._isOpen = false; // tracked so layout-mode switches (rotation,
                               // devtools resize) can restore the correct
                               // open/closed transform instead of always
                               // snapping shut.
        this._layoutMode = null; // 'mobile' | 'side' — set by _applyLayoutMode()
        this.closeBtn.addEventListener('click', () => {
            this.hide();
            this._onCloseCallback?.();
        });

        // Recompute safe padding any time the panel's actual pixel size
        // changes (window resize, etc.) — guarantees content never sits
        // under a notch instead of relying on a guessed static number.
        this._resizeObserver = new ResizeObserver(() => this._updateSafePadding());
        this._resizeObserver.observe(this.overlay);

        // Re-decide docked (mobile portrait) vs side-panel (everything
        // else) any time the viewport changes — device rotation, or the
        // browser window / devtools device-toolbar being resized.
        window.addEventListener('resize', () => this._applyLayoutMode());
        window.addEventListener('orientationchange', () => this._applyLayoutMode());

        // Default to right side, closed
        this._applySide('right');
        this._applyLayoutMode();
        this._updateSafePadding();
    }

    // Phones in portrait get the docked (top or bottom) layout; phones in
    // landscape, tablets, and desktop keep the original side panel.
    // Re-checked live instead of only once at construction time.
    _isMobileLayout() {
        return this.isMobileDevice && window.innerHeight >= window.innerWidth;
    }

    _applyLayoutMode() {
        const nextMode = this._isMobileLayout() ? 'mobile' : 'side';
        if (nextMode === this._layoutMode) return; // nothing changed
        this._layoutMode = nextMode;
        console.log(
            '[SidePanel] layout mode ->', nextMode,
            '(isMobileDevice:', this.isMobileDevice,
            ', window:', window.innerWidth, 'x', window.innerHeight, ')'
        );

        if (nextMode === 'mobile') {
            this._applyMobileGeometry();
        } else {
            // ---- Desktop/tablet/landscape-phone layout: original side panel.
            Object.assign(this.overlay.style, {
                top: `${this.margin}px`,
                bottom: `${this.margin}px`,
                height: 'auto',
                width: '60%',
                maxWidth: '900px',
            });
            this._applySide(this.side || 'right');
        }

        // Re-apply whichever transform matches the current open/closed
        // state, in the new layout's axis (translateY for mobile,
        // translateX for side) — otherwise switching layout mid-session
        // (e.g. rotating the phone) would leave a stale transform from
        // the other axis.
        if (this._isOpen) {
            this._setOpenTransform();
        } else {
            this._setClosedTransform();
        }
        this._updateSafePadding();
    }

    // Positions the overlay against whichever edge (top or bottom) is
    // currently selected for mobile — this.mobileHeightFraction controls
    // how much of the screen height it takes up. Called whenever the
    // layout switches into mobile mode, and again whenever the dock edge
    // changes (e.g. a "bottom" page opening after a "top" one) while
    // already in mobile mode.
    _applyMobileGeometry() {
        const heightCss = `calc(${this.mobileHeightFraction * 100}% - ${this.margin * 1.5}px)`;
        const base = {
            left: `${this.margin}px`,
            right: `${this.margin}px`,
            width: 'auto',
            maxWidth: 'none',
            height: heightCss,
        };
        if (this._mobileDock === 'bottom') {
            Object.assign(this.overlay.style, { ...base, top: '', bottom: `${this.margin}px` });
        } else {
            Object.assign(this.overlay.style, { ...base, top: `${this.margin}px`, bottom: '' });
        }
    }

    _updateSafePadding() {
        const rect = this.overlay.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const buffer = 14; // extra breathing room past the deepest notch point
        const top = rect.height * this.notchDepth.top + buffer;
        const bottom = rect.height * this.notchDepth.bottom + buffer;
        const left = rect.width * this.notchDepth.left + buffer;
        const right = rect.width * this.notchDepth.right + buffer;
        this.inner.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
    }

    _applySide(side) {
        this.side = side;
        // Left/right anchoring only applies in the side-panel layout — in
        // the mobile docked layout the panel always spans left-margin to
        // right-margin (set in _applyMobileGeometry), so skip touching
        // those properties there.
        if (this._layoutMode === 'mobile') return;
        if (side === 'left') {
            this.overlay.style.left = `${this.margin}px`;
            this.overlay.style.right = '';
        } else {
            this.overlay.style.right = `${this.margin}px`;
            this.overlay.style.left = '';
        }
    }

    _setClosedTransform() {
        // Slide out toward whichever edge the panel is anchored to: up
        // off the top / down off the bottom in mobile docked mode,
        // sideways off-screen otherwise.
        if (this._layoutMode === 'mobile') {
            this.overlay.style.transform =
                this._mobileDock === 'bottom' ? 'translateY(120%)' : 'translateY(-120%)';
        } else {
            this.overlay.style.transform =
                this.side === 'left' ? 'translateX(-120%)' : 'translateX(120%)';
        }
    }

    _setOpenTransform() {
        this.overlay.style.transform =
            this._layoutMode === 'mobile' ? 'translateY(0%)' : 'translateX(0%)';
    }

    /**
     * @param {string} url - page to load in the panel
     * @param {'left'|'right'} side - which side of the screen the panel appears on
     *   (desktop/tablet/landscape-phone side-panel layout only)
     * @param {'top'|'bottom'} mobileDock - which edge the panel docks to
     *   on phones in portrait (ignored otherwise). Defaults to 'top'.
     */
    show(url, side = 'right', mobileDock = 'top') {
        this._applySide(side);
        const dockChanged = mobileDock !== this._mobileDock;
        this._mobileDock = mobileDock;
        if (this._layoutMode === 'mobile' && dockChanged) {
            this._applyMobileGeometry();
        }
        this._isOpen = true;
        // Start off-screen in the correct direction before the URL loads,
        // then slide in.
        this._setClosedTransform();
        this.iframe.src = url;

        requestAnimationFrame(() => {
            this._setOpenTransform();
            this._updateSafePadding();
        });
    }

    hide() {
        this._isOpen = false;
        this._setClosedTransform();
        setTimeout(() => { this.iframe.src = 'about:blank'; }, 500);
    }

    onClose(callback) {
        this._onCloseCallback = callback;
    }
}