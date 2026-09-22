use std::env;
use std::fs;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use ndarray::Array2;
use ort::session::{builder::GraphOptimizationLevel, Session};
use tokenizers::Tokenizer;
use tonic::{transport::Server, Request, Response, Status};
use tracing::{debug, error, info, warn};

pub mod embedding {
    tonic::include_proto!("embedding");
}

use embedding::embedding_service_server::{EmbeddingService, EmbeddingServiceServer};
use embedding::{EmbedRequest, EmbedResponse};

pub struct EmbeddingEngine {
    tokenizer: Tokenizer,
    session: Mutex<Session>,
    pub model_name: String,
    pub vector_size: usize,
}

impl EmbeddingEngine {
    pub fn new(model_path: &str, tokenizer_path: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        info!("============================================================");
        info!(" Initializing Rust ONNX Embedding Engine");
        info!("============================================================");

        let start_time = Instant::now();

        // 1. Load Tokenizer
        info!(path = tokenizer_path, "Loading Hugging Face tokenizer...");
        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| format!("Failed to load tokenizer from {}: {}", tokenizer_path, e))?;

        let vocab_size = tokenizer.get_vocab_size(true);
        info!(vocab_size = vocab_size, "Tokenizer loaded successfully.");

        // 2. Inspect Model File
        let model_file_size_mb = fs::metadata(model_path)
            .map(|m| format!("{:.2} MB", m.len() as f64 / 1_048_576.0))
            .unwrap_or_else(|_| "unknown".to_string());

        info!(path = model_path, size = %model_file_size_mb, "Loading ONNX model session...");

        // 3. Build ONNX Session
        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .commit_from_file(model_path)?;

        let model_name = Path::new(model_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("qwen3-embedding")
            .to_string();

        info!("ONNX Session Graph Inputs:");
        for (idx, input) in session.inputs.iter().enumerate() {
            info!("  [{}] Input: '{}'", idx, input.name);
        }

        info!("ONNX Session Graph Outputs:");
        for (idx, output) in session.outputs.iter().enumerate() {
            info!("  [{}] Output: '{}'", idx, output.name);
        }

        let elapsed = start_time.elapsed();
        info!(
            model = %model_name,
            init_time_ms = elapsed.as_millis(),
            "Embedding engine initialized and ready."
        );

        Ok(Self {
            tokenizer,
            session: Mutex::new(session),
            model_name,
            vector_size: 1024,
        })
    }

    pub fn encode(&self, text: &str, mode: &str) -> Result<Vec<f32>, Box<dyn std::error::Error + Send + Sync>> {
        let start_time = Instant::now();

        let effective_text = match mode {
            "query" | "search_query" => {
                if text.starts_with("Instruct:") || text.starts_with("query:") {
                    text.to_string()
                } else {
                    format!("Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: {}", text)
                }
            }
            _ => text.to_string(),
        };

        // 1. Tokenize Input
        let encoding = self
            .tokenizer
            .encode(effective_text.as_str(), true)
            .map_err(|e| format!("Tokenizer encode error: {}", e))?;

        let mut token_ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
        let raw_token_count = token_ids.len();

        if token_ids.is_empty() {
            token_ids.push(0);
        }
        if token_ids.len() > 512 {
            warn!(
                original_tokens = raw_token_count,
                truncated_to = 512,
                "Text exceeded max sequence length of 512 tokens. Truncating."
            );
            token_ids.truncate(512);
        }

        let seq_len = token_ids.len();
        let attention_mask: Vec<i64> = vec![1; seq_len];

        let input_ids_array = Array2::from_shape_vec((1, seq_len), token_ids)?;
        let attention_mask_array = Array2::from_shape_vec((1, seq_len), attention_mask)?;

        // 2. Bind Model Inputs Dynamically
        let session = self.session.lock().map_err(|_| "Session mutex poisoned")?;
        let mut session_inputs: Vec<(&str, ort::value::DynValue)> = Vec::new();

        for input in &session.inputs {
            let name = input.name.as_str();
            if name.eq_ignore_ascii_case("input_ids") {
                session_inputs.push((name, ort::value::Value::from_array(input_ids_array.clone())?.into_dyn()));
            } else if name.eq_ignore_ascii_case("attention_mask") {
                session_inputs.push((name, ort::value::Value::from_array(attention_mask_array.clone())?.into_dyn()));
            } else if name.eq_ignore_ascii_case("token_type_ids") {
                let token_type_array = Array2::<i64>::zeros((1, seq_len));
                session_inputs.push((name, ort::value::Value::from_array(token_type_array)?.into_dyn()));
            } else if name.eq_ignore_ascii_case("position_ids") {
                let pos_ids: Vec<i64> = (0..seq_len as i64).collect();
                let pos_array = Array2::from_shape_vec((1, seq_len), pos_ids)?;
                session_inputs.push((name, ort::value::Value::from_array(pos_array)?.into_dyn()));
            } else if name.to_ascii_lowercase().starts_with("past_key_values") {
                let empty_kv = ndarray::Array4::<f32>::zeros((1, 8, 0, 128));
                session_inputs.push((name, ort::value::Value::from_array(empty_kv)?.into_dyn()));
            }
        }

        if session_inputs.is_empty() {
            session_inputs.push(("input_ids", ort::value::Value::from_array(input_ids_array)?.into_dyn()));
            session_inputs.push(("attention_mask", ort::value::Value::from_array(attention_mask_array)?.into_dyn()));
        }

        // 3. Execute ONNX Inference
        let outputs = session.run(session_inputs)?;

        // 4. Extract Output Tensor
        let (shape, data) = if let Some(val) = outputs.get("last_hidden_state") {
            val.try_extract_raw_tensor::<f32>()?
        } else if let Some(val) = outputs.get("sentence_embedding") {
            val.try_extract_raw_tensor::<f32>()?
        } else {
            let first_output_name = session.outputs.first().map(|o| o.name.as_str()).unwrap_or("");
            if let Some(val) = outputs.get(first_output_name) {
                val.try_extract_raw_tensor::<f32>()?
            } else {
                return Err("Empty model output".into());
            }
        };

        let mut embedding: Vec<f32>;

        // 5. Pooling & Vector Extraction
        if shape.len() == 3 {
            // [batch_size, seq_len, hidden_dim] -> Mean Pooling
            let hidden_dim = shape[2] as usize;
            embedding = vec![0.0; hidden_dim];

            for i in 0..seq_len {
                for d in 0..hidden_dim {
                    embedding[d] += data[i * hidden_dim + d];
                }
            }

            for d in 0..hidden_dim {
                embedding[d] /= seq_len as f32;
            }
        } else if shape.len() == 2 {
            // [batch_size, hidden_dim]
            let hidden_dim = shape[1] as usize;
            embedding = data[..hidden_dim].to_vec();
        } else {
            embedding = data.to_vec();
        }

        // 6. L2 Normalization
        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for val in &mut embedding {
                *val /= norm;
            }
        }

