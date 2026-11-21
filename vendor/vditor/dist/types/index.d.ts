declare module "*.svg";

declare module "*.png";

type TWYSISYGToolbar =
    "table"
    | "code-block"
    | "heading"
    | "link-ref"
    | "a"
    | "image"
    | "footnotes-block"
    | "footnotes-ref"
    | "vditor-toc"
    | "blockquote"
    | "li"
    | "block"

interface Window {
    VditorI18n: ITips;
    hljs: {
        listLanguages(): string[];
        highlight(text: string, options: {
            language?: string,
            ignoreIllegals: boolean
        }): {
            value: string
        };
        getLanguage(text: string): {
            name: string
        };
    };
}

interface IObject {
    [key: string]: string;
}

interface ILuteNode {
    TokensStr: () => string;
    __internal_object__: {
        Parent: {
            Type: number,
            LinkType: number,
        },
        HeadingLevel: string,
    };
}

type ILuteRenderCallback = (node: ILuteNode, entering: boolean) => [string, number];

interface ILuteRender {
    renderDocument?: ILuteRenderCallback;
    renderParagraph?: ILuteRenderCallback;
    renderText?: ILuteRenderCallback;
    renderCodeBlock?: ILuteRenderCallback;
    renderCodeBlockOpenMarker?: ILuteRenderCallback;
    renderCodeBlockInfoMarker?: ILuteRenderCallback;
    renderCodeBlockCode?: ILuteRenderCallback;
    renderCodeBlockCloseMarker?: ILuteRenderCallback;
    renderMathBlock?: ILuteRenderCallback;
    renderMathBlockOpenMarker?: ILuteRenderCallback;
    renderMathBlockContent?: ILuteRenderCallback;
    renderMathBlockCloseMarker?: ILuteRenderCallback;
    renderBlockquote?: ILuteRenderCallback;
    renderBlockquoteMarker?: ILuteRenderCallback;
    renderCallout?: ILuteRenderCallback;
    renderHeading?: ILuteRenderCallback;
    renderHeadingC8hMarker?: ILuteRenderCallback;
    renderList?: ILuteRenderCallback;
    renderListItem?: ILuteRenderCallback;
    renderTaskListItemMarker?: ILuteRenderCallback;
    renderThematicBreak?: ILuteRenderCallback;
    renderHTML?: ILuteRenderCallback;
    renderTable?: ILuteRenderCallback;
    renderTableHead?: ILuteRenderCallback;
    renderTableRow?: ILuteRenderCallback;
    renderTableCell?: ILuteRenderCallback;
    renderFootnotesDef?: ILuteRenderCallback;
    renderCodeSpan?: ILuteRenderCallback;
    renderCodeSpanOpenMarker?: ILuteRenderCallback;
    renderCodeSpanContent?: ILuteRenderCallback;
    renderCodeSpanCloseMarker?: ILuteRenderCallback;
    renderInlineMath?: ILuteRenderCallback;
    renderInlineMathOpenMarker?: ILuteRenderCallback;
    renderInlineMathContent?: ILuteRenderCallback;
    renderInlineMathCloseMarker?: ILuteRenderCallback;
    renderEmphasis?: ILuteRenderCallback;
    renderEmAsteriskOpenMarker?: ILuteRenderCallback;
    renderEmAsteriskCloseMarker?: ILuteRenderCallback;
    renderEmUnderscoreOpenMarker?: ILuteRenderCallback;
    renderEmUnderscoreCloseMarker?: ILuteRenderCallback;
    renderStrong?: ILuteRenderCallback;
    renderStrongA6kOpenMarker?: ILuteRenderCallback;
    renderStrongA6kCloseMarker?: ILuteRenderCallback;
    renderStrongU8eOpenMarker?: ILuteRenderCallback;
    renderStrongU8eCloseMarker?: ILuteRenderCallback;
    renderStrikethrough?: ILuteRenderCallback;
    renderStrikethrough1OpenMarker?: ILuteRenderCallback;
    renderStrikethrough1CloseMarker?: ILuteRenderCallback;
    renderStrikethrough2OpenMarker?: ILuteRenderCallback;
    renderStrikethrough2CloseMarker?: ILuteRenderCallback;
    renderHardBreak?: ILuteRenderCallback;
    renderSoftBreak?: ILuteRenderCallback;
    renderInlineHTML?: ILuteRenderCallback;
    renderLink?: ILuteRenderCallback;
    renderOpenBracket?: ILuteRenderCallback;
    renderCloseBracket?: ILuteRenderCallback;
    renderOpenParen?: ILuteRenderCallback;
    renderCloseParen?: ILuteRenderCallback;
    renderLinkText?: ILuteRenderCallback;
    renderLinkSpace?: ILuteRenderCallback;
    renderLinkDest?: ILuteRenderCallback;
    renderLinkTitle?: ILuteRenderCallback;
    renderImage?: ILuteRenderCallback;
    renderBang?: ILuteRenderCallback;
    renderEmoji?: ILuteRenderCallback;
    renderEmojiUnicode?: ILuteRenderCallback;
    renderEmojiImg?: ILuteRenderCallback;
    renderEmojiAlias?: ILuteRenderCallback;
    renderToC?: ILuteRenderCallback;
    renderFootnotesRef?: ILuteRenderCallback;
    renderBackslash?: ILuteRenderCallback;
    renderBackslashContent?: ILuteRenderCallback;
}

