// Capturing a window the user drags onto the island.
//
// Why PrintWindow and not a screen grab: grabbing the window's rectangle off the
// screen also catches whatever is painted on top of it — including the island the
// pointer is dragging it over, which is the one thing guaranteed to be there.
// PrintWindow asks the window to redraw itself into a DC we own, so the shot is
// the window alone even while it is half covered. That matters because a window
// being dragged is by definition never the topmost window.
//
// PW_RENDERFULLCONTENT is the flag that makes GPU-composited windows (Chrome,
// Edge, anything with a DirectComposition surface) paint at all. Without it
// PrintWindow hands back an empty DC for them and the shot is black.
//
// The result is scaled down with StretchBlt rather than handed over at full size:
// a 4K window is 33 MB of pixels, and the island card is 526 CSS px wide.

use serde::Serialize;
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::*;

/// The island's card is ~526 CSS px wide; capture a little above that so the
/// picture still looks sharp on a 2x display, but never more than this.
const MAX_W: i32 = 1040;
const MAX_H: i32 = 640;

/// `PrintWindow` into whatever the window draws without asking DWM for the
/// DirectComposition surface.
const PW_DEFAULT: PRINT_WINDOW_FLAGS = PRINT_WINDOW_FLAGS(0);
/// `PW_RENDERFULLCONTENT`: makes GPU-composited windows paint at all.
const PW_RENDERFULL_CONTENT: PRINT_WINDOW_FLAGS = PRINT_WINDOW_FLAGS(2);

/// What the island gets back: the window's title (the only "URL" we ever show — a
/// browser tab's title says which tab was grabbed, and reading the real URL needs
/// UI Automation) plus the picture itself.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WindowShot {
    pub title: String,
    pub class: String,
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// The top-level window at `(x, y)`, **but only if the point landed on its
/// caption** — its title bar.
///
/// This is how a window drag is told apart from everything else that can happen
/// under a held mouse button. A window is moved by its title bar; Windows never
/// starts moving one from the client area (except with Alt held, which we ignore
/// on purpose). So a caption hit means "a window may be being dragged", while a
/// client hit is a click, a text selection, or a file coming out of Explorer —
/// and all three of those belong to the island's ordinary drop handling.
///
/// The question is put to the window with `WM_NCHITTEST`, the same hit-test the
/// system runs to decide what the cursor should look like, so a window with a
/// custom frame, a reparented toolbar or an extended title bar answers correctly
/// where geometry alone would guess wrong.
///
/// The send is bounded: `SMTO_ABORTIFHUNG` gives up on a window that has stopped
/// pumping messages instead of parking our poll thread forever.
pub fn caption_window_at(x: i32, y: i32) -> Option<(isize, String, String)> {
    let root = root_at(x, y)?;
    let mut hit: usize = 0;
    // Safe: the hwnd was just resolved to a live top-level window, and the
    // timeout bounds how long a hung one can hold us.
    let sent = unsafe {
        SendMessageTimeoutW(
            root,
            WM_NCHITTEST,
            WPARAM(0),
            lparam_from_point(x, y),
            SMTO_ABORTIFHUNG,
            100,
            Some(&mut hit),
        )
    };
    // The return value is a byte count; zero means the window hung or declined.
    if sent.0 == 0 || hit != HTCAPTION as usize {
        return None;
    }
    Some((root.0 as isize, window_title(root), window_class(root)))
}

/// `MAKELPARAM` for a screen point, which `windows-rs` does not hand us.
///
/// The two halves are written as *unsigned* 16-bit words: Windows reads them back
/// as signed shorts, so a pointer on a monitor to the left of the primary one
/// survives the round trip instead of arriving as a huge positive number.
fn lparam_from_point(x: i32, y: i32) -> LPARAM {
    let packed = ((y as i16 as u16 as u32) << 16) | (x as i16 as u16 as u32);
    LPARAM(packed as isize)
}

/// The visible top-level window at `(x, y)`, already climbed past child controls,
/// minus the ones that can never be the target: our own island (which sits right
/// where the drop happens) and anything too small to look at.
fn root_at(x: i32, y: i32) -> Option<HWND> {
    let hit = unsafe { WindowFromPoint(POINT { x, y }) };
    if hit.0.is_null() {
        return None;
    }
    let root = unsafe { GetAncestor(hit, GA_ROOT) };
    if root.0.is_null() || !plausible_target(root) {
        return None;
    }
    Some(root)
}

fn plausible_target(hwnd: HWND) -> bool {
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return false;
    }
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == std::process::id() {
        return false;
    }
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok()
        && rect.right - rect.left >= 32
        && rect.bottom - rect.top >= 32
}

pub fn window_title(hwnd: HWND) -> String {
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return String::new();
    }
    let mut buf = vec![0u16; len as usize + 1];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    buf.truncate(n.max(0) as usize);
    String::from_utf16_lossy(&buf)
}

