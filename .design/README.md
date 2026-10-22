# CQU Moe Design 1.2.0

Theme comes from the official [v1.2.0 release](https://github.com/cqu-moe/design/releases/tag/v1.2.0).
The downloaded `SHA256SUMS` is retained unchanged; this native HTML/CSS project uses only the theme tarball.

`cqu-moe-theme-1.2.0.tgz` SHA-256: `3e0f6806acfc479f91a6821145921987aa7f9990e398b663736ee0af53110aeb`.

Brand assets in `website/public/brand/`, `public/brand/`, and `public/icons/` were synced and checked with `scripts/brand.mjs` from the design `v1.2.0` tag. The canonical source is `assets/brand/path-family/quicklogin/` in that tag.

The website and extension import the packaged shared CSS. `website/popup-preview.html` compiles the real popup stylesheet, so the preview does not maintain a separate palette or CSS copy.
