# Model emotion stickers

English forum posts now receive an animated emoji sticker when completed emotion analysis has at least one label above the fixed threshold. All 28 labels have distinct emoji mappings. The default sticker represents the highest-scoring threshold-qualified emotion; no qualifying labels means no assigned emoji. Neutral is never forced.

Click the sticker / View moods or hold the post text for 480 ms to open a tray containing only model-predicted labels and their original scores. Selecting a predicted label replays the stamp animation as a local visual preview. This is explicitly labeled a model result, not another user's reaction. Preview choices are not persisted and never overwrite model output or human review records.

Pointer movement/scroll cancels a hold. Outside-click, close and Escape dismiss the tray. Buttons support keyboard use and reduced-motion preferences disable animations. A stable analysis ID prevents the three-second polling cycle from repeatedly replaying the sticker; a new completed analysis mounts its own sticker.

Validation: frontend TypeScript/build passed; all 28 mapping keys match the model labels. Browser verified default stickers, opening by click, a real 650 ms long press, and switching between two predicted labels. Published to http://149.165.155.184/ on 2026-10-30. Cloud verification covered real post inference, automatic stickers, and a real long press.
