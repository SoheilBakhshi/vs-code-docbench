/// <reference types="./types" />
import VditorMethod from "./method";
declare class Vditor extends VditorMethod {
    readonly version: string;
    vditor: IVditor;
    private isDestroyed;
    constructor(id: string | HTMLElement, options?: IOptions);
    private showErrorTip;
    updateToolbarConfig(options: IToolbarConfig): void;
    setTheme(theme: "dark" | "classic", contentTheme?: string, codeTheme?: string, contentThemePath?: string): void;
    getValue(): string;
    getCurrentMode(): "sv" | "wysiwyg" | "ir";
    focus(): void;
    blur(): void;
    disabled(): void;
    enable(): void;
    getSelection(): string;
    renderPreview(value?: string): void;
    getCursorPosition(): {
        left: number;
        top: number;
    };
    isUploading(): boolean;
    clearCache(): void;
    disabledCache(): void;
    enableCache(): void;
    html2md(value: string): string;
    exportJSON(value: string): string;
    getHTML(): string;
    tip(text: string, time?: number): void;
    setPreviewMode(mode: "both" | "editor"): void;
    deleteValue(): void;
    updateValue(value: string): void;
    insertValue(value: string, render?: boolean): void;
    insertMD(md: string): void;
    setValue(markdown: string, clearStack?: boolean): void;
    insertEmptyBlock(position: InsertPosition): void;
    clearStack(): void;
    destroy(): void;
    getCommentIds(): ICommentsData[];
    hlCommentIds(ids: string[]): void;
    unHlCommentIds(ids: string[]): void;
    removeCommentIds(removeIds: string[]): void;
    private init;
}
export default Vditor;
