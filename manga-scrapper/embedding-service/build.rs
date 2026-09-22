use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("PROTOC").is_err() {
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            let nuget_protoc = PathBuf::from(&userprofile)
                .join(".nuget/packages/grpc.tools/2.69.0/tools/windows_x64/protoc.exe");
            if nuget_protoc.exists() {
                std::env::set_var("PROTOC", nuget_protoc);
            }
        }
    }

    tonic_build::compile_protos("proto/embedding.proto")?;
    Ok(())
}
