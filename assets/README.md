# Logo and brand assets

| File | Use |
|---|---|
| `logo.svg` | Master artwork (256 × 256, scalable). Edit this one. |
| `icon.png` | 256 × 256 PNG with transparent corners; referenced by `package.json` as the extension icon (the Marketplace needs PNG). |
| `social-preview.png` | 1280 × 640 banner for the GitHub repository's social preview. |

## The design

A stack of translucent glass pages on a deep indigo-to-cyan tile: the pink and blue pages behind are the other formats, and the crisp front page carries a heading pill, text lines and a four-colour bar for the types Docbench opens: PDF (red), Word (blue), Excel (green) and Markdown (violet). Soft pink and cyan glows, a subtle top sheen and a glass rim give it depth. The shapes stay legible down to 16 x 16 px.

| Role | Colour |
|---|---|
| Tile gradient | `#1A1763` to `#4527C9` to `#0A8FD6` |
| Glows | pink `#FF3FBF` (top left), cyan `#22E5F2` (bottom right) |
| Heading pill | `#22D3EE` to `#8B5CF6` |
| PDF / Word / Excel / Markdown bar | `#FF4D6D` / `#3B82F6` / `#10C98F` / `#9B6BFF` |

## Regenerating the PNGs

With Chrome or Edge installed, from the repository root (Windows paths shown; adjust for your system):

```bash
# icon.png: render logo.svg at 256x256 on a transparent background
chrome --headless --default-background-color=00000000 --window-size=256,256 --screenshot=assets/icon.png <html page containing <img src="assets/logo.svg" width=256>>
```

`social-preview.png` is the logo plus the name and tagline on a dark gradient, rendered the same way at 1280 × 640.