interface ILuteOptions extends IMarkdownConfig {
    emojis: IObject;
    emojiSite: string;
    headingAnchor: boolean;
    inlineMathDigit: boolean;
    lazyLoadImage?: string;
}

declare class Lute {
    public static WalkStop: number;
    public static WalkSkipChildren: number;
    public static WalkContinue: number;
    public static Version: string;
    public static Caret: string;

    public static New(): Lute;

    public static EscapeHTMLStr(html: string): string;

    public static GetHeadingID(node: ILuteNode): string;

    public static GetHeadingIDRaw(node: ILuteNode): string;

    public static NewNodeID(): string;

    public static Sanitize(html: string): string;

    private constructor();

    public SetJSRenderers(options?: {
        renderers: {
            HTML2VditorDOM?: ILuteRender,
            HTML2VditorIRDOM?: ILuteRender,
            HTML2Md?: ILuteRender,
            Md2HTML?: ILuteRender,
            Md2VditorDOM?: ILuteRender,
            Md2VditorIRDOM?: ILuteRender,
            Md2VditorSVDOM?: ILuteRender,
        },
    }): void;

    public SetChineseParagraphBeginningSpace(enable: boolean): void;

    public SetCallout(enable: boolean): void;
    public SetInlineMath(enable: boolean): void;

    public SetHeadingID(enable: boolean): void;

    public SetRenderListStyle(enable: boolean): void;

    public SetLinkBase(url: string): void;

    public SetVditorIR(enable: boolean): void;

    public SetVditorSV(enable: boolean): void;

    public SetVditorWYSIWYG(enable: boolean): void;

    public SetLinkPrefix(url: string): void;

    public SetMark(enable: boolean): void;

    public SetGFMAutoLink(enable: boolean): void;

    public SetSanitize(enable: boolean): void;

    public SetHeadingAnchor(enable: boolean): void;

    public SetImageLazyLoading(imagePath: string): void;

    public SetInlineMathAllowDigitAfterOpenMarker(enable: boolean): void;

    public SetToC(enable: boolean): void;

    public SetFootnotes(enable: boolean): void;

    public SetAutoSpace(enable: boolean): void;

    public SetFixTermTypo(enable: boolean): void;

    public SetEmojiSite(emojiSite: string): void;

    public SetVditorCodeBlockPreview(enable: boolean): void;

    public SetVditorMathBlockPreview(enable: boolean): void;

    public SetSub(enable: boolean): void;

    public SetSup(enable: boolean): void;

    public PutEmojis(emojis: IObject): void;

    public GetEmojis(): IObject;

    public IsValidLinkDest(link: string): boolean;

    // debugger md
    public RenderEChartsJSON(text: string): string;

    public Md2HTML(markdown: string): string;

