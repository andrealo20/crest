-- npx wrangler d1 execute crest-stats --remote --file schema.sql
CREATE TABLE IF NOT EXISTS counts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, kind, key)
);
