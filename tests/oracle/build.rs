fn main() {
    let file = "../../examples/tip20.rs";
    println!("cargo:rerun-if-changed={file}");
    let input = std::fs::read_to_string(file).unwrap();
    let parsed = syn::parse_file(&input).unwrap();
    let mut output = String::new();
    for item in parsed.items {
        if let syn::Item::Macro(item) = item
            && item.mac.path.segments.last().unwrap().ident == "sol"
        {
            // Independent oracle: original Alloy tokens, no solilo normalization.
            let tokens = item.mac.tokens;
            output.push_str(&quote::quote! { alloy_sol_types::sol! { #tokens } }.to_string());
        }
    }
    std::fs::write(
        std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("interfaces.rs"),
        output,
    )
    .unwrap();
}