fn window_class(hwnd: HWND) -> String {
    let mut buf = vec![0u16; 256];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    buf.truncate(n.max(0) as usize);
    String::from_utf16_lossy(&buf)
}

/// Off-screen 32-bit top-down DIB plus the DC that selects it.
///
/// Top-down (`biHeight` negative) so the pixels arrive in the order we hand them
/// over — a bottom-up DIB would have to be flipped row by row.
struct Canvas {
    dc: HDC,
    bmp: HBITMAP,
    bits: *mut u8,
    prev: HGDIOBJ,
    w: i32,
    h: i32,
}

impl Canvas {
    fn new(w: i32, h: i32) -> Option<Self> {
        unsafe {
            let dc = CreateCompatibleDC(None);
            if dc.is_invalid() {
                return None;
            }
            let mut bmi = BITMAPINFO::default();
            bmi.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = w;
            bmi.bmiHeader.biHeight = -h; // top-down
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB.0;

            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let Ok(bmp) = CreateDIBSection(Some(dc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0) else {
                let _ = DeleteDC(dc);
                return None;
            };
            if bits.is_null() {
                let _ = DeleteObject(HGDIOBJ(bmp.0));
                let _ = DeleteDC(dc);
                return None;
            }
            let prev = SelectObject(dc, HGDIOBJ(bmp.0));
            Some(Canvas { dc, bmp, bits: bits as *mut u8, prev, w, h })
        }
    }

    fn pixels(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.bits, (self.w * self.h * 4) as usize) }
    }
}

impl Drop for Canvas {
    fn drop(&mut self) {
        unsafe {
            let _ = SelectObject(self.dc, self.prev);
            let _ = DeleteObject(HGDIOBJ(self.bmp.0));
            let _ = DeleteDC(self.dc);
        }
    }
}

/// Prints `hwnd` into a canvas of at most `MAX_W` x `MAX_H`, keeping the aspect.
pub fn capture(hwnd: isize) -> Result<WindowShot, String> {
    let hwnd = HWND(hwnd as *mut core::ffi::c_void);
    // The hwnd came from the press a moment ago; the window may have closed since,
    // and a stale one makes `PrintWindow` fail or, worse, draw somebody else's.
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return Err("that window has closed".into());
    }
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|e| format!("no window rect: {e}"))?;
    let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
    if w < 8 || h < 8 {
        return Err("that window is too small to look at".into());
    }

    let full = Canvas::new(w, h).ok_or("cannot allocate a bitmap")?;

    // PW_RENDERFULLCONTENT is what DWM-composited windows need; flag 0 is the
    // fallback for the odd GDI window that refuses the render flag but paints.
    let printed = unsafe { PrintWindow(hwnd, full.dc, PW_RENDERFULL_CONTENT) }.as_bool()
        || unsafe { PrintWindow(hwnd, full.dc, PW_DEFAULT) }.as_bool();
    if !printed {
        return Err("that window refused to be drawn".into());
    }

    let (tw, th) = fit(w, h, MAX_W, MAX_H);
    let shot = if tw == w && th == h {
        to_rgba(full.pixels())
    } else {
        let small = Canvas::new(tw, th).ok_or("cannot allocate the scaled bitmap")?;
        unsafe {
            let _ = SetStretchBltMode(small.dc, HALFTONE);
            let _ = SetBrushOrgEx(small.dc, 0, 0, None);
        }
        let ok = unsafe {
            StretchBlt(small.dc, 0, 0, tw, th, Some(full.dc), 0, 0, w, h, SRCCOPY)
        };
        if !ok.as_bool() {
            return Err("cannot scale the bitmap".into());
        }
        to_rgba(small.pixels())
    };

    Ok(WindowShot {
        title: window_title(hwnd),
        class: window_class(hwnd),
        width: tw as u32,
        height: th as u32,
        pixels: shot,
    })
}

fn fit(w: i32, h: i32, max_w: i32, max_h: i32) -> (i32, i32) {
    if w <= max_w && h <= max_h {
        return (w, h);
    }
    let scale = (max_w as f64 / w as f64).min(max_h as f64 / h as f64);
    ((w as f64 * scale).round() as i32, (h as f64 * scale).round() as i32)
}

/// GDI hands back BGRX; the island's canvas wants RGBA.
///
/// The fourth byte is not an alpha channel — a 32-bit DIB from `CreateDIBSection`
/// leaves it undefined and in practice zero — and `putImageData` takes alpha
/// seriously, so handing it over as-is would draw a fully transparent picture.
/// It is forced opaque instead.
fn to_rgba(bgra: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bgra.len());
    for px in bgra.chunks_exact(4) {
        out.extend_from_slice(&[px[2], px[1], px[0], 255]);
    }
    out
}