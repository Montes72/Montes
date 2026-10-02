fn main() {
    tauri_build::build();

    // `tauri build` always runs the front end first, but a bare `cargo build`
    // does not, and without this it will happily relink a binary that still
    // carries the previous island. tauri-build watches the dist directory, but a
    // watched directory is not watched recursively, so the files inside it have
    // to be listed one by one.
    println!("cargo:rerun-if-changed=../dist");
    let mut files = Vec::new();
    collect(Path::new("../dist"), &mut files);
    for file in files {
        println!("cargo:rerun-if-changed={}", file.display());
    }
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, out);
        } else {
            out.push(path);
        }
    }
}

use std::path::{Path, PathBuf};