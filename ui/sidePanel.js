// ui/sidePanel.js
export class SidePanel {
    /**
     * @param {boolean} isMobileDevice - pass the same UA-based `isMobile`
     *   flag used elsewhere (index.html). On phones held in portrait, the
     *   panel docks to the TOP HALF of the screen instead of a side
     *   strip, leaving the bottom half showing the 3D scene underneath.
     *   Desktop/tablet and mobile-landscape keep the original side panel.
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
            '[SidePanel] mobile-top-panel build active — isMobileDevice:',
            isMobileDevice,
            'window:', window.innerWidth, 'x', window.innerHeight
        );

        // How much of the screen height the panel takes up in the mobile
        // top-docked layout. Tweak this if you want more/less scene
        // visible underneath the panel.
        this.mobileTopHeightFraction = 0.5; // 50% — "half the screen"

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
        // _applyLayoutMode() below, since they differ between the
        // desktop side-panel layout and the mobile top-panel layout.

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
        this._layoutMode = null; // 'top' | 'side' — set by _applyLayoutMode()
        this.closeBtn.addEventListener('click', () => {
            this.hide();
            this._onCloseCallback?.();
        });

        // Recompute safe padding any time the panel's actual pixel size
        // changes (window resize, etc.) — guarantees content never sits
        // under a notch instead of relying on a guessed static number.
        this._resizeObserver = new ResizeObserver(() => this._updateSafePadding());
        this._resizeObserver.observe(this.overlay);

        // Re-decide top-panel (mobile portrait) vs side-panel (everything
        // else) any time the viewport changes — device rotation, or the
        // browser window / devtools device-toolbar being resized.
        window.addEventListener('resize', () => this._applyLayoutMode());
        window.addEventListener('orientationchange', () => this._applyLayoutMode());

        // Default to right side, closed
        this._applySide('right');
        this._applyLayoutMode();
        this._updateSafePadding();
    }

    // Phones in portrait get the top-docked layout; phones in landscape,
    // tablets, and desktop keep the original side panel. Re-checked live
    // instead of only once at construction time.
    _isTopLayout() {
        return this.isMobileDevice && window.innerHeight >= window.innerWidth;
    }

    _applyLayoutMode() {
        const nextMode = this._isTopLayout() ? 'top' : 'side';
        if (nextMode === this._layoutMode) return; // nothing changed
        this._layoutMode = nextMode;
        console.log(
            '[SidePanel] layout mode ->', nextMode,
            '(isMobileDevice:', this.isMobileDevice,
            ', window:', window.innerWidth, 'x', window.innerHeight, ')'
        );

        if (nextMode === 'top') {
            // ---- Phone (portrait) layout: dock to the TOP HALF of the
            // screen; the bottom half stays the visible 3D scene.
            Object.assign(this.overlay.style, {
                top: `${this.margin}px`,
                bottom: '',
                left: `${this.margin}px`,
                right: `${this.margin}px`,
                width: 'auto',
                maxWidth: 'none',
                height: `calc(${this.mobileTopHeightFraction * 100}% - ${this.margin * 1.5}px)`,
            });
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
        // state, in the new layout's axis (translateY for top, translateX
        // for side) — otherwise switching layout mid-session (e.g.
        // rotating the phone) would leave a stale transform from the
        // other axis.
        if (this._isOpen) {
            this._setOpenTransform();
        } else {
            this._setClosedTransform();
        }
        this._updateSafePadding();
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
        // the mobile top layout the panel always spans left-margin to
        // right-margin (set in _applyLayoutMode), so skip touching those
        // properties there.
        if (this._layoutMode === 'top') return;
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
        // off the top in mobile top-panel mode, sideways off-screen
        // otherwise.
        if (this._layoutMode === 'top') {
            this.overlay.style.transform = 'translateY(-120%)';
        } else {
            this.overlay.style.transform =
                this.side === 'left' ? 'translateX(-120%)' : 'translateX(120%)';
        }
    }

    _setOpenTransform() {
        this.overlay.style.transform =
            this._layoutMode === 'top' ? 'translateY(0%)' : 'translateX(0%)';
    }

    /**
     * @param {string} url - page to load in the panel
     * @param {'left'|'right'} side - which side of the screen the panel appears on
     *   (ignored in the mobile top-panel layout, where it always docks to
     *   the top and spans the full width)
     */
    show(url, side = 'right') {
        this._applySide(side);
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