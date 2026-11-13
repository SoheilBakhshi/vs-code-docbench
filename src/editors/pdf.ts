import * as vscode from 'vscode';
import { CspExtras } from '../common/webview';
import { BinaryReadonlyEditorProvider } from './base';

const VIEW_TYPE = 'docbench.pdf';

/** Read-only PDF viewer (pdf.js legacy build, rendered in the webview). */
class PdfEditorProvider extends BinaryReadonlyEditorProvider {
  constructor(context: vscode.ExtensionContext) {
    super(context, 'pdf', 'PDF Viewer');
  }

  // pdf.js decodes JPEG2000/JBIG2 with WebAssembly inside the worker (which inherits this CSP).
  protected override csp(): CspExtras {
    return { wasm: true };
  }

  protected override shellExtras(webview: vscode.Webview): { bodyData: Record<string, string> } {
    const uri = (...parts: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'pdf', ...parts)).toString();
    return {
      bodyData: {
        // The webview fetches the worker and starts it from a Blob URL (cross-origin workers are not allowed).
        'worker-src': uri('pdf.worker.min.mjs'),
        // Trailing slashes are required by pdf.js.
        'cmap-url': uri('cmaps') + '/',
        'font-url': uri('standard_fonts') + '/',
        // Optional assets (JPX/JBIG2 images, ICC profiles); only used if media/pdf contains them.
        'wasm-url': uri('wasm') + '/',
        'icc-url': uri('iccs') + '/',
      },
    };
  }
}

export function registerPdf(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.window.registerCustomEditorProvider(VIEW_TYPE, new PdfEditorProvider(context), {
    supportsMultipleEditorsPerDocument: true,
    webviewOptions: { retainContextWhenHidden: false },
  });
}
