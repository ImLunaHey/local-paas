use utoipa::OpenApi;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "{}",
        control_plane::openapi::ApiDoc::openapi().to_pretty_json()?
    );
    Ok(())
}
