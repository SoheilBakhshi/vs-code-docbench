import * as adapterRender from "./ts/markdown/adapterRender";
declare class Vditor {
    static adapterRender: typeof adapterRender;
    static previewImage: (oldImgElement: HTMLImageElement, lang?: keyof II18n, theme?: string) => void;
    static codeRender: (element: HTMLElement, option?: IHljs) => void;
    static graphvizRender: (element: HTMLElement, cdn?: string) => void;
    static wavedromRender: (element?: HTMLElement | Document, cdn?: string) => void;
    static highlightRender: (hljsOption?: IHljs, element?: HTMLElement | Document, cdn?: string) => void;
    static mathRender: (element?: HTMLElement | Document, options?: {
        cdn?: string;
        math?: IMath;
    }) => void;
    static mermaidRender: (element: HTMLElement | Document, cdn: string, theme: string) => void;
    static SMILESRender: (element: HTMLElement | Document, cdn: string, theme: string) => void;
    static markmapRender: (element?: HTMLElement | Document, cdn?: string) => void;
    static flowchartRender: (element: HTMLElement, cdn?: string) => void;
    static chartRender: (element: HTMLElement | Document, cdn: string, theme: string) => void;
    static abcRender: (element?: HTMLElement | Document, cdn?: string) => void;
    static mindmapRender: (element: HTMLElement | Document, cdn: string, theme: string) => void;
    static plantumlRender: (element?: HTMLElement | Document, cdn?: string) => void;
    static outlineRender: (contentElement: HTMLElement, targetElement: Element, vditor?: IVditor) => string;
    static mediaRender: (element: HTMLElement) => void;
    static speechRender: (element: HTMLElement, lang?: keyof II18n) => void;
    static lazyLoadImageRender: (element?: HTMLElement | Document) => boolean;
    static md2html: (mdText: string, options?: IPreviewOptions) => Promise<string>;
    static preview: (previewElement: HTMLDivElement, markdown: string, options?: IPreviewOptions) => Promise<void>;
    static setCodeTheme: (codeTheme: string, cdn?: string) => void;
    static setContentTheme: (contentTheme: string, path: string) => void;
}
export default Vditor;
