import {abcRender} from "./ts/markdown/abcRender";
import * as adapterRender from "./ts/markdown/adapterRender";
import {chartRender} from "./ts/markdown/chartRender";
import {codeRender} from "./ts/markdown/codeRender";
import {flowchartRender} from "./ts/markdown/flowchartRender";
import {graphvizRender} from "./ts/markdown/graphvizRender";
import {highlightRender} from "./ts/markdown/highlightRender";
import {lazyLoadImageRender} from "./ts/markdown/lazyLoadImageRender";
import {mathRender} from "./ts/markdown/mathRender";
import {mediaRender} from "./ts/markdown/mediaRender";
import {mermaidRender} from "./ts/markdown/mermaidRender";
import {SMILESRender} from "./ts/markdown/SMILESRender";
import {markmapRender} from "./ts/markdown/markmapRender";
import {mindmapRender} from "./ts/markdown/mindmapRender";
import {outlineRender} from "./ts/markdown/outlineRender";
import {plantumlRender} from "./ts/markdown/plantumlRender";
import {wavedromRender} from "./ts/markdown/wavedromRender";
import {md2html, previewRender} from "./ts/markdown/previewRender";
import {speechRender} from "./ts/markdown/speechRender";
import {previewImage} from "./ts/preview/image";
import {setCodeTheme} from "./ts/ui/setCodeTheme";
import {setContentTheme} from "./ts/ui/setContentTheme";

class Vditor {

    public static adapterRender = adapterRender;
    public static previewImage = previewImage;
    public static codeRender = codeRender;
    public static graphvizRender = graphvizRender;
    public static wavedromRender = wavedromRender;
    public static highlightRender = highlightRender;
    public static mathRender = mathRender;
    public static mermaidRender = mermaidRender;
    public static SMILESRender = SMILESRender;
    public static markmapRender = markmapRender;
    public static flowchartRender = flowchartRender;
    public static chartRender = chartRender;
    public static abcRender = abcRender;
    public static mindmapRender = mindmapRender;
    public static plantumlRender = plantumlRender;
    public static outlineRender = outlineRender;
    public static mediaRender = mediaRender;
    public static speechRender = speechRender;
    public static lazyLoadImageRender = lazyLoadImageRender;
    public static md2html = md2html;
    public static preview = previewRender;
    public static setCodeTheme = setCodeTheme;
    public static setContentTheme = setContentTheme;
}

export default Vditor;
