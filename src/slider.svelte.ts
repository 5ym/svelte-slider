import { untrack } from 'svelte';
import { createAttachmentKey, type Attachment } from 'svelte/attachments';
import { on } from 'svelte/events';

export interface SliderOptions {
	/** 自動スライドの間隔 (ms)。0 で無効。既定 4000 */
	autoplay?: number;
	/** 端で next / prev したとき反対側の端へ戻るか。既定 true */
	rewind?: boolean;
}

/** これ以上の速度 (px/ms) で離したらフリックとみなす(マウスドラッグのみ) */
const FLICK_VELOCITY = 0.3;
/** ドラッグ開始とみなす移動量 (px)。これ未満はクリック扱い */
const DRAG_THRESHOLD = 6;
/** 離す直前のこの時間 (ms) の動きから速度を求める */
const VELOCITY_WINDOW = 40;
/** scrollend が来ない環境向けに、最後の scroll からこの時間 (ms) でスクロール終了とみなす */
const SCROLL_IDLE = 150;

/**
 * スライダーの動きそのもの。スワイプ・フリック・スナップ・キー操作はブラウザの
 * スクロールと scroll-snap に任せる。詳細度 0 なので利用側の CSS で上書きできる
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
	/** ユーザーがマウスでドラッグ中か */
	dragging = $state(false);
	/** 以下の設定は実行中にも変更できる。意味は SliderOptions を参照 */
	autoplay = $state(4000);
	rewind = $state(true);
	/** 自動スライドを手動で止めているか(再生/停止ボタン用) */
	paused = $state(false);

	#viewportId = `slider-${++uid}-viewport`;
	#viewport: HTMLElement | undefined;
	#snaps: number[] = [];

	/** スクロール中か(タッチ・ホイール・ボタンによる移動を問わない) */
	#scrolling = $state(false);
	#hovered = $state(false);
	#focused = $state(false);
	#hidden = $state(false);

	/** goTo によるスクロール中は、途中の位置で index を書き換えない */
	#seeking = false;
	#idleTimer: ReturnType<typeof setTimeout> | undefined;

	#gesture:
		| {
				id: number;
				x: number;
				scrollLeft: number;
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

	next() {
		if (this.index < this.count - 1) this.goTo(this.index + 1);
		else if (this.rewind) this.goTo(0);
	}

	prev() {
		if (this.index > 0) this.goTo(this.index - 1);
		else if (this.rewind) this.goTo(this.count - 1);
	}

	goTo(index: number) {
		if (this.dragging || this.count === 0) return;
		this.index = clamp(index, 0, this.count - 1);
		this.#scrollTo(this.#snaps[this.index]);
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

		const offs = [
			on(node, 'pointerdown', this.#onPointerDown),
			on(node, 'pointermove', this.#onPointerMove),
			on(node, 'pointerup', this.#onPointerUp),
			on(node, 'pointercancel', this.#onPointerCancel),
			on(node, 'lostpointercapture', this.#onLostCapture),
			on(node, 'click', this.#onClickCapture, { capture: true }),
			on(node, 'dragstart', (e) => e.preventDefault()),
			on(node, 'scroll', this.#onScroll, { passive: true }),
			on(node, 'scrollend', this.#onScrollEnd)
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

		const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
		// 各スライドの左端をスナップ位置にする。末尾で表示しきれない分は max にまとめる
		const snaps: number[] = [];
		for (const el of viewport.children as HTMLCollectionOf<HTMLElement>) {
			const pos = Math.min(el.offsetLeft, max);
			if (snaps.length === 0 || pos - snaps[snaps.length - 1] > 1) snaps.push(pos);
		}
		this.#snaps = snaps;

		untrack(() => {
			this.count = snaps.length;
			if (this.index > Math.max(0, snaps.length - 1)) this.index = Math.max(0, snaps.length - 1);
		});
	}

	#nearest(scrollLeft: number) {
		let best = 0;
		for (let i = 1; i < this.#snaps.length; i++) {
			if (Math.abs(this.#snaps[i] - scrollLeft) < Math.abs(this.#snaps[best] - scrollLeft)) best = i;
		}
		return best;
	}

	#scrollTo(left = 0) {
		const viewport = this.#viewport;
		if (!viewport) return;
		// 動かない場合は scrollend が来ないので、ここでスクロール終了の後始末をする
		// (ドラッグして元の位置に戻した場合など。残すと #scrolling が立ったままになる)
		if (Math.abs(viewport.scrollLeft - left) < 1) {
			this.#onScrollEnd();
			return;
		}
		this.#seeking = true;
		viewport.scrollTo({ left, behavior: reducedMotion() ? 'instant' : 'smooth' });
	}

	/** マウスドラッグ中と、離した後の移動中はスナップを外して scrollLeft を直接動かす */
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

	#onScrollEnd = () => {
		const viewport = this.#viewport;
		if (!viewport || this.dragging) return;
		clearTimeout(this.#idleTimer);
		this.#seeking = false;
		this.#scrolling = false;
		this.#endFreeScroll();
		this.index = this.#nearest(viewport.scrollLeft);
	};

	// ------------------------------------------------------------------
	// マウスドラッグ(タッチはブラウザのスクロールに任せる)
	// ------------------------------------------------------------------

	#onPointerDown = (e: PointerEvent) => {
		if (e.pointerType !== 'mouse' || e.button !== 0 || !this.#viewport || this.count === 0) return;
		this.#gesture = {
			id: e.pointerId,
			x: e.clientX,
			scrollLeft: this.#viewport.scrollLeft,
			samples: [{ x: e.clientX, t: e.timeStamp }]
		};
	};

	#onPointerMove = (e: PointerEvent) => {
		const g = this.#gesture;
		const viewport = this.#viewport;
		if (!g || !viewport || e.pointerId !== g.id) return;
		const dx = e.clientX - g.x;

		if (!this.dragging) {
			if (Math.abs(dx) < DRAG_THRESHOLD) return;
			this.dragging = true;
			this.#seeking = false;
			viewport.setPointerCapture(e.pointerId);
			// 移動中に掴んだらその位置から動かす
			g.scrollLeft = viewport.scrollLeft;
			g.x = e.clientX;
			this.#startFreeScroll();
			getSelection()?.removeAllRanges();
		}

		e.preventDefault();
		viewport.scrollLeft = g.scrollLeft - (e.clientX - g.x);

		for (const ev of e.getCoalescedEvents?.() ?? [e]) g.samples.push({ x: ev.clientX, t: ev.timeStamp });
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

	#onLostCapture = (e: PointerEvent) => {
		if (e.target === e.currentTarget) this.#onPointerCancel(e);
	};

	#endGesture(velocity: number) {
		const viewport = this.#viewport;
		const pointerId = this.#gesture?.id;
		this.#gesture = undefined;
		if (!viewport || !this.dragging) return;
		if (pointerId !== undefined && viewport.hasPointerCapture(pointerId)) {
			viewport.releasePointerCapture(pointerId);
		}
		this.dragging = false;

		// 速く離したら指の向きの次のスナップ位置へ、そうでなければ近い方へ
		const left = viewport.scrollLeft;
		let target = this.#nearest(left);
		if (Math.abs(velocity) > FLICK_VELOCITY) {
			const i =
				velocity < 0
					? this.#snaps.findIndex((s) => s > left + 1)
					: this.#snaps.findLastIndex((s) => s < left - 1);
			if (i !== -1) target = i;
		}
		// スナップを外したまま行き先まで動かし、止まったら戻す(戻した瞬間に近い方へ吸い寄せられないように)
		this.index = target;
		this.#scrollTo(this.#snaps[target]);
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
		if (e.key !== 'Home' && e.key !== 'End') return;
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