    public HTML2Md(html: string): string;

    public VditorDOM2HTML(vhtml: string): string;

    public SpinVditorDOM(html: string): string;

    public HTML2VditorDOM(html: string): string;

    public VditorDOM2Md(html: string): string;

    public Md2VditorDOM(markdown: string): string;

    public SpinVditorIRDOM(markdown: string): string;

    public VditorIRDOM2Md(html: string): string;

    public Md2VditorIRDOM(text: string): string;

    public VditorIRDOM2HTML(html: string): string;

    public HTML2VditorIRDOM(html: string): string;

    public SpinVditorSVDOM(text: string): string;

    public Md2VditorSVDOM(text: string): string;

    public RenderJSON(markdown: string): string;
}

declare const webkitAudioContext: {
    prototype: AudioContext
    new(contextOptions?: AudioContextOptions): AudioContext,
};

interface ITips {
    [index: string]: string;

    alignCenter: string;
    alignLeft: string;
    alignRight: string;
    alternateText: string;
    bold: string;
    both: string;
    check: string;
    close: string;
    code: string;
    "code-theme": string;
    column: string;
    comment: string;
    confirm: string;
    "content-theme": string;
    copied: string;
    copy: string;
    "delete-column": string;
    "delete-row": string;
    devtools: string;
    down: string;
    downloadTip: string;
    edit: string;
    "edit-mode": string;
    emoji: string;
    export: string;
    fileTypeError: string;
    footnoteRef: string;
    fullscreen: string;
    generate: string;
    headings: string;
    help: string;
    imageURL: string;
    indent: string;
    info: string;
    "inline-code": string;
    "insert-after": string;
    "insert-before": string;
    insertColumnLeft: string;
    insertColumnRight: string;
    insertRowAbove: string;
    insertRowBelow: string;
    instantRendering: string;
    italic: string;
    language: string;
    line: string;
    link: string;
    linkRef: string;
    list: string;
    more: string;
    nameEmpty: string;
    "ordered-list": string;
    outdent: string;
    outline: string;
    over: string;
    performanceTip: string;
    preview: string;
    quote: string;
    record: string;
    "record-tip": string;
    recording: string;
    redo: string;
    remove: string;
    row: string;
    spin: string;
    splitView: string;
    strike: string;
    table: string;
    textIsNotEmpty: string;
    title: string;
    tooltipText: string;
    undo: string;
    up: string;
    update: string;
    upload: string;
    uploadError: string;
    uploading: string;
    wysiwyg: string;
}

interface II18n {
    en_US: ITips;
}

interface IClasses {
    preview?: string;
}

interface IPreviewTheme {
    current: string;
    list?: IObject;
    path?: string;
}

interface IUpload {
    url?: string;
    max?: number;
    linkToImgUrl?: string;

    renderLinkDest?(vditor: IVditor, node: ILuteNode, entering: boolean): [string, number];

    token?: string;
    accept?: string;
    withCredentials?: boolean;
    headers?: IObject;
    extraData?: {[key: string]: string | Blob};
    multiple?: boolean;
    fieldName?: string;

    setHeaders?(): IObject;

    success?(editor: HTMLPreElement | HTMLTextAreaElement, msg: string): void;

    error?(msg: string): void;

    filename?(name: string): string;

    validate?(files: File[]): string | boolean;

    handler?(files: File[]): string | null | Promise<string> | Promise<null>;

    handleDataUrl?(dataUrl: string): string | Promise<string>;

    base64ToLink?(responseText: string): string;

    format?(files: File[], responseText: string): string;

    linkToImgFormat?(responseText: string): string;

    file?(files: File[]): File[] | Promise<File[]>;

    cancel?(files: File[]): void;

    linkToImgCallback?(responseText: string): void;
}

interface IMenuItem {
    name: string;
    icon?: string;
    className?: string;
    tip?: string;
    hotkey?: string;
    suffix?: string;
    prefix?: string;
    tipPosition?: string;
    toolbar?: Array<string | IMenuItem>;
    level?: number;

    click?(event: Event, vditor: IVditor): void;
}

