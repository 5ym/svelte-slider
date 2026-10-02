import { untrack } from 'svelte';
import { createAttachmentKey } from 'svelte/attachments';
import { on } from 'svelte/events';
/** これ以上の速度 (px/ms) で離したらフリックとみなす */
const FLICK_VELOCITY = 0.3;
/** ドラッグ開始とみなす移動量 (px)。これ未満はタップ扱い */
const DRAG_THRESHOLD = 6;
/**
 * 離す直前のこの時間 (ms) の動きから速度を求める。
 * フリックは離す直前に加速するので、長く取ると平均に引っ張られて遅く見積もってしまう
 */
const VELOCITY_WINDOW = 40;
const MIN_FLICK_DURATION = 80;
const MAX_FLICK_DURATION = 350;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
/** 等減速(初速 = 2 * 距離 / 時間)。cubic より終盤のもたつきが少ない */
const easeOutQuad = (t) => 1 - (1 - t) ** 2;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** 端を越えて引っ張ったときの抵抗(iOS のラバーバンド相当) */
const rubberBand = (overshoot, size) => (1 - 1 / ((overshoot * 0.55) / size + 1)) * size;
let uid = 0;
/**
 * 見た目を持たないスライダー。状態と操作、要素に spread する属性だけを提供する。
 *
 * ```svelte
 * <section {...slider.root} aria-label="お知らせ">
 *   <div {...slider.viewport}>
 *     <div {...slider.track}>
 *       {#each items as item, i}<div {...slider.slide(i)}>…</div>{/each}
 *     </div>
 *   </div>
 *   <button {...slider.prevButton}>前へ</button>
 *   <button {...slider.nextButton}>次へ</button>
 *   {#each { length: slider.count } as _, i}<button {...slider.dot(i)}></button>{/each}
 * </section>
 * ```
 */
