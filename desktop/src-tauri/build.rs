fn main() {
    // Tauri's generated build script watches the config, but icon-only changes
    // must also invalidate the Windows resource embedded in the executable.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
