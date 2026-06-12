#[cfg(target_os = "linux")]
fn configure_wsl_input_method() {
    use std::{
        env,
        process::{Command, Stdio},
    };

    if env::var_os("WSL_DISTRO_NAME").is_none() {
        return;
    }

    for (key, value) in [
        ("GTK_IM_MODULE", "fcitx"),
        ("QT_IM_MODULE", "fcitx"),
        ("XMODIFIERS", "@im=fcitx"),
    ] {
        if env::var_os(key).is_none() {
            env::set_var(key, value);
        }
    }

    let fcitx_running = Command::new("fcitx5-remote")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());

    if !fcitx_running {
        let _ = Command::new("fcitx5")
            .arg("-d")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    configure_wsl_input_method();

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running AI 清单");
}
