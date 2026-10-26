// The menu bar. Items that are Magpie's own send their id to the window as a
// "menu" event (ui/src/shell.ts onMenu), and the window runs the same action
// its keyboard shortcut does. Help items open web pages from here.

use tauri::{
    menu::{AboutMetadataBuilder, Menu, MenuEvent, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Runtime,
};

const REPO: &str = "https://github.com/gregorymfoster/magpie";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, text);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };

    let about = AboutMetadataBuilder::new()
        .name(Some("Magpie"))
        .version(Some(app.package_info().version.to_string()))
        .copyright(Some("MIT License"))
        .website(Some("https://magpie.gmfoster.com"))
        .build();

    let magpie = SubmenuBuilder::new(app, "Magpie")
        .about(Some(about))
        .item(&item("updates", "Check for Updates…", None)?)
        .separator()
        .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("add", "Add Books…", Some("CmdOrCtrl+O"))?)
        .item(&item("calibre", "Bring in Calibre Library…", None)?)
        .separator()
        .close_window()
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item("undo", "Undo", Some("CmdOrCtrl+Z"))?)
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .item(&item("selectAll", "Select All", Some("CmdOrCtrl+A"))?)
        .separator()
        .item(&item("find", "Find…", Some("CmdOrCtrl+K"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("grid", "as Covers", Some("CmdOrCtrl+1"))?)
        .item(&item("list", "as List", Some("CmdOrCtrl+2"))?)
        .separator()
        .item(&item("review", "Review Suggested Details…", None)?)
        .separator()
        .fullscreen()
        .build()?;

    let book = SubmenuBuilder::new(app, "Book")
        .item(&item("edit", "Edit Details…", Some("CmdOrCtrl+I"))?)
        .item(&item("preview", "Preview on a Reader…", Some("CmdOrCtrl+Y"))?)
        .item(&item("send", "Send to Reader…", Some("CmdOrCtrl+Shift+S"))?)
        .separator()
        .item(&item("remove", "Move to Removed", Some("CmdOrCtrl+Backspace"))?)
        .item(&item("restore", "Restore", None)?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().separator().close_window().build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("help", "Magpie Help", None)?)
        .item(&item("ai", "Use Magpie with Claude…", None)?)
        .separator()
        .item(&item("diagnostics", "Copy Diagnostics", None)?)
        .item(&item("report", "Report a Problem…", None)?)
        .build()?;

    Menu::with_items(app, &[&magpie, &file, &edit, &view, &book, &window, &help])
}

pub fn handle<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    let page = match id {
        "help" => Some(format!("{REPO}#readme")),
        "ai" => Some(format!("{REPO}/blob/main/docs/ai.md")),
        "report" => Some(format!("{REPO}/issues/new")),
        _ => None,
    };
    match page {
        Some(url) => {
            let _ = crate::open(&url);
        }
        None => {
            let _ = app.emit("menu", id);
        }
    }
}
