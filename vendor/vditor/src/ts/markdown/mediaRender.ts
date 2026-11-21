const replaceMedia = (element: HTMLElement, tag: "video" | "audio", url: string) => {
    const media = element.ownerDocument.createElement(tag);
    media.setAttribute("controls", "controls");
    media.setAttribute("src", url);
    element.replaceWith(media);
};

export const mediaRender = (element: HTMLElement) => {
    if (!element) {
        return;
    }
    element.querySelectorAll("a").forEach((aElement) => {
        const url = aElement.getAttribute("href");
        if (!url) {
            return;
        }
        if (url.match(/^.+.(mp4|m4v|ogg|ogv|webm)$/)) {
            replaceMedia(aElement, "video", url);
        } else if (url.match(/^.+.(mp3|wav|flac)$/)) {
            replaceMedia(aElement, "audio", url);
        }
    });
};