interface IHljs {
    defaultLang?: string;
    lineNumber?: boolean;
    style?: string;
    enable?: boolean;
    langs?: string[];

    renderMenu?(element: HTMLElement, menuElement: HTMLElement): void;
}

interface IMath {
    inlineDigit?: boolean;
    macros?: object;
    engine?: "KaTeX" | "MathJax";
    mathJaxOptions?: any;
}

interface IMarkdownConfig {
    autoSpace?: boolean;
    callout?: boolean;
    inlineMath?: boolean;
    paragraphBeginningSpace?: boolean;
    fixTermTypo?: boolean;
    toc?: boolean;
    footnotes?: boolean;
    imageCaption?: boolean;
    codeBlockPreview?: boolean;
    mathBlockPreview?: boolean;
    sanitize?: boolean;
    linkBase?: string;
    linkPrefix?: string;
    listStyle?: boolean;
    mark?: boolean;
    gfmAutoLink?: boolean;
    sup?: boolean;
    sub?: boolean;
}

interface IPreview {
    delay?: number;
    maxWidth?: number;
    mode?: "both" | "editor";
    url?: string;
    hljs?: IHljs;
    math?: IMath;
    markdown?: IMarkdownConfig;
    theme?: IPreviewTheme;
    actions?: Array<IPreviewAction | IPreviewActionCustom>;
    render?: IPreviewRender;

    parse?(element: HTMLElement): void;

    transform?(html: string): string;
}

interface IPreviewRender {
    media?: {
        enable?: boolean;
    };
}

type IPreviewAction = "desktop" | "tablet" | "mobile";

interface IPreviewActionCustom {
    key: string;
    text: string;
    className?: string;
    tooltip?: string;
    click: (key: string) => void;
}

interface IPreviewOptions {
    mode: "dark" | "light";
    customEmoji?: IObject;
    lang?: (keyof II18n);
    i18n?: ITips;
    lazyLoadImage?: string;
    emojiPath?: string;
    hljs?: IHljs;
    speech?: {
        enable?: boolean,
    };
    anchor?: number; // 0: no render, 1: render left, 2: render right
    math?: IMath;
    cdn?: string;
    markdown?: IMarkdownConfig;
    renderers?: ILuteRender;
    theme?: IPreviewTheme;
    icon?: "ant" | "material" | undefined;
    render?: IPreviewRender;

    transform?(html: string): string;

    after?(): void;
}

interface IHintData {
    html: string;
    value: string;
}

interface IHintExtend {
    key: string;

    hint?(value: string): IHintData[] | Promise<IHintData[]>;
}

interface IHint {
    parse?: boolean;
    emojiTail?: string;
    delay?: number;
    emoji?: IObject;
    emojiPath?: string;
    extend?: IHintExtend[];
}

interface IToolbarConfig {
    hide?: boolean;
    pin?: boolean;
}

interface IComment {
    enable: boolean;

    add?(id: string, text: string, commentsData: ICommentsData[]): void;

    remove?(ids: string[]): void;

    scroll?(top: number): void;

    adjustTop?(commentsData: ICommentsData[]): void;
}

interface IOutline {
    enable: boolean;
    position: "left" | "right";
}

interface IResize {
    position?: string;
    enable?: boolean;

    after?(height: number): void;
}

interface IOptions {
    /** RTL */
    rtl?: boolean;
    undoDelay?: number;
    _lutePath?: string;
    value?: string;
    debugger?: boolean;
    typewriterMode?: boolean;
    height?: number | string;
    minHeight?: number;
    width?: number | string;
    placeholder?: string;
    lang?: (keyof II18n);
    i18n?: ITips;
    fullscreen?: {
        index: number;
    };
    toolbar?: Array<string | IMenuItem>;
    resize?: IResize;
    counter?: {
        enable: boolean;
        max?: number;
        type?: "markdown" | "text";
        after?(length: number, counter: {
            enable: boolean;
            max?: number;
            type?: "markdown" | "text"
        }): void
    };
    cache?: {
        id?: string;
        enable?: boolean;
        after?(markdown: string): void;
    };
    mode?: "wysiwyg" | "sv" | "ir";
    preview?: IPreview;
    link?: {
        isOpen?: boolean;
        click?: (bom: Element) => void;
    },
    image?: {
        isPreview?: boolean;
        preview?: (bom: Element) => void;
    },
    hint?: IHint;
    toolbarConfig?: IToolbarConfig;
    comment?: IComment;
    theme?: "classic" | "dark";
    icon?: "ant" | "material";
    upload?: IUpload;
    classes?: IClasses;
    cdn?: string;
    tab?: string;
    outline?: IOutline;
    customRenders?: {
        language: string,
        render: (element: HTMLElement, vditor: IVditor) => void
    }[],

