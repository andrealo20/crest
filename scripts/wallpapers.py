# The Wallpapers tool's pictures, from the originals (kept outside the repository) to what Crest ships and downloads.
# Run by hand from the repository root when the collection changes, with Pillow installed:
#   python -I scripts/wallpapers.py <originals folder> <output folder>
# It writes the full-size pictures and manifest.json (name, bytes, SHA-256 of each) to the output folder, ready to upload to
# the `wallpapers-1` prerelease, and the 320 x 180 thumbnails to src/assets/wallpapers. Then copy each hash into PICTURES in
# src-tauri/src/wallpaper.rs and each size into COLLECTION in src/features/wallpapers/collection.ts.
#
# Every picture starts from its raw pixels; the EXIF orientation is ignored, and the four portrait shots turn as ROTATE says.
# Nothing of the originals' metadata (EXIF, ICC, XMP) is written. The full size covers 3840 x 2160 without ever enlarging.
import hashlib
import io
import json
import os
import sys

from PIL import Image, ImageOps

ROTATE = {
    "alexander-lunyov-Qx6dv2tcceU": Image.Transpose.ROTATE_90,  # left
    "andrei-castanha-qTZr2TEUNBo": Image.Transpose.ROTATE_90,  # left
    "johny-goerend-Oz2ZQ2j8We8": Image.Transpose.ROTATE_90,  # left
    "dim-gunger-Am9Se-CMNvM": Image.Transpose.ROTATE_270,  # right
}
SCREEN = (3840, 2160)
THUMB = (320, 180)


def picture_id(name):
    stem = name[: -len(".jpg")]
    return stem[: -len("-unsplash")] if stem.endswith("-unsplash") else stem


def jpeg(image, quality):
    image = image.convert("RGB")
    image.info = {}
    out = io.BytesIO()
    image.save(out, "JPEG", quality=quality, optimize=True)
    return out.getvalue()


def main(originals, output):
    thumbs = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets", "wallpapers")
    os.makedirs(output, exist_ok=True)
    os.makedirs(thumbs, exist_ok=True)
    manifest = []
    for name in sorted(n for n in os.listdir(originals) if n.lower().endswith(".jpg")):
        pid = picture_id(name)
        with Image.open(os.path.join(originals, name)) as raw:
            image = raw.transpose(ROTATE[pid]) if pid in ROTATE else raw.copy()
        w, h = image.size
        if w < h:
            sys.exit(f"{pid} is still upright: add it to ROTATE")
        scale = min(1.0, max(SCREEN[0] / w, SCREEN[1] / h))
        if scale < 1:
            image = image.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
        full = jpeg(image, 85)
        with open(os.path.join(output, f"{pid}.jpg"), "wb") as f:
            f.write(full)
        with open(os.path.join(thumbs, f"{pid}.jpg"), "wb") as f:
            f.write(jpeg(ImageOps.fit(image, THUMB, Image.Resampling.LANCZOS), 80))
        manifest.append({"name": f"{pid}.jpg", "bytes": len(full), "sha256": hashlib.sha256(full).hexdigest(), "width": image.width, "height": image.height})
        print(f"{pid}: {image.width} x {image.height}, {len(full)} bytes")
    with open(os.path.join(output, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")
    print(f"{len(manifest)} pictures, {sum(m['bytes'] for m in manifest)} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python -I scripts/wallpapers.py <originals folder> <output folder>")
    main(sys.argv[1], sys.argv[2])
