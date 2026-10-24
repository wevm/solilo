include!(concat!(env!("OUT_DIR"), "/interfaces.rs"));

fn main() {
    println!(
        "{}",
        serde_json::json!({
            "ITIP20": ITIP20::abi::contract(),
            "IRolesAuth": IRolesAuth::abi::contract(),
        })
    );
}
