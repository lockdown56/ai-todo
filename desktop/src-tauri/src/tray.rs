use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, State, Window, WindowEvent,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraySettings {
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    #[serde(default = "default_true")]
    pub minimize_to_tray: bool,
}

fn default_true() -> bool {
    true
}

pub struct TrayState {
    settings: Mutex<TraySettings>,
    exiting: AtomicBool,
}

impl TrayState {
    pub fn new() -> Self {
        Self {
            settings: Mutex::new(TraySettings::default()),
            exiting: AtomicBool::new(false),
        }
    }
}

#[tauri::command]
pub fn get_tray_settings(state: State<TrayState>) -> TraySettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_tray_settings(state: State<TrayState>, settings: TraySettings) {
    *state.settings.lock().unwrap() = settings;
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn setup_tray(app: &mut App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("missing default window icon for tray");

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .tooltip("AI 清单")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                app.state::<TrayState>()
                    .exiting
                    .store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    let settings = window.state::<TrayState>().settings.lock().unwrap().clone();

    match event {
        WindowEvent::CloseRequested { api, .. } => {
            if settings.close_to_tray {
                api.prevent_close();
                let _ = window.hide();
            }
        }
        WindowEvent::Resized { .. } => {
            if settings.minimize_to_tray && window.is_minimized().unwrap_or(false) {
                let _ = window.hide();
            }
        }
        _ => {}
    }
}

pub fn handle_run_event(app: &AppHandle, event: &tauri::RunEvent) {
    if let tauri::RunEvent::ExitRequested { api, .. } = event {
        let tray_state = app.state::<TrayState>();
        let close_to_tray = tray_state.settings.lock().unwrap().close_to_tray;
        let exiting = tray_state.exiting.load(Ordering::SeqCst);
        if close_to_tray && !exiting {
            api.prevent_exit();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
    }
}