        debug!(
            seq_len = seq_len,
            dims = embedding.len(),
            l2_norm = norm,
            encode_time_ms = start_time.elapsed().as_millis(),
            "Computed embedding vector"
        );

        Ok(embedding)
    }
}

pub struct GrpcEmbeddingService {
    engine: Arc<EmbeddingEngine>,
}

#[tonic::async_trait]
impl EmbeddingService for GrpcEmbeddingService {
    async fn generate_embedding(
        &self,
        request: Request<EmbedRequest>,
    ) -> Result<Response<EmbedResponse>, Status> {
        let start_time = Instant::now();
        let client_addr = request.remote_addr();
        let req = request.into_inner();

        let text_len = req.text.len();
        let text_preview: String = req.text.chars().take(40).collect();
        let mode = if req.mode.is_empty() { "passage" } else { &req.mode };

        debug!(
            client = ?client_addr,
            mode = mode,
            chars = text_len,
            preview = %text_preview,
            "Received gRPC GenerateEmbedding request"
        );

        if req.text.trim().is_empty() {
            warn!(client = ?client_addr, "Rejected empty text embedding request");
            return Err(Status::invalid_argument("Text cannot be empty"));
        }

        match self.engine.encode(&req.text, mode) {
            Ok(dense) => {
                let duration = start_time.elapsed();
                info!(
                    mode = mode,
                    chars = text_len,
                    dim = dense.len(),
                    elapsed_ms = duration.as_millis(),
                    preview = %text_preview,
                    "Generated embedding successfully"
                );
                Ok(Response::new(EmbedResponse { dense }))
            }
            Err(err) => {
                let duration = start_time.elapsed();
                error!(
                    error = %err,
                    elapsed_ms = duration.as_millis(),
                    preview = %text_preview,
                    "Embedding generation failed"
                );
                Err(Status::internal(format!("Failed to generate embedding: {}", err)))
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,embedding_service=debug".into()),
        )
        .with_target(false)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false)
        .init();

    let model_path = env::var("MODEL_PATH").unwrap_or_else(|_| "models/model.onnx".to_string());
    let tokenizer_path =
        env::var("TOKENIZER_PATH").unwrap_or_else(|_| "models/tokenizer.json".to_string());
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8222);

    info!("============================================================");
    info!("   MangaScrapper Rust gRPC Embedding Microservice v0.1.0");
    info!("============================================================");
    info!("Port:           {}", port);
    info!("Model Path:     {}", model_path);
    info!("Tokenizer Path: {}", tokenizer_path);

    let engine = Arc::new(EmbeddingEngine::new(&model_path, &tokenizer_path)?);
    let service = GrpcEmbeddingService { engine };

    let addr: SocketAddr = format!("0.0.0.0:{}", port).parse()?;
    info!("gRPC Server listening on grpc://{}", addr);

    Server::builder()
        .add_service(EmbeddingServiceServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
