import { type Attachment } from 'svelte/attachments';
export interface SliderOptions {
    /** 自動スライドの間隔 (ms)。0 で無効。既定 4000 */
    autoplay?: number;
    /** 端で next / prev したとき反対側の端へ戻るか。既定 true */
    rewind?: boolean;
    /** ボタン・ドット・自動スライドのアニメーション時間 (ms)。既定 400 */
    duration?: number;
}
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
export declare class Slider {
    #private;
    /** 現在(移動中なら移動先)のスライド番号 */
    index: number;
    /** スナップ位置の数(= ページ数)。スライド幅の合計が足りない分は末尾がまとめられる */
    count: number;
    /** ユーザーがドラッグ中か */
    dragging: boolean;
    /** 以下の設定は実行中にも変更できる。意味は SliderOptions を参照 */
    autoplay: number;
    rewind: boolean;
    duration: number;
    /** 自動スライドを手動で止めているか(再生/停止ボタン用) */
    paused: boolean;
    constructor(options?: SliderOptions);
    get canPrev(): boolean;
    get canNext(): boolean;
    /** 自動スライドが実際に動いている状態か */
    get playing(): boolean;
    next(duration?: number): void;
    prev(duration?: number): void;
    goTo(index: number, duration?: number): void;
    get root(): {
        [x: symbol]: Attachment<HTMLElement>;
        role: string;
        'aria-roledescription': string;
        onkeydown: (e: KeyboardEvent) => void;
        onpointerenter: (e: PointerEvent) => void;
        onpointerleave: (e: PointerEvent) => void;
        onfocusin: (e: FocusEvent) => void;
        onfocusout: (e: FocusEvent) => void;
    };
    get viewport(): {
        readonly [x: symbol]: Attachment<HTMLElement>;
        readonly 'aria-live': "off" | "polite";
        readonly 'data-dragging': true | undefined;
    };
    get track(): {
        [x: symbol]: Attachment<HTMLElement>;
        id: string;
    };
    slide(i: number): {
        role: string;
        'aria-roledescription': string;
        'aria-label': string;
        'data-active': true | undefined;
    };
    get prevButton(): {
        readonly type: "button";
        readonly 'aria-label': "前へ";
        readonly 'aria-controls': string;
        readonly disabled: boolean;
        readonly onclick: () => void;
    };
    get nextButton(): {
        readonly type: "button";
        readonly 'aria-label': "次へ";
        readonly 'aria-controls': string;
        readonly disabled: boolean;
        readonly onclick: () => void;
    };
    dot(i: number): {
        readonly type: "button";
        readonly 'aria-label': `\u30B9\u30E9\u30A4\u30C9 ${number}`;
        readonly 'aria-controls': string;
        readonly 'aria-current': "true" | undefined;
        readonly 'data-active': true | undefined;
        readonly onclick: () => void;
    };
    /** 再生/停止ボタン用 */
    get playButton(): {
        readonly type: "button";
        readonly 'aria-label': "自動スライドを再開" | "自動スライドを停止";
        readonly 'aria-pressed': boolean;
        readonly onclick: () => boolean;
    };
}
