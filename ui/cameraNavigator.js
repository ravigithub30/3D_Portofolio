export class CameraNavigator {
    constructor(camera, controls) {
        this.camera = camera;
        this.controls = controls;

        this.startPosition = camera.position.clone();
        this.startQuaternion = camera.quaternion.clone();
        this.startTarget = controls.target.clone();

        this.isAnimating = false;
        this.isLocked = false; // true while parked at a button destination
    }

    flyToQuat(targetPosition, targetQuaternion, duration = 1.4, onComplete) {
        this._animate(targetPosition.clone(), targetQuaternion.clone(), duration, () => {
            this.isLocked = true; // lock rotation here — don't let OrbitControls touch it
            onComplete?.();
        });
    }

    flyBack(duration = 1.4, onComplete) {
        this.isLocked = false; // unlock immediately so update() doesn't fight the return flight either
        this._animate(this.startPosition.clone(), this.startQuaternion.clone(), duration, () => {
            this.controls.target.copy(this.startTarget);
            onComplete?.();
        });
    }

    _animate(toPos, toQuat, duration, onComplete) {
        if (this.isAnimating) return;
        this.isAnimating = true;
        this.controls.enabled = false;

        const fromPos = this.camera.position.clone();
        const fromQuat = this.camera.quaternion.clone();
        const start = performance.now();

        const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

        const step = (now) => {
            const t = Math.min((now - start) / (duration * 1000), 1);
            const e = easeInOutCubic(t);

            this.camera.position.lerpVectors(fromPos, toPos, e);
            this.camera.quaternion.slerpQuaternions(fromQuat, toQuat, e);

            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                this.isAnimating = false;
                onComplete?.();
            }
        };
        requestAnimationFrame(step);
    }

    enableControls() {
        this.controls.enabled = true;
    }

    // Returns true if OrbitControls.update() is safe to call right now
    shouldUpdateControls() {
        return !this.isAnimating && !this.isLocked;
    }
}