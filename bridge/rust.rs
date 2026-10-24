//! Discover literal macro items with Rust's parser; never expand or stringify their bodies.
use proc_macro2::{Delimiter, TokenStream, TokenTree};
use std::ops::Range;
use syn::{spanned::Spanned, visit::Visit};

pub fn interfaces(source: &str) -> Result<Vec<String>, (Range<usize>, String)> {
    let file = syn::parse_file(source).map_err(|e| (e.span().byte_range(), e.to_string()))?;
    let mut visitor = Macros {
        source,
        outputs: Vec::new(),
        error: None,
        conditional: file.attrs.iter().any(unsupported_outer_attribute),
    };
    visitor.visit_file(&file);
    if let Some(error) = visitor.error {
        return Err(error);
    }
    if visitor.outputs.is_empty() {
        return Err((0..0, "No supported literal sol! interface found".into()));
    }
    Ok(visitor.outputs)
}

struct Macros<'a> {
    source: &'a str,
    outputs: Vec<String>,
    error: Option<(Range<usize>, String)>,
    conditional: bool,
}

impl<'ast> Visit<'ast> for Macros<'_> {
    fn visit_item_mod(&mut self, item: &'ast syn::ItemMod) {
        let previous = self.conditional;
        self.conditional |= item.attrs.iter().any(unsupported_outer_attribute);
        syn::visit::visit_item_mod(self, item);
        self.conditional = previous;
    }

    fn visit_item_macro(&mut self, item: &'ast syn::ItemMacro) {
        if item.mac.path.is_ident("macro_rules") && item.ident.as_ref().is_some_and(|i| i == "sol")
        {
            self.error = Some((
                item.span().byte_range(),
                "A locally redefined sol! macro is unsupported".into(),
            ));
            return;
        }
        let path: Vec<_> = item
            .mac
            .path
            .segments
            .iter()
            .map(|s| s.ident.to_string())
            .collect();
        if path.last().map(String::as_str) != Some("sol") {
            return;
        }
        let result = (|| {
            if self.conditional || item.attrs.iter().any(unsupported_outer_attribute) {
                return Err("Conditional or attributed sol! interfaces require unsupported Cargo/macro evaluation".into());
            }
            if !matches!(
                path.iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>()
                    .as_slice(),
                ["sol"] | ["crate", "sol"] | ["alloy_sol_types", "sol"]
            ) {
                return Err("Unsupported sol! macro path".into());
            }
            let tokens: Vec<_> = item.mac.tokens.clone().into_iter().collect();
            if tokens.is_empty() {
                return Err("Empty sol! invocation".into());
            }
            let mut output = mask(self.source.as_bytes());
            let start = tokens.first().unwrap().span().byte_range().start;
            let end = tokens.last().unwrap().span().byte_range().end;
            output[start..end].copy_from_slice(&self.source.as_bytes()[start..end]);
            clean(item.mac.tokens.clone(), &mut output)?;
            // Only interfaces and local type declarations, not implementations or external inputs.
            for t in &tokens {
                if let TokenTree::Literal(_) = t {
                    return Err("External/string sol! inputs are unsupported".into());
                }
                if let TokenTree::Ident(i) = t {
                    if matches!(i.to_string().as_str(), "contract" | "library" | "import") {
                        return Err("Rust sol! supports interfaces and local types only".into());
                    }
                }
            }
            Ok(String::from_utf8(output).unwrap())
        })();
        match result {
            Ok(output) => self.outputs.push(output),
            Err(message) => self.error = Some((item.span().byte_range(), message)),
        }
    }

    // Never interpret quoted macro templates or arbitrary nested macro arguments as interfaces.
    fn visit_macro(&mut self, _: &'ast syn::Macro) {}

    fn visit_item_use(&mut self, item: &'ast syn::ItemUse) {
        fn ambiguous(tree: &syn::UseTree, path: &str) -> bool {
            match tree {
                syn::UseTree::Path(p) => ambiguous(&p.tree, &format!("{path}{}::", p.ident)),
                syn::UseTree::Name(n) => n.ident == "sol" && path != "alloy_sol_types::",
                syn::UseTree::Rename(r) => r.rename == "sol",
                syn::UseTree::Group(g) => g.items.iter().any(|t| ambiguous(t, path)),
                syn::UseTree::Glob(_) => false,
            }
        }
        if ambiguous(&item.tree, "") {
            self.error = Some((
                item.span().byte_range(),
                "Ambiguous sol! macro alias is unsupported".into(),
            ));
        }
    }
}

fn unsupported_outer_attribute(attr: &syn::Attribute) -> bool {
    !attr.path().is_ident("doc") && !attr.path().is_ident("allow")
}

fn mask(bytes: &[u8]) -> Vec<u8> {
    bytes
        .iter()
        .map(|b| {
            if matches!(*b, b'\r' | b'\n') {
                *b
            } else {
                b' '
            }
        })
        .collect()
}

fn clean(stream: TokenStream, output: &mut [u8]) -> Result<(), String> {
    let tokens: Vec<_> = stream.into_iter().collect();
    let mut i = 0;
    while i < tokens.len() {
        if matches!(&tokens[i], TokenTree::Punct(p) if p.as_char() == '#') {
            let start = tokens[i].span().byte_range().start;
            i += 1;
            if matches!(tokens.get(i), Some(TokenTree::Punct(p)) if p.as_char() == '!') {
                i += 1;
            }
            let Some(TokenTree::Group(g)) = tokens.get(i) else {
                return Err("Malformed sol! attribute".into());
            };
            if g.delimiter() != Delimiter::Bracket {
                return Err("Malformed sol! attribute".into());
            }
            let attr = g.stream().to_string();
            let name = g
                .stream()
                .into_iter()
                .next()
                .map(|t| t.to_string())
                .unwrap_or_default();
            let allowed = matches!(name.as_str(), "doc" | "derive" | "allow")
                || (name == "sol" && attr.replace(' ', "") == "sol(abi)");
            if !allowed {
                return Err(format!("Unsupported sol! attribute #[{attr}]"));
            }
            let range = start..g.span().byte_range().end;
            let blank = mask(&output[range.clone()]);
            output[range].copy_from_slice(&blank);
        } else if let TokenTree::Group(g) = &tokens[i] {
            clean(g.stream(), output)?;
        } else if matches!(&tokens[i], TokenTree::Punct(p) if matches!(p.as_char(), '$' | '!')) {
            return Err("Macro expansion inside sol! is unsupported".into());
        }
        i += 1;
    }
    Ok(())
}
