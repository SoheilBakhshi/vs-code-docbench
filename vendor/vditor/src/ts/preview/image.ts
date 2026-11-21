export const previewImage = (oldImgElement: HTMLImageElement, lang: keyof II18n = "en_US", theme = "classic") => {
    const oldImgRect = oldImgElement.getBoundingClientRect();
    const height = 36;
    document.body.insertAdjacentHTML("beforeend", `<div class="vditor vditor-img${theme === "dark" ? " vditor--dark" : ""}">
    <div class="vditor-img__bar">
      <span class="vditor-img__btn" data-deg="0">
        <svg><use xlink:href="#vditor-icon-redo"></use></svg>
        ${window.VditorI18n.spin}
      </span>
      <span class="vditor-img__btn" data-type="close">
        X &nbsp;${window.VditorI18n.close}
      </span>
    </div>
    <div class="vditor-img__img">
      <img style="width: ${oldImgElement.width}px;height:${oldImgElement.height}px;transform: translate3d(${oldImgRect.left}px, ${oldImgRect.top - height}px, 0)" src="${oldImgElement.getAttribute("src")}">
    </div>
</div>`);
    document.body.style.overflow = "hidden";

    // Docbench: close through listeners instead of inline onclick attributes, which a nonce-only CSP blocks,
    // and also with Escape.
    const overlayElement = document.body.lastElementChild as HTMLElement;
    const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            event.stopPropagation();
            close();
        }
    };
    const close = () => {
        overlayElement.remove();
        document.body.style.overflow = "";
        document.removeEventListener("keydown", onKey, true);
    };
    document.addEventListener("keydown", onKey, true);
    overlayElement.querySelector('.vditor-img__btn[data-type="close"]').addEventListener("click", close);
    overlayElement.querySelector(".vditor-img__img").addEventListener("click", close);

    const imgElement = document.querySelector(".vditor-img img") as HTMLImageElement;
    const translate3d = `translate3d(${Math.max(0, window.innerWidth - oldImgElement.naturalWidth) / 2}px, ${Math.max(0, window.innerHeight - height - oldImgElement.naturalHeight) / 2}px, 0)`;
    setTimeout(() => {
        imgElement.setAttribute("style", `transition: transform .3s ease-in-out;transform: ${translate3d}`);
        setTimeout(() => {
            imgElement.parentElement.scrollTo(
                (imgElement.parentElement.scrollWidth - imgElement.parentElement.clientWidth) / 2,
                (imgElement.parentElement.scrollHeight - imgElement.parentElement.clientHeight) / 2);
        }, 400);
    });

    const btnElement = document.querySelector(".vditor-img__btn");
    btnElement.addEventListener("click", () => {
        const deg = parseInt(btnElement.getAttribute("data-deg"), 10) + 90;
        if ((deg / 90) % 2 === 1 && oldImgElement.naturalWidth > imgElement.parentElement.clientHeight) {
            imgElement.style.transform = `translate3d(${
                Math.max(0, window.innerWidth - oldImgElement.naturalWidth) / 2}px, ${
                oldImgElement.naturalWidth / 2 - oldImgElement.naturalHeight / 2}px, 0) rotateZ(${deg}deg)`;
        } else {
            imgElement.style.transform = `${translate3d} rotateZ(${deg}deg)`;
        }
        btnElement.setAttribute("data-deg", deg.toString());
        setTimeout(() => {
            imgElement.parentElement.scrollTo(
                (imgElement.parentElement.scrollWidth - imgElement.parentElement.clientWidth) / 2,
                (imgElement.parentElement.scrollHeight - imgElement.parentElement.clientHeight) / 2);
        }, 400);
    });
};
