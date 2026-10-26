// The text half of Magpie's local model (bge-small-en-v1.5): BERT's
// tokenizer and the pooling after the network runs. Both hosts share this, so
// the app, the CLI and the bench turn the same text into the same vector. The
// network itself (ONNX Runtime, WebAssembly) is the host's: see Host.embed.

/** Runs the network on one padded batch and returns last_hidden_state, [batch, length, width] flattened. */
export type RunBert = (batch: { inputIds: BigInt64Array; attentionMask: BigInt64Array; tokenTypeIds: BigInt64Array; size: number; length: number }) => Promise<{
  data: Float32Array;
  width: number;
}>;

/** The files the model is made of, relative to its folder, with their sha256. scripts/fetch-model.ts downloads them. */
export const MODEL = {
  name: "bge-small-en-v1.5",
  source: "https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/main",
  files: {
    "onnx/model_quantized.onnx": "",
    "tokenizer.json": "",
  } as Record<string, string>,
};

const MAX_TOKENS = 320;

/** BERT's uncased WordPiece tokenizer, from the vocabulary in tokenizer.json. */
export class WordPiece {
  private vocab: Map<string, number>;
  readonly cls: number;
  readonly sep: number;
  readonly unk: number;

  constructor(vocab: Record<string, number>) {
    this.vocab = new Map(Object.entries(vocab));
    this.cls = this.vocab.get("[CLS]")!;
    this.sep = this.vocab.get("[SEP]")!;
    this.unk = this.vocab.get("[UNK]")!;
  }

  static fromTokenizerJson(json: string): WordPiece {
    return new WordPiece(JSON.parse(json).model.vocab);
  }

  /** [CLS] tokens [SEP], cut to max. */
  encode(text: string, max = MAX_TOKENS): number[] {
    const ids = [this.cls];
    for (const word of basic(text)) {
      for (const id of this.word(word)) {
        if (ids.length >= max - 1) return [...ids, this.sep];
        ids.push(id);
      }
    }
    return [...ids, this.sep];
  }

  private word(w: string): number[] {
    if (w.length > 100) return [this.unk];
    const out: number[] = [];
    let start = 0;
    while (start < w.length) {
      let end = w.length;
      let id: number | undefined;
      while (start < end) {
        id = this.vocab.get((start ? "##" : "") + w.slice(start, end));
        if (id !== undefined) break;
        end--;
      }
      if (id === undefined) return [this.unk];
      out.push(id);
      start = end;
    }
    return out;
  }
}

/** Lowercase, accents off, punctuation and CJK characters split out. */
function basic(text: string): string[] {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[\u0000�\p{Cc}]/gu, " ")
    .replace(/([\p{P}\p{S}一-鿿㐀-䶿])/gu, " $1 ");
  return t.split(/\s+/).filter(Boolean);
}

/** An embed function for Host.embed: tokenize, run in small batches, take [CLS], normalize. */
export function bertEmbedder(tokenizer: WordPiece, run: RunBert, batchSize = 8) {
  return async (texts: string[]): Promise<Float32Array[]> => {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const enc = texts.slice(i, i + batchSize).map((t) => tokenizer.encode(t));
      const length = Math.max(...enc.map((e) => e.length));
      const size = enc.length;
      const inputIds = new BigInt64Array(size * length);
      const attentionMask = new BigInt64Array(size * length);
      enc.forEach((ids, b) =>
        ids.forEach((id, j) => {
          inputIds[b * length + j] = BigInt(id);
          attentionMask[b * length + j] = 1n;
        }),
      );
      const { data, width } = await run({ inputIds, attentionMask, tokenTypeIds: new BigInt64Array(size * length), size, length });
      for (let b = 0; b < size; b++) {
        const v = data.slice(b * length * width, b * length * width + width);
        const n = Math.hypot(...v) || 1;
        out.push(v.map((x) => x / n));
      }
    }
    return out;
  };
}

// Just enough of ONNX Runtime's shape for ortRun, so the core needn't depend on it.
interface OrtTensor {
  data: unknown;
  dims: readonly number[];
}
interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
type OrtTensorCtor = new (type: "int64", data: BigInt64Array, dims: number[]) => OrtTensor;

/** RunBert over an ONNX Runtime session, for hosts that load the model with onnxruntime-web. */
export function ortRun(session: OrtSession, Tensor: OrtTensorCtor): RunBert {
  return async ({ inputIds, attentionMask, tokenTypeIds, size, length }) => {
    const dims = [size, length];
    const out = await session.run({
      input_ids: new Tensor("int64", inputIds, dims),
      attention_mask: new Tensor("int64", attentionMask, dims),
      token_type_ids: new Tensor("int64", tokenTypeIds, dims),
    });
    const h = out.last_hidden_state;
    return { data: h.data as Float32Array, width: h.dims[2] };
  };
}
