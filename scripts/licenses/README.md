# Licence texts kept for THIRD-PARTY-NOTICES.md

Licences of components that ship inside the Vditor fork (`vendor/vditor/dist/js`) but are not npm
dependencies of Docbench, so `scripts/generate-notices.mjs` cannot read them from `node_modules`.
Each file is copied unchanged from the package named below (npm registry tarball).

| File | Component shipped | Copied from |
|---|---|---|
| lute-LICENSE.txt | Lute Markdown engine, `js/lute/lute.min.js` | https://github.com/88250/lute (LICENSE, Mulan PSL v2, Chinese and English) |
| mermaid-LICENSE.txt | Mermaid 11.17.2, `js/mermaid/mermaid.min.js` | `mermaid@11.17.2` LICENSE |
| katex-LICENSE.txt | KaTeX 0.16.9 with mhchem and fonts, `js/katex/` | `katex@0.16.9` LICENSE |
| ant-design-icons-LICENSE.txt | Ant Design based icon set, `js/icons/ant.js` | `@ant-design/icons@6.3.4` LICENSE (same copyright holder as the icon artwork) |

highlight.js (`js/highlight.js/`) ships its own LICENSE in the fork.
