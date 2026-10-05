-- Personal puzzles: "same pattern, new look" copies of the user's mistakes and engine-generated puzzles built for them.
-- Both are stored as training items so they share the spaced-repetition schedule and the session runner.
-- NOTE: run this on its own (ALTER TYPE ... ADD VALUE cannot be used in the same transaction as the values it adds).
alter type training_kind add value if not exists 'variant';
alter type training_kind add value if not exists 'generated';
