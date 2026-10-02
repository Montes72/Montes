// Montes runs without a console window: the character is the whole UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    montes_lib::run()
}
