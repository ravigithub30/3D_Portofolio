// ui/sidePanel.js
export class SidePanel {
    constructor() {
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
            top: `${this.margin}px`,
            bottom: `${this.margin}px`,
            width: '60%',
            maxWidth: '900px',
            transition: 'transform 0.5s ease',
            zIndex: '10',
        });

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
        this.closeBtn.addEventListener('click', () => {
            this.hide();
            this._onCloseCallback?.();
        });

        // Recompute safe padding any time the panel's actual pixel size
        // changes (window resize, etc.) — guarantees content never sits
        // under a notch instead of relying on a guessed static number.
        this._resizeObserver = new ResizeObserver(() => this._updateSafePadding());
        this._resizeObserver.observe(this.overlay);

        // Default to right side, closed
        this._applySide('right');
        this._setClosedTransform();
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
        if (side === 'left') {
            this.overlay.style.left = `${this.margin}px`;
            this.overlay.style.right = '';
        } else {
            this.overlay.style.right = `${this.margin}px`;
            this.overlay.style.left = '';
        }
    }

    _setClosedTransform() {
        // Slide out toward whichever edge the panel is anchored to
        this.overlay.style.transform =
            this.side === 'left' ? 'translateX(-120%)' : 'translateX(120%)';
    }

    /**
     * @param {string} url - page to load in the panel
     * @param {'left'|'right'} side - which side of the screen the panel appears on
     */
    show(url, side = 'right') {
        this._applySide(side);
        // Start off-screen on the correct side before the URL loads, then slide in
        this._setClosedTransform();
        this.iframe.src = url;

        requestAnimationFrame(() => {
            this.overlay.style.transform = 'translateX(0%)';
            this._updateSafePadding();
        });
    }

    hide() {
        this._setClosedTransform();
        setTimeout(() => { this.iframe.src = 'about:blank'; }, 500);
    }

    onClose(callback) {
        this._onCloseCallback = callback;
    }
}