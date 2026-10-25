import { untrack } from 'svelte';
import { createAttachmentKey, type Attachment } from 'svelte/attachments';
import { on } from 'svelte/events';

export interface SliderOptions {
	/** 自動スライドの間隔 (ms)。0 で無効。既定 4000 */
	autoplay?: number;
	/** 端で next / prev したとき反対側の端へ戻るか。既定 true */
	rewind?: boolean;
	/** ボタン・ドット・自動スライドのアニメーション時間 (ms)。既定 400 */
	duration?: number;
}

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
/** scrollend が来ない環境向けに、最後の scroll からこの時間 (ms) でスクロール終了とみなす */
const SCROLL_IDLE = 150;

/**
 * スライダーの土台。ホイール・トラックパッド・キー操作・CSS の ::scroll-button などは
 * ブラウザのスクロールと scroll-snap に任せる。詳細度 0 なので利用側の CSS で上書きできる
 */
const BASE_CSS = `
:where([data-slider-viewport]) {
	display: flex;
	position: relative;
	overflow-x: auto;
	overscroll-behavior-x: contain;
	scroll-snap-type: x mandatory;
	scrollbar-width: none;
}
:where([data-slider-viewport])::-webkit-scrollbar {
	display: none;
}
:where([data-slider-slide]) {
	flex-shrink: 0;
	scroll-snap-align: start;
	scroll-snap-stop: always;
}
`;

let sheet: CSSStyleSheet | undefined;

