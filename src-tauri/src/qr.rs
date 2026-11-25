//! QR codes read from pictures: the vault's "QR from the clipboard" and the Clipboard tool's images. Pure Rust (rqrr), so the
//! same on every system.

/// The text of the first QR code found in a greyscale picture `w` x `h`, row by row; None without one.
pub(crate) fn decode(w: usize, h: usize, luma: &[u8]) -> Option<String> {
    if w == 0 || h == 0 || luma.len() < w * h {
        return None;
    }
    let mut prepared = rqrr::PreparedImage::prepare_from_greyscale(w, h, |x, y| luma[y * w + x]);
    prepared.detect_grids().into_iter().find_map(|grid| grid.decode().ok().map(|(_, text)| text))
}

/// The greyscale of an RGBA picture as it shows over white: a QR drawn on a transparent background is black on white then,
/// where reading its colour alone, with the transparent pixels black too, would find nothing.
pub(crate) fn luma_over_white(rgba: &[u8]) -> Vec<u8> {
    rgba.chunks_exact(4)
        .map(|p| {
            let c = |i: usize| over_white(p[i], p[3]) as u32;
            ((c(0) * 299 + c(1) * 587 + c(2) * 114) / 1000) as u8
        })
        .collect()
}

/// A colour channel `c` with opacity `a`, as it shows over white (the OCR reads pictures this way too, capture/find.rs).
pub(crate) fn over_white(c: u8, a: u8) -> u8 {
    ((c as u32 * a as u32 + 255 * (255 - a as u32)) / 255) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A QR code of `text`, 4 px a module with a 4-module quiet zone, black on `background` (RGBA).
    fn picture(text: &str, background: [u8; 4]) -> (usize, usize, Vec<u8>) {
        let qr = qrcodegen::QrCode::encode_text(text, qrcodegen::QrCodeEcc::Medium).unwrap();
        let (modules, scale, quiet) = (qr.size() as usize, 4, 4);
        let side = (modules + 2 * quiet) * scale;
        let mut rgba = Vec::with_capacity(side * side * 4);
        for y in 0..side {
            for x in 0..side {
                let (mx, my) = ((x / scale) as i32 - quiet as i32, (y / scale) as i32 - quiet as i32);
                rgba.extend(if qr.get_module(mx, my) { [0, 0, 0, 255] } else { background });
            }
        }
        (side, side, rgba)
    }

    #[test]
    fn a_qr_code_reads_back_on_white_and_on_a_transparent_background() {
        let link = "https://example.com/menu?table=12";
        let (w, h, white) = picture(link, [255, 255, 255, 255]);
        assert_eq!(decode(w, h, &luma_over_white(&white)).as_deref(), Some(link));
        let (w, h, clear) = picture(link, [0, 0, 0, 0]);
        assert_eq!(decode(w, h, &luma_over_white(&clear)).as_deref(), Some(link));
        // Its colour alone, as the vault read it: every pixel black, no code.
        let plain: Vec<u8> = clear.chunks_exact(4).map(|p| ((p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000) as u8).collect();
        assert_eq!(decode(w, h, &plain), None);
    }

    #[test]
    fn a_picture_without_a_code_gives_none() {
        let grey = vec![128u8; 64 * 48];
        assert_eq!(decode(64, 48, &grey), None);
        assert_eq!(decode(0, 0, &[]), None);
    }

    #[test]
    fn transparency_shows_the_white_under_it() {
        assert_eq!(luma_over_white(&[0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 128]), [255, 0, 255, 127]);
        // Pure red, green and blue keep their usual weights.
        assert_eq!(luma_over_white(&[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), [76, 149, 29]);
    }
}
