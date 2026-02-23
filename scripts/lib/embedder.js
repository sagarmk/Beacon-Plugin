function batchArray(array, size) {
  const batches = [];
  for (let i = 0; i < array.length; i += size) {
    batches.push(array.slice(i, i + size));
  }
  return batches;
}

export class Embedder {
  constructor(config) {
    this.apiBase = config.embedding.api_base;
    this.model = config.embedding.model;
    this.apiKey = process.env[config.embedding.api_key_env] || '';
    this.dimensions = config.embedding.dimensions;
    this.batchSize = config.embedding.batch_size;
    this.queryPrefix = config.embedding.query_prefix || '';
  }

  async embedDocuments(texts) {
    const batches = batchArray(texts, this.batchSize);
    const embeddings = [];

    for (const batch of batches) {
      const response = await fetch(`${this.apiBase}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
        },
        body: JSON.stringify({
          model: this.model,
          input: batch,
          dimensions: this.dimensions
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Embedding API error ${response.status}: ${text}`);
      }

      const data = await response.json();
      embeddings.push(...data.data.map(d => d.embedding));
    }

    return embeddings;
  }

  async embedQuery(query) {
    const prefixed = this.queryPrefix + query;
    const [embedding] = await this.embedDocuments([prefixed]);
    return embedding;
  }

  async ping() {
    try {
      await this.embedDocuments(['test']);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
