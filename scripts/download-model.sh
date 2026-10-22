#!/usr/bin/env bash
# Télécharge le modèle d'embeddings (multilingual-e5-small, quantifié) dans ./.models/ pour
# scripts/build-semantic-index.mjs et tests/semantic.live.test.ts.
# curl est utilisé car Node n'atteint pas toujours Hugging Face derrière un proxy d'entreprise.
set -euo pipefail
M="Xenova/multilingual-e5-small"
D=".models/$M"
mkdir -p "$D/onnx"
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json sentencepiece.bpe.model; do
  curl -fsSL -o "$D/$f" "https://huggingface.co/$M/resolve/main/$f"
done
curl -fsSL -o "$D/onnx/model_quantized.onnx" "https://huggingface.co/$M/resolve/main/onnx/model_quantized.onnx"
echo "Modèle prêt dans $D"