/** BASE_CSS を文書に一度だけ追加する */
function adoptBaseStyles() {
	if (sheet) return;
	sheet = new CSSStyleSheet();
	sheet.replaceSync(BASE_CSS);
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** 等減速(初速 = 2 * 距離 / 時間)。cubic より終盤のもたつきが少ない */
const easeOutQuad = (t: number) => 1 - (1 - t) ** 2;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** 端を越えて引っ張ったときの抵抗(iOS のラバーバンド相当) */
const rubberBand = (overshoot: number, size: number) =>
	(1 - 1 / ((overshoot * 0.55) / size + 1)) * size;

let uid = 0;

/**
 * 見た目を持たないスライダー。状態と操作、要素に spread する属性だけを提供する。
 *
 * ```svelte
 * <section {...slider.root} aria-label="お知らせ">
 *   <div {...slider.viewport}>
 *     {#each items as item, i}<div {...slider.slide(i)}>…</div>{/each}
 *   </div>
 *   <button {...slider.prevButton}>前へ</button>
 *   <button {...slider.nextButton}>次へ</button>
 *   {#each { length: slider.count } as _, i}<button {...slider.dot(i)}></button>{/each}
 * </section>
 * ```
 */
export class Slider {
	/** 現在(ボタン等で移動中なら移動先)のスライド番号 */
	index = $state(0);
	/** スナップ位置の数(= ページ数)。スライド幅の合計が足りない分は末尾がまとめられる */
	count = $state(0);
	/** ユーザーがドラッグ中か(タッチ・ペン・マウス) */
	dragging = $state(false);
	/** 以下の設定は実行中にも変更できる。意味は SliderOptions を参照 */
	autoplay = $state(4000);
	rewind = $state(true);
	duration = $state(400);
	/** 自動スライドを手動で止めているか(再生/停止ボタン用) */
	paused = $state(false);

	#viewportId = `slider-${++uid}-viewport`;
	#viewport: HTMLElement | undefined;
	#snaps: number[] = [];
	#max = 0;
	/** 端を越えて引っ張っている量 (px)。スライドの translate で見せる */
	#overshoot = 0;
	#raf = 0;

	/** スクロール中か(ドラッグ・ホイール・ボタンによる移動を問わない) */
	#scrolling = $state(false);
	#hovered = $state(false);
	#focused = $state(false);
	#hidden = $state(false);

	/** JS で動かしている間は、途中の位置で index を書き換えない */
	#seeking = false;
	#idleTimer: ReturnType<typeof setTimeout> | undefined;

	#gesture:
		| {
				id: number;
				x: number;
				y: number;
				pos: number;
				/** 掴んだ時点の移動先(アニメーション中ならその行き先) */
				index: number;
				/** アニメーション中に掴んで止めたか */
				interrupted: boolean;
				samples: { x: number; t: number }[];
		  }
		| undefined;
	#suppressClick = false;

	#rootKey = createAttachmentKey();
	#viewportKey = createAttachmentKey();
	#slideKey = createAttachmentKey();

	constructor(options: SliderOptions = {}) {
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
		return (
			this.autoplay > 0 &&
			this.count > 1 &&
			!this.paused &&
			!this.dragging &&
			!this.#scrolling &&
			!this.#hovered &&
			!this.#focused &&
			!this.#hidden
		);
	}

	// ------------------------------------------------------------------
	// 操作
	// ------------------------------------------------------------------

	next(duration = this.duration) {
		if (this.index < this.count - 1) this.goTo(this.index + 1, duration);
		else if (this.rewind) this.goTo(0, duration);
	}

	prev(duration = this.duration) {
		if (this.index > 0) this.goTo(this.index - 1, duration);
		else if (this.rewind) this.goTo(this.count - 1, duration);
	}

	goTo(index: number, duration = this.duration) {
		if (this.dragging || this.count === 0) return;
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
			onpointerenter: this.#onPointerEnter,
			onpointerleave: this.#onPointerLeave,
			onfocusin: this.#onFocusIn,
			onfocusout: this.#onFocusOut,
			[this.#rootKey]: this.#attachRoot
		};
	}

	get viewport() {
		return {
			id: this.#viewportId,
			// 矢印キーでのスクロールはブラウザに任せる
			tabindex: 0,
			onkeydown: this.#onKeydown,
			'aria-live': this.playing ? 'off' : 'polite',
			'data-slider-viewport': '',
			'data-dragging': this.dragging || undefined,
			[this.#viewportKey]: this.#attachViewport
		} as const;
	}

	slide(i: number) {
		return {
			role: 'group',
			'aria-roledescription': 'slide',
			'aria-label': `${i + 1} / ${this.count}`,
			'data-slider-slide': '',
			'data-active': i === this.index || undefined,
			[this.#slideKey]: this.#attachSlide
		};
	}

	get prevButton() {
		return {
			type: 'button',
			'aria-label': '前へ',
			'aria-controls': this.#viewportId,
			disabled: !this.canPrev,
			onclick: () => this.prev()
		} as const;
	}

	get nextButton() {
		return {
			type: 'button',
			'aria-label': '次へ',
			'aria-controls': this.#viewportId,
			disabled: !this.canNext,
			onclick: () => this.next()
		} as const;
	}

	dot(i: number) {
		return {
			type: 'button',
			'aria-label': `スライド ${i + 1}`,
			'aria-controls': this.#viewportId,
			'aria-current': i === this.index ? 'true' : undefined,
			'data-active': i === this.index || undefined,
			onclick: () => this.goTo(i)
		} as const;
	}

	/** 再生/停止ボタン用 */
	get playButton() {
		return {
			type: 'button',
			'aria-label': this.paused ? '自動スライドを再開' : '自動スライドを停止',
			'aria-pressed': !this.paused,
			onclick: () => (this.paused = !this.paused)
		} as const;
	}

	// ------------------------------------------------------------------
	// アタッチメント
	// ------------------------------------------------------------------

	#attachRoot: Attachment<HTMLElement> = () => {
		this.#hidden = document.hidden;

		// 自動スライド。index が変わる(=何か操作された)たびにタイマーを掛け直す
		$effect(() => {
			if (!this.playing) return;
			this.index;
			const timer = setTimeout(() => this.next(), this.autoplay);
			return () => clearTimeout(timer);
		});

		return on(document, 'visibilitychange', () => (this.#hidden = document.hidden));
	};

	#attachViewport: Attachment<HTMLElement> = (node) => {
		adoptBaseStyles();
		this.#viewport = node;
		// 横方向の指の動きは JS で受け取り、ネイティブアプリのページングのように送る。
		// 縦スクロールはブラウザに任せる(JS が動く前はネイティブのスワイプで動く)
		node.style.touchAction = 'pan-y';

		const offs = [
			on(node, 'pointerdown', this.#onPointerDown),
			on(node, 'pointermove', this.#onPointerMove),
			on(node, 'pointerup', this.#onPointerUp),
			on(node, 'pointercancel', this.#onPointerCancel),
			on(node, 'lostpointercapture', this.#onLostCapture),
			on(node, 'click', this.#onClickCapture, { capture: true }),
			on(node, 'dragstart', (e) => e.preventDefault()),
			on(node, 'scroll', this.#onScroll, { passive: true }),
			on(node, 'scrollend', this.#onScrollEnd),
			// ホイール・トラックパッドで触られたら JS のアニメーションをやめてブラウザに渡す
			on(node, 'wheel', this.#onWheel, { passive: true })
		];

		const resize = new ResizeObserver(() => this.#measure());
		const observeChildren = () => {
			resize.disconnect();
			resize.observe(node);
			for (const child of node.children) resize.observe(child);
		};
		const mutation = new MutationObserver(() => {
			observeChildren();
			this.#measure();
		});
		mutation.observe(node, { childList: true });
		observeChildren();
		this.#measure();

		return () => {
			for (const off of offs) off();
			resize.disconnect();
			mutation.disconnect();
			clearTimeout(this.#idleTimer);
			this.#stop();
			node.style.removeProperty('touch-action');
			this.#viewport = undefined;
		};
	};

	#attachSlide: Attachment<HTMLElement> = () => adoptBaseStyles();

	// ------------------------------------------------------------------
	// 位置計算とスクロール
	// ------------------------------------------------------------------

	#measure() {
		const viewport = this.#viewport;
		if (!viewport) return;

		this.#max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
		// 各スライドの左端をスナップ位置にする。末尾で表示しきれない分は max にまとめる
		const snaps: number[] = [];
		for (const el of viewport.children as HTMLCollectionOf<HTMLElement>) {
			const pos = Math.min(el.offsetLeft, this.#max);
			if (snaps.length === 0 || pos - snaps[snaps.length - 1] > 1) snaps.push(pos);
		}
		this.#snaps = snaps;

		untrack(() => {
			this.count = snaps.length;
			if (this.index > Math.max(0, snaps.length - 1)) this.index = Math.max(0, snaps.length - 1);
		});
	}

	#nearest(pos: number) {
		let best = 0;
		for (let i = 1; i < this.#snaps.length; i++) {
			if (Math.abs(this.#snaps[i] - pos) < Math.abs(this.#snaps[best] - pos)) best = i;
		}
		return best;
	}

	/** 表示位置 (px)。端を越えて引っ張っている分も含む */
	#pos() {
		return (this.#viewport?.scrollLeft ?? 0) + this.#overshoot;
	}

	/** スクロール位置で表せない端の外側は、スライドの translate で見せる */
	#setPos(pos: number) {
		const viewport = this.#viewport;
		if (!viewport) return;
		const left = clamp(pos, 0, this.#max);
		viewport.scrollLeft = left;
		const overshoot = Math.abs(pos - left) < 0.5 ? 0 : pos - left;
		if (overshoot === this.#overshoot) return;
		this.#overshoot = overshoot;
		for (const el of viewport.children as HTMLCollectionOf<HTMLElement>) {
			if (overshoot) el.style.translate = `${-overshoot}px`;
			else el.style.removeProperty('translate');
		}
	}

	#stop() {
		cancelAnimationFrame(this.#raf);
		this.#raf = 0;
	}

	/** スナップを外したまま行き先まで JS で動かし、着いたら戻す */
	#animateTo(target = 0, duration: number, ease: (t: number) => number) {
		this.#stop();
		if (!this.#viewport) return;
		const from = this.#pos();
		const delta = target - from;
		this.#seeking = true;
		this.#scrolling = true;
		this.#startFreeScroll();
		if (duration <= 0 || Math.abs(delta) < 0.5) {
			this.#setPos(target);
			this.#settle();
			return;
		}
		const start = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / duration);
			this.#setPos(from + delta * ease(t));
			if (t < 1) {
				this.#raf = requestAnimationFrame(step);
			} else {
				this.#raf = 0;
				this.#settle();
			}
		};
		this.#raf = requestAnimationFrame(step);
	}

	/** 指を離したとき、速度 (px/ms, 右向き正) に応じて行き先を決めて送る */
	#release(velocity: number, from = this.index) {
		const pos = this.#pos();
		const snaps = this.#snaps;
		let target = this.#nearest(pos);

		if (Math.abs(velocity) > FLICK_VELOCITY) {
			// フリック: 指の向きの次のスナップ位置へ
			const forward = velocity < 0;
			let i = forward
				? snaps.findIndex((s) => s > pos + 1)
				: snaps.findLastIndex((s) => s < pos - 1);
			// 同じ向きへ移動中に再度フリックしたら、移動先のさらに次へ(連続フリック)
			if (forward && snaps[from] > pos + 1) i = Math.min(from + 1, snaps.length - 1);
			if (!forward && snaps[from] < pos - 1) i = Math.max(from - 1, 0);
			if (i !== -1) target = i;
		}

		this.index = target;
		const to = snaps[target] ?? 0;
		const distance = Math.abs(to - pos);
		// 初速 (2 * 距離 / 時間) が離した瞬間の指の速度と揃うように時間を決める
		const speed = Math.abs(velocity);
		const duration =
			speed > FLICK_VELOCITY
				? clamp((2 * distance) / speed, MIN_FLICK_DURATION, MAX_FLICK_DURATION)
				: clamp(distance * 1.2, MIN_FLICK_DURATION, this.duration);
		this.#animateTo(to, duration, easeOutQuad);
	}

	/** ドラッグ中と JS で動かしている間はスナップを外して scrollLeft を直接動かす */
	#startFreeScroll() {
		const style = this.#viewport?.style;
		style?.setProperty('scroll-snap-type', 'none');
		style?.setProperty('scroll-behavior', 'auto');
		style?.setProperty('user-select', 'none');
	}

	#endFreeScroll() {
		const style = this.#viewport?.style;
		style?.removeProperty('scroll-snap-type');
		style?.removeProperty('scroll-behavior');
		style?.removeProperty('user-select');
	}

	#onScroll = () => {
		const viewport = this.#viewport;
		if (!viewport) return;
		this.#scrolling = true;
		if (!this.#seeking && !this.dragging) this.index = this.#nearest(viewport.scrollLeft);
		clearTimeout(this.#idleTimer);
		this.#idleTimer = setTimeout(this.#onScrollEnd, SCROLL_IDLE);
	};

	/** ブラウザ側のスクロールが止まったとき。ドラッグ中と JS で動かしている間は無視する */
	#onScrollEnd = () => {
		if (this.dragging || this.#raf) return;
		this.#settle();
	};

	/** スクロールが終わったときの後始末。スナップを戻し、index を位置に合わせる */
	#settle() {
		const viewport = this.#viewport;
		if (!viewport) return;
		clearTimeout(this.#idleTimer);
		this.#seeking = false;
		this.#scrolling = false;
		this.#endFreeScroll();
		this.index = this.#nearest(viewport.scrollLeft);
	}

	#onWheel = () => {
		if (!this.#raf) return;
		this.#stop();
		this.#setPos(clamp(this.#pos(), 0, this.#max));
		this.#settle();
	};

	// ------------------------------------------------------------------
	// ドラッグ(タッチ・ペン・マウス)
	// ------------------------------------------------------------------

	#onPointerDown = (e: PointerEvent) => {
		if (!e.isPrimary || e.button !== 0 || !this.#viewport || this.count === 0) return;
		// アニメーション中に掴んだらその場で止める(連続フリック対応)
		const interrupted = this.#raf !== 0;
		this.#stop();
		this.#gesture = {
			id: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			pos: this.#pos(),
			index: this.index,
			interrupted,
			samples: [{ x: e.clientX, t: e.timeStamp }]
		};
	};

	#onPointerMove = (e: PointerEvent) => {
		const g = this.#gesture;
		const viewport = this.#viewport;
		if (!g || !viewport || e.pointerId !== g.id) return;
		const dx = e.clientX - g.x;
		const dy = e.clientY - g.y;

		if (!this.dragging) {
			if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
			// 縦方向の動きが勝ったらスライド操作ではない
			if (Math.abs(dy) > Math.abs(dx)) {
				this.#endGesture(0);
				return;
			}
			this.dragging = true;
			this.#seeking = false;
			viewport.setPointerCapture(e.pointerId);
			this.#startFreeScroll();
			getSelection()?.removeAllRanges();
		}

		e.preventDefault();
		let pos = g.pos - dx;
		if (pos < 0) pos = -rubberBand(-pos, viewport.clientWidth);
		else if (pos > this.#max) pos = this.#max + rubberBand(pos - this.#max, viewport.clientWidth);
		this.#setPos(pos);

		// ブラウザがフレーム単位にまとめた move も拾って速度の精度を上げる
		const events = e.getCoalescedEvents?.() ?? [];
		for (const ev of events.length ? events : [e]) g.samples.push({ x: ev.clientX, t: ev.timeStamp });
		while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > VELOCITY_WINDOW) {
			g.samples.shift();
		}
	};

	#onPointerUp = (e: PointerEvent) => {
		const g = this.#gesture;
		if (!g || e.pointerId !== g.id) return;
		let velocity = 0;
		const first = g.samples[0];
		const last = g.samples[g.samples.length - 1];
		// 止めてから離した場合はフリックにしない
		if (last.t > first.t && e.timeStamp - last.t < 50) {
			velocity = (last.x - first.x) / (last.t - first.t);
		}
		if (this.dragging) this.#suppressClick = true;
		this.#endGesture(velocity);
	};

	#onPointerCancel = (e: PointerEvent) => {
		if (this.#gesture?.id === e.pointerId) this.#endGesture(0);
	};

	// タッチでは子要素(リンク等)が暗黙にキャプチャしており、viewport へ移すと
	// 子要素の lostpointercapture がバブリングしてくるので viewport 自身のものだけ見る
	#onLostCapture = (e: PointerEvent) => {
		if (e.target === e.currentTarget) this.#onPointerCancel(e);
	};

	#endGesture(velocity: number) {
		const g = this.#gesture;
		const viewport = this.#viewport;
		this.#gesture = undefined;
		if (!g || !viewport) return;
		// 動かさずに離しただけ(タップ・クリック)なら何もしない
		if (!this.dragging && !g.interrupted) return;
		if (viewport.hasPointerCapture(g.id)) viewport.releasePointerCapture(g.id);
		this.dragging = false;
		// 掴んで止めただけの場合も含め、必ずスナップ位置へ送る
		this.#release(velocity, g.index);
		// ドラッグ後に click が来なかった場合に備えて解除
		setTimeout(() => (this.#suppressClick = false));
	}

	/** ドラッグ後のリンク遷移などを防ぐ */
	#onClickCapture = (e: MouseEvent) => {
		if (!this.#suppressClick) return;
		this.#suppressClick = false;
		e.preventDefault();
		e.stopPropagation();
	};

	/** scroll-snap-stop: always だと Home・End も 1 枚ずつしか進まないので、そこだけ受け持つ */
	#onKeydown = (e: KeyboardEvent) => {
		if ((e.key !== 'Home' && e.key !== 'End') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
			return;
		}
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		e.preventDefault();
		this.goTo(e.key === 'Home' ? 0 : this.count - 1);
	};

	#onPointerEnter = (e: PointerEvent) => {
		if (e.pointerType === 'mouse') this.#hovered = true;
	};

	#onPointerLeave = (e: PointerEvent) => {
		if (e.pointerType === 'mouse') this.#hovered = false;
	};

	// キーボード操作中だけ止める(クリック後のフォーカスで止まり続けないように)
	#onFocusIn = (e: FocusEvent) => {
		this.#focused = e.target instanceof Element && e.target.matches(':focus-visible');
	};

	#onFocusOut = (e: FocusEvent) => {
		const root = e.currentTarget as HTMLElement;
		if (!root.contains(e.relatedTarget as Node | null)) this.#focused = false;
	};
}

function reducedMotion() {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
