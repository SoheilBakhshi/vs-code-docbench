import {
    getTopList,
    hasClosestBlock, hasClosestByAttribute, hasTopClosestByTag,
} from "../util/hasClosest";
import {hasClosestByTag} from "../util/hasClosestByHeadings";
import {log} from "../util/log";
import {processCodeRender} from "../util/processCode";
import {setRangeByWbr} from "../util/selection";
import {renderToc} from "../util/toc";
import {afterRenderEvent} from "./afterRenderEvent";
import {previoueIsEmptyA} from "./inlineTag";

export const input = (vditor: IVditor, range: Range, event?: InputEvent) => {
    let blockElement = hasClosestBlock(range.startContainer);

    if (!blockElement) {
        blockElement = vditor.wysiwyg.element;
    }

    if (event && event.inputType !== "formatItalic"
        && event.inputType !== "deleteByDrag"
        && event.inputType !== "insertFromDrop"
        && event.inputType !== "formatBold"
        && event.inputType !== "formatRemove"
        && event.inputType !== "formatStrikeThrough"
        && event.inputType !== "insertUnorderedList"
        && event.inputType !== "insertOrderedList"
        && event.inputType !== "formatOutdent"
        && event.inputType !== "formatIndent"
        && event.inputType !== ""   // document.execCommand('unlink', false)
        || !event
    ) {
        const previousAEmptyElement = previoueIsEmptyA(range.startContainer);
        if (previousAEmptyElement) {
            previousAEmptyElement.remove();
        }

        vditor.wysiwyg.element.querySelectorAll("wbr").forEach((wbr) => {
            wbr.remove();
        });
        range.insertNode(document.createElement("wbr"));

        blockElement.querySelectorAll("[style]").forEach((item) => {
            item.removeAttribute("style");
        });

        blockElement.querySelectorAll(".vditor-comment").forEach((item) => {
            if (item.textContent.trim() === "") {
                item.classList.remove("vditor-comment", "vditor-comment--focus");
                item.removeAttribute("data-cmtids");
            }
        });
        blockElement.previousElementSibling?.querySelectorAll(".vditor-comment").forEach((item) => {
            if (item.textContent.trim() === "") {
                item.classList.remove("vditor-comment", "vditor-comment--focus");
                item.removeAttribute("data-cmtids");
            }
        });

        let html = "";
        if (blockElement.getAttribute("data-type") === "link-ref-defs-block") {
            blockElement = vditor.wysiwyg.element;
        }

        const isWYSIWYGElement = blockElement.isEqualNode(vditor.wysiwyg.element);
        const footnoteElement = hasClosestByAttribute(blockElement, "data-type", "footnotes-block");
        const calloutElement = hasClosestByAttribute(range.startContainer, "data-type", "callout");

        if (!isWYSIWYGElement) {
            const topListElement = getTopList(range.startContainer);
            if (topListElement && !footnoteElement) {
                const blockquoteElement = hasClosestByTag(range.startContainer, "BLOCKQUOTE");
                if (blockquoteElement) {
                    blockElement = hasClosestBlock(range.startContainer) || blockElement;
                } else {
                    blockElement = topListElement;
                }
            }

            if (footnoteElement) {
                blockElement = footnoteElement;
            }

            if (calloutElement) {
                blockElement = calloutElement;
            }

            html = blockElement.outerHTML;

            if (blockElement.tagName === "UL" || blockElement.tagName === "OL") {
                const listPrevElement = blockElement.previousElementSibling;
                const listNextElement = blockElement.nextElementSibling;
                if (listPrevElement && (listPrevElement.tagName === "UL" || listPrevElement.tagName === "OL")) {
                    html = listPrevElement.outerHTML + html;
                    listPrevElement.remove();
                }
                if (listNextElement && (listNextElement.tagName === "UL" || listNextElement.tagName === "OL")) {
                    html = html + listNextElement.outerHTML;
                    listNextElement.remove();
                }
                html = html.replace("<div><wbr><br></div>", "<li><p><wbr><br></p></li>");
            }

            if (!blockElement.innerText.startsWith("```")) {
                vditor.wysiwyg.element.querySelectorAll("[data-type='link-ref-defs-block']").forEach((item) => {
                    if (item && !(blockElement as HTMLElement).isEqualNode(item)) {
                        html += item.outerHTML;
                        item.remove();
                    }
                });

                vditor.wysiwyg.element.querySelectorAll("[data-type='footnotes-block']").forEach((item) => {
                    if (item && !(blockElement as HTMLElement).isEqualNode(item)) {
                        html += item.outerHTML;
                        item.remove();
                    }
                });
            }
        } else {
            html = blockElement.innerHTML;
        }

        html = html.replace(/<\/(strong|b)><strong data-marker="\W{2}">/g, "")
            .replace(/<\/(em|i)><em data-marker="\W{1}">/g, "")
            .replace(/<\/(s|strike)><s data-marker="~{1,2}">/g, "");

        if (html === '<p data-block="0">```<wbr></p>' && vditor.hint.recentLanguage) {
            html = '<p data-block="0">```<wbr></p>'.replace("```", "```" + vditor.hint.recentLanguage);
        }

        log("SpinVditorDOM", html, "argument", vditor.options.debugger);
        html = vditor.lute.SpinVditorDOM(html);
        log("SpinVditorDOM", html, "result", vditor.options.debugger);

        if (isWYSIWYGElement) {
            blockElement.innerHTML = html;
        } else {
            blockElement.outerHTML = html;

            if (footnoteElement) {
                const footnoteItemElement = hasTopClosestByTag(vditor.wysiwyg.element.querySelector("wbr"), "LI");
                if (footnoteItemElement) {
                    const footnoteRefElement = vditor.wysiwyg.element.querySelector(`sup[data-type="footnotes-ref"][data-footnotes-label="${footnoteItemElement.getAttribute("data-marker")}"]`);
                    if (footnoteRefElement) {
                        footnoteRefElement.setAttribute("aria-label",
                            footnoteItemElement.textContent.trim().substr(0, 24));
                    }
                }
            }
        }

        let firstLinkRefDefElement: Element;
        const allLinkRefDefsElement = vditor.wysiwyg.element.querySelectorAll("[data-type='link-ref-defs-block']");
        allLinkRefDefsElement.forEach((item, index) => {
            if (index === 0) {
                firstLinkRefDefElement = item;
            } else {
                firstLinkRefDefElement.insertAdjacentHTML("beforeend", item.innerHTML);
                item.remove();
            }
        });
        if (allLinkRefDefsElement.length > 0) {
            vditor.wysiwyg.element.insertAdjacentElement("beforeend", allLinkRefDefsElement[0]);
        }

        let firstFootnoteElement: Element;
        const allFootnoteElement = vditor.wysiwyg.element.querySelectorAll("[data-type='footnotes-block']");
        allFootnoteElement.forEach((item, index) => {
            if (index === 0) {
                firstFootnoteElement = item;
            } else {
                firstFootnoteElement.insertAdjacentHTML("beforeend", item.innerHTML);
                item.remove();
            }
        });
        if (allFootnoteElement.length > 0) {
            vditor.wysiwyg.element.insertAdjacentElement("beforeend", allFootnoteElement[0]);
        }

        setRangeByWbr(vditor.wysiwyg.element, range);

        vditor.wysiwyg.element.querySelectorAll(".vditor-wysiwyg__preview[data-render='2']")
            .forEach((item: HTMLElement) => {
                processCodeRender(item, vditor);
            });

        if (event && (event.inputType === "deleteContentBackward" || event.inputType === "deleteContentForward") &&
            vditor.options.comment.enable) {
            vditor.wysiwyg.triggerRemoveComment(vditor);
            vditor.options.comment.adjustTop(vditor.wysiwyg.getComments(vditor, true));
        }
    }
    renderToc(vditor);
    afterRenderEvent(vditor, {
        enableAddUndoStack: true,
        enableHint: true,
        enableInput: true,
    });
};
