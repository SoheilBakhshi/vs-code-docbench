import {Constants} from "../constants";
import {hidePanel} from "../toolbar/setToolbar";
import {isCtrl} from "../util/compatibility";
import {
    fixBlockquote, fixCJKPosition,
    fixCodeBlock, fixCursorDownInlineMath,
    fixDelete, fixFirefoxArrowUpTable, fixGSKeyBackspace, fixHR,
    fixList,
    fixMarkdown,
    fixTab,
    fixTable,
    fixTask,
    insertAfterBlock, insertBeforeBlock, isFirstCell, isLastCell,
} from "../util/fixBrowserBehavior";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByMatchTag,
} from "../util/hasClosest";
import {hasClosestByHeadings} from "../util/hasClosestByHeadings";
import {matchHotKey} from "../util/hotKey";
import {getEditorRange, getSelectPosition, setSelectionFocus} from "../util/selection";
import {keydownToc} from "../util/toc";
import {expandMarker} from "./expandMarker";
import {processAfterRender, processHeading} from "./process";

export const processKeydown = (vditor: IVditor, event: KeyboardEvent) => {
    vditor.ir.composingLock = event.isComposing;
    if (event.isComposing) {
        return false;
    }

    if (event.key.indexOf("Arrow") === -1 && event.key !== "Meta" && event.key !== "Control" && event.key !== "Alt" &&
        event.key !== "Shift" && event.key !== "CapsLock" && event.key !== "Escape" && !/^F\d{1,2}$/.test(event.key)) {
        vditor.undo.recordFirstPosition(vditor, event);
    }

    const range = getEditorRange(vditor);
    const startContainer = range.startContainer;

    if (!fixGSKeyBackspace(event, vditor, startContainer)) {
        return false;
    }

    fixCJKPosition(range, vditor, event);

    fixHR(range);

    if (event.key !== "Enter" && event.key !== "Tab" && event.key !== "Backspace" && event.key.indexOf("Arrow") === -1
        && !isCtrl(event) && event.key !== "Escape" && event.key !== "Delete") {
        return false;
    }

    const newlineElement = hasClosestByAttribute(startContainer, "data-newline", "1");
    if (!isCtrl(event) && !event.altKey && !event.shiftKey && event.key === "Enter" && newlineElement
        && range.startOffset < newlineElement.textContent.length) {
        const beforeMarkerElement = newlineElement.previousElementSibling;
        if (beforeMarkerElement) {
            range.insertNode(document.createTextNode(beforeMarkerElement.textContent));
            range.collapse(false);
        }
        const afterMarkerElement = newlineElement.nextSibling;
        if (afterMarkerElement) {
            range.insertNode(document.createTextNode(afterMarkerElement.textContent));
            range.collapse(true);
        }
    }

    const pElement = hasClosestByMatchTag(startContainer, "P");
    if (fixMarkdown(event, vditor, pElement, range)) {
        return true;
    }
    // li
    if (fixList(range, vditor, pElement, event)) {
        return true;
    }
    // blockquote
    if (fixBlockquote(vditor, range, event, pElement)) {
        return true;
    }
    const preRenderElement = hasClosestByClassName(startContainer, "vditor-ir__marker--pre");
    if (preRenderElement && preRenderElement.tagName === "PRE") {
        const codeRenderElement = preRenderElement.firstChild as HTMLElement;
        if (fixCodeBlock(vditor, event, preRenderElement, range)) {
            return true;
        }
        if ((codeRenderElement.getAttribute("data-type") === "math-block"
                || codeRenderElement.getAttribute("data-type") === "html-block") &&
            insertBeforeBlock(vditor, event, range, codeRenderElement, preRenderElement.parentElement)) {
            return true;
        }

        if (insertAfterBlock(vditor, event, range, codeRenderElement, preRenderElement.parentElement)) {
            return true;
        }
    }
    const preBeforeElement = hasClosestByAttribute(startContainer, "data-type", "code-block-info");
    if (preBeforeElement) {
        if (event.key === "Enter" || event.key === "Tab") {
            range.selectNodeContents(preBeforeElement.nextElementSibling.firstChild);
            range.collapse(true);
            event.preventDefault();
            hidePanel(vditor, ["hint"]);
            return true;
        }

        if (event.key === "Backspace") {
            const start = getSelectPosition(preBeforeElement, vditor.ir.element).start;
            if (start === 1) {
                range.setStart(startContainer, 0);
            }
            if (start === 2) {
                vditor.hint.recentLanguage = "";
            }
        }
        if (insertBeforeBlock(vditor, event, range, preBeforeElement, preBeforeElement.parentElement)) {
            hidePanel(vditor, ["hint"]);
            return true;
        }
    }

    // table
    const cellElement = hasClosestByMatchTag(startContainer, "TD") ||
        hasClosestByMatchTag(startContainer, "TH");
    if (event.key.indexOf("Arrow") > -1 && cellElement) {
        const tableElement = isFirstCell(cellElement);
        if (tableElement && insertBeforeBlock(vditor, event, range, cellElement, tableElement)) {
            return true;
        }

        const table2Element = isLastCell(cellElement);
        if (table2Element && insertAfterBlock(vditor, event, range, cellElement, table2Element)) {
            return true;
        }
    }
    if (fixTable(vditor, event, range)) {
        return true;
    }

    // task list
    if (fixTask(vditor, range, event)) {
        return true;
    }

    // tab
    if (fixTab(vditor, range, event)) {
        return true;
    }

    const headingElement = hasClosestByHeadings(startContainer);
    if (headingElement) {
        if (matchHotKey("⌘=", event)) {
            const headingMarkerElement = headingElement.querySelector(".vditor-ir__marker--heading");
            if (headingMarkerElement && headingMarkerElement.textContent.trim().length > 1) {
                processHeading(vditor, headingMarkerElement.textContent.substr(1));
            }
            event.preventDefault();
            return true;
        }

        if (matchHotKey("⌘-", event)) {
            const headingMarkerElement = headingElement.querySelector(".vditor-ir__marker--heading");
            if (headingMarkerElement && headingMarkerElement.textContent.trim().length < 6) {
                processHeading(vditor, headingMarkerElement.textContent.trim() + "# ");
            }
            event.preventDefault();
            return true;
        }
    }
    const blockElement = hasClosestBlock(startContainer);
    if (event.key === "Backspace" && !isCtrl(event) && !event.shiftKey && !event.altKey && range.toString() === "") {
        if (fixDelete(vditor, range, event, pElement)) {
            return true;
        }

        if (blockElement && blockElement.previousElementSibling
            && blockElement.tagName !== "UL" && blockElement.tagName !== "OL"
            && (blockElement.previousElementSibling.getAttribute("data-type") === "code-block" ||
                blockElement.previousElementSibling.getAttribute("data-type") === "math-block")) {
            const rangeStart = getSelectPosition(blockElement, vditor.ir.element, range).start;
            if (rangeStart === 0 || (rangeStart === 1 && blockElement.innerText.startsWith(Constants.ZWSP))) {
                range.selectNodeContents(blockElement.previousElementSibling.querySelector(".vditor-ir__marker--pre code"));
                range.collapse(false);
                expandMarker(range, vditor);
                if (blockElement.textContent.trim().replace(Constants.ZWSP, "") === "") {
                    blockElement.remove();
                    processAfterRender(vditor);
                }
                event.preventDefault();
                return true;
            }
        }

        if (headingElement) {
            const headingLength = headingElement.firstElementChild.textContent.length;
            if (getSelectPosition(headingElement, vditor.ir.element).start === headingLength && headingLength !== 0) {
                range.setStart(headingElement.firstElementChild.firstChild, headingLength - 1);
                range.collapse(true);
                setSelectionFocus(range);
            }
        }
    }

    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && blockElement) {
        // https://github.com/Vanessa219/vditor/issues/358
        blockElement.querySelectorAll(".vditor-ir__node").forEach((item: HTMLElement) => {
            if (!item.contains(startContainer)) {
                item.classList.add("vditor-ir__node--hidden");
            }
        });

        if (fixFirefoxArrowUpTable(event, blockElement, range)) {
            return true;
        }
    }
    fixCursorDownInlineMath(range, event.key);

    if (blockElement && keydownToc(blockElement, vditor, event, range)) {
        event.preventDefault();
        return true;
    }
    return false;
};