export class Slider {
    /** 現在(移動中なら移動先)のスライド番号 */
    index = $state(0);
    /** スナップ位置の数(= ページ数)。スライド幅の合計が足りない分は末尾がまとめられる */
    count = $state(0);
    /** ユーザーがドラッグ中か */
    dragging = $state(false);
    /** 以下の設定は実行中にも変更できる。意味は SliderOptions を参照 */
    autoplay = $state(4000);
    rewind = $state(true);
    duration = $state(400);
    /** 自動スライドを手動で止めているか(再生/停止ボタン用) */
    paused = $state(false);
    #trackId = `slider-${++uid}-track`;
    #viewport;
    #track;
    #snaps = [];
    #width = 0;
    #max = 0;
    /** 現在の表示位置 (px)。右へ進むほど大きい */
    #offset = 0;
    #raf = 0;
    #hovered = $state(false);
    #focused = $state(false);
    #hidden = $state(false);
    #gesture;
    #suppressClick = false;
    #viewportKey = createAttachmentKey();
    #trackKey = createAttachmentKey();
    #rootKey = createAttachmentKey();
    constructor(options = {}) {
        this.autoplay = options.autoplay ?? this.autoplay;
        this.rewind = options.rewind ?? this.rewind;
        this.duration = options.duration ?? this.duration;
    }
    get canPrev() {
        return this.count > 1 && (this.rewind || this.index > 0);
    }
    get canNext() {
        return this.count > 1 && (this.rewind || this.index < this.count - 1);
    }
    /** 自動スライドが実際に動いている状態か */
    get playing() {
        return (this.autoplay > 0 &&
            this.count > 1 &&
            !this.paused &&
            !this.dragging &&
            !this.#hovered &&
            !this.#focused &&
            !this.#hidden);
    }
    // ------------------------------------------------------------------
    // 操作
    // ------------------------------------------------------------------
    next(duration = this.duration) {
        if (this.index < this.count - 1)
            this.goTo(this.index + 1, duration);
        else if (this.rewind)
            this.goTo(0, duration);
    }
    prev(duration = this.duration) {
        if (this.index > 0)
            this.goTo(this.index - 1, duration);
        else if (this.rewind)
            this.goTo(this.count - 1, duration);
    }
    goTo(index, duration = this.duration) {
        if (this.dragging || this.count === 0)
            return;
        this.index = clamp(index, 0, this.count - 1);
        this.#animateTo(this.#snaps[this.index], reducedMotion() ? 0 : duration, easeInOutCubic);
    }
    // ------------------------------------------------------------------
    // 要素に spread する props
    // ------------------------------------------------------------------
    get root() {
        return {
            role: 'region',
            'aria-roledescription': 'carousel',
            onkeydown: this.#onKeydown,
            onpointerenter: this.#onPointerEnter,
            onpointerleave: this.#onPointerLeave,
            onfocusin: this.#onFocusIn,
            onfocusout: this.#onFocusOut,
            [this.#rootKey]: this.#attachRoot
        };
    }
    get viewport() {
        return {
            'aria-live': this.playing ? 'off' : 'polite',
            'data-dragging': this.dragging || undefined,
            [this.#viewportKey]: this.#attachViewport
        };
    }
    get track() {
        return {
            id: this.#trackId,
            [this.#trackKey]: this.#attachTrack
        };
    }
    slide(i) {
        return {
            role: 'group',
            'aria-roledescription': 'slide',
            'aria-label': `${i + 1} / ${this.count}`,
            'data-active': i === this.index || undefined
        };
    }
    get prevButton() {
        return {
            type: 'button',
            'aria-label': '前へ',
            'aria-controls': this.#trackId,
            disabled: !this.canPrev,
            onclick: () => this.prev()
        };
    }
    get nextButton() {
        return {
            type: 'button',
            'aria-label': '次へ',
            'aria-controls': this.#trackId,
            disabled: !this.canNext,
            onclick: () => this.next()
        };
    }
    dot(i) {
        return {
            type: 'button',
            'aria-label': `スライド ${i + 1}`,
            'aria-controls': this.#trackId,
            'aria-current': i === this.index ? 'true' : undefined,
            'data-active': i === this.index || undefined,
            onclick: () => this.goTo(i)
        };
    }
    /** 再生/停止ボタン用 */
    get playButton() {
        return {
            type: 'button',
            'aria-label': this.paused ? '自動スライドを再開' : '自動スライドを停止',
            'aria-pressed': !this.paused,
            onclick: () => (this.paused = !this.paused)
        };
    }
    // ------------------------------------------------------------------
    // アタッチメント
    // ------------------------------------------------------------------
    #attachRoot = () => {
        this.#hidden = document.hidden;
        // 自動スライド。index が変わる(=何か操作された)たびにタイマーを掛け直す
        $effect(() => {
            if (!this.playing)
                return;
            this.index;
            const timer = setTimeout(() => this.next(), this.autoplay);
            return () => clearTimeout(timer);
        });
        return on(document, 'visibilitychange', () => (this.#hidden = document.hidden));
    };
    #attachViewport = (node) => {
        this.#viewport = node;
        node.style.overflow = 'hidden';
        // 縦スクロールはブラウザに任せ、横方向のジェスチャだけを受け取る
        node.style.touchAction = 'pan-y';
        node.style.overscrollBehaviorX = 'contain';
        const offs = [
            on(node, 'pointerdown', this.#onPointerDown),
            on(node, 'pointermove', this.#onPointerMove),
            on(node, 'pointerup', this.#onPointerUp),
            on(node, 'pointercancel', this.#onPointerCancel),
            on(node, 'lostpointercapture', this.#onLostCapture),
            on(node, 'click', this.#onClickCapture, { capture: true }),
            on(node, 'dragstart', (e) => e.preventDefault()),
            on(node, 'scroll', this.#onScroll)
        ];
        this.#measure();
        return () => {
            for (const off of offs)
                off();
            this.#stop();
            this.#viewport = undefined;
        };
    };
    #attachTrack = (node) => {
        this.#track = node;
        node.style.display = 'flex';
        node.style.position = 'relative';
        node.style.willChange = 'transform';
        const resize = new ResizeObserver(() => this.#measure());
        const observeChildren = () => {
            resize.disconnect();
            resize.observe(node);
            for (const child of node.children)
                resize.observe(child);
        };
        const mutation = new MutationObserver(() => {
            observeChildren();
            this.#measure();
        });
        mutation.observe(node, { childList: true });
        observeChildren();
        this.#measure();
        return () => {
            resize.disconnect();
            mutation.disconnect();
            this.#track = undefined;
        };
    };
    // ------------------------------------------------------------------
    // 位置計算と描画
    // ------------------------------------------------------------------
    #measure() {
        const viewport = this.#viewport;
        const track = this.#track;
        if (!viewport || !track)
            return;
        this.#width = viewport.clientWidth;
        const children = Array.from(track.children);
        const end = children.reduce((m, el) => Math.max(m, el.offsetLeft + el.offsetWidth), 0);
        this.#max = Math.max(0, end - this.#width);
        // 各スライドの左端をスナップ位置にする。末尾で表示しきれない分は max にまとめる
        const snaps = [];
        for (const el of children) {
            const pos = Math.min(el.offsetLeft, this.#max);
            if (snaps.length === 0 || pos - snaps[snaps.length - 1] > 1)
                snaps.push(pos);
        }
        this.#snaps = snaps;
        untrack(() => {
            this.count = snaps.length;
            if (this.index > Math.max(0, snaps.length - 1))
                this.index = Math.max(0, snaps.length - 1);
            // 操作中でなければ現在のスライド位置へ合わせ直す(リサイズ追従)
            if (!this.dragging && !this.#raf)
                this.#setOffset(snaps[this.index] ?? 0);
        });
    }
    #setOffset(offset) {
        this.#offset = offset;
        if (this.#track)
            this.#track.style.transform = `translate3d(${-offset}px, 0, 0)`;
    }
    #stop() {
        cancelAnimationFrame(this.#raf);
        this.#raf = 0;
    }
    #animateTo(target, duration, ease) {
        this.#stop();
        const from = this.#offset;
        const delta = target - from;
        if (duration <= 0 || Math.abs(delta) < 0.5) {
            this.#setOffset(target);
            return;
        }
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / duration);
            this.#setOffset(from + delta * ease(t));
            this.#raf = t < 1 ? requestAnimationFrame(step) : 0;
        };
        this.#raf = requestAnimationFrame(step);
    }
    #nearest(offset) {
        let best = 0;
        for (let i = 1; i < this.#snaps.length; i++) {
            if (Math.abs(this.#snaps[i] - offset) < Math.abs(this.#snaps[best] - offset))
                best = i;
        }
        return best;
    }
    /** 指を離したとき、速度 (px/ms, 右向き正) に応じて行き先を決めて移動する */
    #release(velocity, from = this.index) {
        const offset = this.#offset;
        const snaps = this.#snaps;
        let target = this.#nearest(offset);
        if (Math.abs(velocity) > FLICK_VELOCITY) {
            // フリック: 指の向きの次のスナップ位置へ
            const forward = velocity < 0;
            let i = forward
                ? snaps.findIndex((s) => s > offset + 1)
                : snaps.findLastIndex((s) => s < offset - 1);
            // 同じ向きへ移動中に再度フリックしたら、移動先のさらに次へ(連続フリック)
            if (forward && snaps[from] > offset + 1)
                i = Math.min(from + 1, snaps.length - 1);
            if (!forward && snaps[from] < offset - 1)
                i = Math.max(from - 1, 0);
            if (i !== -1)
                target = i;
        }
        this.index = target;
        const to = this.#snaps[target] ?? 0;
        const distance = Math.abs(to - offset);
        // 初速 (2 * 距離 / 時間) が離した瞬間の指の速度と揃うように時間を決める
        const speed = Math.abs(velocity);
        const duration = speed > FLICK_VELOCITY
            ? clamp((2 * distance) / speed, MIN_FLICK_DURATION, MAX_FLICK_DURATION)
            : clamp(distance * 1.2, MIN_FLICK_DURATION, this.duration);
        this.#animateTo(to, duration, easeOutQuad);
    }
    // ------------------------------------------------------------------
    // イベント
    // ------------------------------------------------------------------
    #onPointerDown = (e) => {
        if (!e.isPrimary || e.button !== 0 || this.count === 0)
            return;
        // アニメーション中に掴んだらその場で止める(連続スワイプ対応)
        this.#stop();
        this.#gesture = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            offset: this.#offset,
            index: this.index,
            samples: [{ x: e.clientX, t: e.timeStamp }]
        };
    };
    #onPointerMove = (e) => {
        const g = this.#gesture;
        if (!g || e.pointerId !== g.id)
            return;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (!this.dragging) {
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD)
                return;
            // 縦方向の動きが勝ったらスライド操作ではない
            if (Math.abs(dy) > Math.abs(dx)) {
                this.#endGesture(0);
                return;
            }
            this.dragging = true;
            this.#viewport?.setPointerCapture(e.pointerId);
            this.#viewport?.style.setProperty('user-select', 'none');
            getSelection()?.removeAllRanges();
        }
        e.preventDefault();
        let offset = g.offset - dx;
        if (offset < 0)
            offset = -rubberBand(-offset, this.#width);
        else if (offset > this.#max)
            offset = this.#max + rubberBand(offset - this.#max, this.#width);
        this.#setOffset(offset);
        // ブラウザがフレーム単位にまとめた move も拾って速度の精度を上げる
        const events = e.getCoalescedEvents?.() ?? [];
        for (const ev of events.length ? events : [e]) {
            g.samples.push({ x: ev.clientX, t: ev.timeStamp });
        }
        while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > VELOCITY_WINDOW) {
            g.samples.shift();
        }
    };
    #onPointerUp = (e) => {
        const g = this.#gesture;
        if (!g || e.pointerId !== g.id)
            return;
        let velocity = 0;
        const first = g.samples[0];
        const last = g.samples[g.samples.length - 1];
        // 止めてから離した場合はフリックにしない
        if (last.t > first.t && e.timeStamp - last.t < 50) {
            velocity = (last.x - first.x) / (last.t - first.t);
        }
        if (this.dragging)
            this.#suppressClick = true;
        this.#endGesture(velocity);
    };
    #onPointerCancel = (e) => {
        if (this.#gesture?.id === e.pointerId)
            this.#endGesture(0);
    };
    // タッチでは子要素(リンク等)が暗黙にキャプチャしており、viewport へ移すと
    // 子要素の lostpointercapture がバブリングしてくるので viewport 自身のものだけ見る
    #onLostCapture = (e) => {
        if (e.target === e.currentTarget)
            this.#onPointerCancel(e);
    };
    #endGesture(velocity) {
        const pointerId = this.#gesture?.id;
        const from = this.#gesture?.index;
        this.#gesture = undefined;
        if (pointerId !== undefined && this.#viewport?.hasPointerCapture(pointerId)) {
            this.#viewport.releasePointerCapture(pointerId);
        }
        this.#viewport?.style.removeProperty('user-select');
        this.dragging = false;
        // 掴んで止めただけの場合も含め、必ずスナップ位置へ戻す
        this.#release(velocity, from);
        // ドラッグ後に click が来なかった場合に備えて解除
        setTimeout(() => (this.#suppressClick = false));
    }
    /** ドラッグ後のリンク遷移などを防ぐ */
    #onClickCapture = (e) => {
        if (!this.#suppressClick)
            return;
        this.#suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
    };
    /** フォーカス移動などでブラウザが viewport をスクロールさせたら打ち消して該当スライドへ */
    #onScroll = () => {
        const viewport = this.#viewport;
        if (!viewport || viewport.scrollLeft === 0)
            return;
        const shifted = this.#offset + viewport.scrollLeft;
        viewport.scrollLeft = 0;
        this.#setOffset(shifted);
        this.goTo(this.#nearest(shifted));
    };
    #onKeydown = (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
            return;
        const keys = {
            ArrowLeft: () => this.prev(),
            ArrowRight: () => this.next(),
            Home: () => this.goTo(0),
            End: () => this.goTo(this.count - 1)
        };
        const action = keys[e.key];
        if (!action)
            return;
        e.preventDefault();
        action();
    };
    #onPointerEnter = (e) => {
        if (e.pointerType === 'mouse')
            this.#hovered = true;
    };
    #onPointerLeave = (e) => {
        if (e.pointerType === 'mouse')
            this.#hovered = false;
    };
    // キーボード操作中だけ止める(クリック後のフォーカスで止まり続けないように)
    #onFocusIn = (e) => {
        this.#focused = e.target instanceof Element && e.target.matches(':focus-visible');
    };
    #onFocusOut = (e) => {
        const root = e.currentTarget;
        if (!root.contains(e.relatedTarget))
            this.#focused = false;
    };
}
function reducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