    after?(): void;

    input?(value: string): void;

    focus?(value: string): void;

    blur?(value: string): void;

    keydown?(event: KeyboardEvent): void;

    esc?(value: string): void;

    ctrlEnter?(value: string): void;

    select?(value: string): void;

    unSelect?(): void;

    customWysiwygToolbar?(type: TWYSISYGToolbar, element: HTMLElement): void

    customWysiwygMobileToolbar?(type: TWYSISYGToolbar, element: HTMLElement): void
}

interface IEChart {
    setOption(option: any): void;

    resize(): void;
}

interface IVditor {
    element: HTMLElement;
    options: IOptions;
    originalInnerHTML: string;
    lute: Lute;
    currentMode: "sv" | "wysiwyg" | "ir";
    devtools?: {
        element: HTMLDivElement,
        renderEchart(vditor: IVditor): void,
    };
    outline: {
        element: HTMLElement,
        render(vditor: IVditor): string,
        toggle(vditor: IVditor, show?: boolean, focus?: boolean): void,
    };
    toolbar?: {
        elements?: {[key: string]: HTMLElement},
        element?: HTMLElement,
        updateConfig(vditor: IVditor, options: IToolbarConfig): void,
    };
    preview?: {
        element: HTMLElement,
        previewElement: HTMLElement,
        render(vditor: IVditor, value?: string): void,
    };
    counter?: {
        element: HTMLElement
        render(vditor: IVditor, mdText?: string): void,
    };
    resize?: {
        element: HTMLElement,
    };
    hint: {
        timeId: number
        element: HTMLDivElement
        recentLanguage: string
        fillEmoji(element: HTMLElement, vditor: IVditor): void
        render(vditor: IVditor): void,
        genHTML(data: IHintData[], key: string, vditor: IVditor): void
        select(event: KeyboardEvent, vditor: IVditor): boolean,
    };
    tip: {
        element: HTMLElement
        show(text: string, time?: number): void
        hide(): void,
    };
    upload?: {
        element: HTMLElement
        isUploading: boolean
        range: Range,
        selectionEnd: number,
        selectionStart: number,
        xhr?: XMLHttpRequest,
    };
    undo?: {
        clearStack(vditor: IVditor): void,
        redo(vditor: IVditor): void
        undo(vditor: IVditor): void
        addToUndoStack(vditor: IVditor): void
        recordFirstPosition(vditor: IVditor, event: KeyboardEvent): void,
        resetIcon(vditor: IVditor): void,
    };
    wysiwyg?: {
        range: Range,
        element: HTMLPreElement,
        selectPopover: HTMLDivElement,
        popover: HTMLDivElement,
        afterRenderTimeoutId: number,
        hlToolbarTimeoutId: number,
        preventInput: boolean,
        composingLock: boolean,
        commentIds: string[]
        getComments(vditor: IVditor, getData?: boolean): ICommentsData[],
        triggerRemoveComment(vditor: IVditor): void,
        showComment(): void,
        hideComment(): void,
        unbindListener(): void,
    };
    ir?: {
        range: Range,
        element: HTMLPreElement,
        composingLock: boolean,
        preventInput: boolean,
        processTimeoutId: number,
        hlToolbarTimeoutId: number,
    };
    sv?: {
        element: HTMLTextAreaElement,
        processTimeoutId: number,
        composingLock: boolean,
    };
}

interface ICommentsData {
    id: string;
    top: number;
}
