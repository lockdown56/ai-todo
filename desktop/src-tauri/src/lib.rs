#[cfg(desktop)]
mod tray;

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

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        use tray::{TrayState, get_tray_settings, set_tray_settings};

        builder = builder
            .manage(TrayState::new())
            .invoke_handler(tauri::generate_handler![get_tray_settings, set_tray_settings])
            .setup(|app| {
                tray::setup_tray(app)?;
                Ok(())
            })
            .on_window_event(|window, event| tray::handle_window_event(window, event));
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while building AI 清单")
        .run(|app, event| {
            #[cfg(desktop)]
            tray::handle_run_event(app, &event);
        });
}
