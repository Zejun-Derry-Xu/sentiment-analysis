# Third-party assets

Campus Notes source code is MIT licensed; see ../LICENSE.

- SamLowe/roberta-base-go_emotions-onnx: MIT according to the model card at revision `90ee0c1c4796d370e68968687b8ba51fc11224f4`. This ONNX repository does not contain a separate LICENSE file. We preserve that card in the asset cache and the original author's full MIT notice as `MODEL-MIT.txt`.
- Original SamLowe/roberta-base-go_emotions: MIT, Copyright (c) 2023 SamLowe. The exact pinned LICENSE is retained without modification.
- google-research-datasets/go_emotions: Apache-2.0 according to its pinned dataset card. `DATA-APACHE-2.0.txt` contains the license text. Results reproduce the fixed simplified/test text and human labels; the source dataset card and citation are retained in `docs/results/dataset-manifest.json` / asset cache.
- GoEmotions citation: Demszky, D., Movshovitz-Attias, D., Ko, J., Cowen, A., Nemade, G., and Ravi, S. (2020). GoEmotions: A Dataset of Fine-Grained Emotions. ACL 2020. https://aclanthology.org/2020.acl-main.372/
- Author's evaluation reference: https://github.com/samlowe/go_emotions-dataset/blob/main/eval-roberta-base-go_emotions.ipynb . We reproduce the fixed 0.5 threshold protocol, not the notebook's threshold search.

Dependencies retain their own licenses as distributed in the locked npm/Python packages; no license in this project relicenses those dependencies or third-party assets.
