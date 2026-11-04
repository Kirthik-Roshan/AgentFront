-- Millisecond timestamps do not provide a safe replay cursor. Existing rows
-- are numbered chronologically, then all future AgentEvent writers (including
-- the legacy ones) serialize insertion on the same control row. Numbering in
-- this trigger happens *after* acquiring the transaction lock, so a later
-- committed event cannot acquire a lower sequence number than an earlier one.
CREATE SEQUENCE "AgentEvent_sequence_seq";
ALTER TABLE "AgentEvent" ADD COLUMN "sequence" BIGINT;
WITH numbered AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS position
  FROM "AgentEvent"
)
UPDATE "AgentEvent" AS event SET "sequence" = numbered.position
FROM numbered WHERE event."id" = numbered."id";
SELECT setval('"AgentEvent_sequence_seq"',
  GREATEST(1, COALESCE((SELECT MAX("sequence") FROM "AgentEvent"), 0)),
  EXISTS(SELECT 1 FROM "AgentEvent"));
ALTER SEQUENCE "AgentEvent_sequence_seq" OWNED BY "AgentEvent"."sequence";
ALTER TABLE "AgentEvent" ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "AgentEvent" ALTER COLUMN "sequence" SET DEFAULT nextval('"AgentEvent_sequence_seq"');
CREATE UNIQUE INDEX "AgentEvent_sequence_key" ON "AgentEvent"("sequence");

CREATE FUNCTION agentfront_serial_event_cursor() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM "SystemControl" WHERE "id" = 'global' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Global event cursor lock does not exist.'; END IF;
  NEW."sequence" := nextval('"AgentEvent_sequence_seq"');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agentfront_event_cursor_before_insert
BEFORE INSERT ON "AgentEvent" FOR EACH ROW
EXECUTE FUNCTION agentfront_serial_event_cursor();
