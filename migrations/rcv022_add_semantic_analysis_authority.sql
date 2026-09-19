-- RCV-022 semantic analysis authority, V1 Wave A physical boundary.
-- Canonical TEXT is the semantic authority; JSONB/relational values are
-- admission/query projections only.  This migration deliberately contains
-- no writer, reader, builder, or downstream adjudication implementation.

BEGIN;

DO $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'RCV-022 requires server_encoding UTF8' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_guard_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RCV-022 authority rows are immutable: %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_require_object_shape(value JSONB, required_keys TEXT[], optional_keys TEXT[] DEFAULT ARRAY[]::TEXT[])
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE k TEXT;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'object' THEN
    RAISE EXCEPTION 'RCV-022 expected JSON object' USING ERRCODE = '22023';
  END IF;
  FOREACH k IN ARRAY required_keys LOOP
    IF NOT (value ? k) OR value -> k = 'null'::jsonb THEN
      RAISE EXCEPTION 'RCV-022 missing or null required key %', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR k IN SELECT jsonb_object_keys(value) LOOP
    IF NOT (k = ANY(required_keys) OR k = ANY(optional_keys)) THEN
      RAISE EXCEPTION 'RCV-022 unexpected key %', k USING ERRCODE = '22023';
    END IF;
    IF value -> k = 'null'::jsonb THEN
      RAISE EXCEPTION 'RCV-022 JSON null is not omission for key %', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_json_text(value JSONB, key_name TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v JSONB;
BEGIN
  IF NOT (value ? key_name) THEN RAISE EXCEPTION 'missing key %', key_name USING ERRCODE='22023'; END IF;
  v := value -> key_name;
  IF v = 'null'::jsonb OR jsonb_typeof(v) <> 'string' THEN
    RAISE EXCEPTION 'wrong JSON type for %', key_name USING ERRCODE='22023';
  END IF;
  RETURN v #>> '{}';
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_json_int(value JSONB, key_name TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v JSONB; n NUMERIC;
BEGIN
  IF NOT (value ? key_name) THEN RAISE EXCEPTION 'missing key %', key_name USING ERRCODE='22023'; END IF;
  v := value -> key_name;
  IF v = 'null'::jsonb OR jsonb_typeof(v) <> 'number' THEN
    RAISE EXCEPTION 'wrong JSON type for %', key_name USING ERRCODE='22023';
  END IF;
  BEGIN n := (v #>> '{}')::NUMERIC; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid integer %', key_name USING ERRCODE='22023'; END;
  IF n <> trunc(n) OR n < -2147483648 OR n > 2147483647 THEN RAISE EXCEPTION 'invalid integer %', key_name USING ERRCODE='22023'; END IF;
  RETURN n::INTEGER;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_json_bool(value JSONB, key_name TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v JSONB;
BEGIN
  IF NOT (value ? key_name) THEN RAISE EXCEPTION 'missing key %', key_name USING ERRCODE='22023'; END IF;
  v := value -> key_name;
  IF v = 'null'::jsonb OR jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'wrong JSON type for %', key_name USING ERRCODE='22023'; END IF;
  RETURN (v #>> '{}')::BOOLEAN;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_json_hash(value JSONB, key_name TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE s TEXT;
BEGIN
  s := public.rcv022_json_text(value, key_name);
  IF s !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid hash %', key_name USING ERRCODE='22023'; END IF;
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_require_text_keys(value JSONB, key_names TEXT[])
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE k TEXT;
BEGIN
  FOREACH k IN ARRAY key_names LOOP PERFORM public.rcv022_json_text(value,k); END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_require_hash_keys(value JSONB, key_names TEXT[])
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE k TEXT;
BEGIN
  FOREACH k IN ARRAY key_names LOOP PERFORM public.rcv022_json_hash(value,k); END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_compare_text(doc JSONB, key_name TEXT, actual TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE expected TEXT;
BEGIN
  IF actual IS NULL THEN RAISE EXCEPTION 'NULL projection %', key_name USING ERRCODE='22023'; END IF;
  expected := public.rcv022_json_text(doc, key_name);
  IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'projection mismatch %', key_name USING ERRCODE='23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_compare_int(doc JSONB, key_name TEXT, actual INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS NULL OR public.rcv022_json_int(doc,key_name) IS DISTINCT FROM actual THEN RAISE EXCEPTION 'projection mismatch %', key_name USING ERRCODE='23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_compare_uuid(doc JSONB, key_name TEXT, actual UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS NULL OR (public.rcv022_json_text(doc,key_name))::UUID IS DISTINCT FROM actual THEN RAISE EXCEPTION 'projection mismatch %', key_name USING ERRCODE='23514'; END IF;
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid UUID %', key_name USING ERRCODE='22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_compare_json(doc JSONB, key_name TEXT, actual JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS NULL OR NOT ((doc ? key_name) AND (doc -> key_name) IS NOT DISTINCT FROM actual) THEN
    RAISE EXCEPTION 'JSON projection mismatch %', key_name USING ERRCODE='23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_validate_timestamp(value TIMESTAMPTZ, canonical_value TEXT, field_name TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE formatted TEXT; reparsed TIMESTAMPTZ; y NUMERIC;
BEGIN
  IF value IS NULL OR canonical_value IS NULL OR canonical_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN
    RAISE EXCEPTION 'invalid RCV-022 timestamp %', field_name USING ERRCODE='22023';
  END IF;
  IF NOT isfinite(value) THEN RAISE EXCEPTION 'infinite timestamp %', field_name USING ERRCODE='22023'; END IF;
  y := extract(year FROM value AT TIME ZONE 'UTC');
  IF y < 1 OR y > 9999 OR y <> trunc(y) THEN RAISE EXCEPTION 'timestamp year outside RCV-022 domain %', field_name USING ERRCODE='22023'; END IF;
  formatted := to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  IF formatted IS DISTINCT FROM canonical_value THEN RAISE EXCEPTION 'timestamp format mismatch %', field_name USING ERRCODE='23514'; END IF;
  BEGIN reparsed := canonical_value::TIMESTAMPTZ; EXCEPTION WHEN others THEN RAISE EXCEPTION 'timestamp parse failure %', field_name USING ERRCODE='22023'; END;
  IF reparsed IS DISTINCT FROM value OR to_char(reparsed AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') IS DISTINCT FROM canonical_value THEN
    RAISE EXCEPTION 'timestamp round-trip mismatch %', field_name USING ERRCODE='23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_validate_hash_array(value JSONB, field_name TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE e JSONB;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'array' THEN RAISE EXCEPTION 'array required %', field_name USING ERRCODE='22023'; END IF;
  FOR e IN SELECT value -> i FROM generate_series(0,jsonb_array_length(value)-1) AS s(i) LOOP
    IF jsonb_typeof(e) <> 'string' OR e #>> '{}' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid hash array %', field_name USING ERRCODE='22023'; END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_validate_locator(value JSONB, fragment_kind TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE kind TEXT; seg JSONB; i INTEGER; keys TEXT[];
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'object' THEN RAISE EXCEPTION 'locator object required' USING ERRCODE='22023'; END IF;
  kind := public.rcv022_json_text(value,'kind');
  IF fragment_kind='TEXT' AND kind NOT IN ('WHOLE_TEXT','UTF8_BYTE_RANGE') THEN RAISE EXCEPTION 'TEXT locator mismatch' USING ERRCODE='22023'; END IF;
  IF fragment_kind='STRUCTURED' AND kind <> 'STRUCTURED_PATH' THEN RAISE EXCEPTION 'STRUCTURED locator mismatch' USING ERRCODE='22023'; END IF;
  IF fragment_kind='IMAGE_REGION' AND kind <> 'IMAGE_REGION' THEN RAISE EXCEPTION 'IMAGE locator mismatch' USING ERRCODE='22023'; END IF;
  IF kind='WHOLE_TEXT' THEN PERFORM public.rcv022_require_object_shape(value,ARRAY['kind']);
  ELSIF kind='UTF8_BYTE_RANGE' THEN
    PERFORM public.rcv022_require_object_shape(value,ARRAY['kind','startByte','endByteExclusive']);
    IF public.rcv022_json_int(value,'startByte') < 0 OR public.rcv022_json_int(value,'endByteExclusive') <= public.rcv022_json_int(value,'startByte') THEN RAISE EXCEPTION 'invalid byte range' USING ERRCODE='22023'; END IF;
  ELSIF kind='STRUCTURED_PATH' THEN
    PERFORM public.rcv022_require_object_shape(value,ARRAY['kind','segments']);
    IF jsonb_typeof(value->'segments') <> 'array' THEN RAISE EXCEPTION 'segments array required' USING ERRCODE='22023'; END IF;
    FOR i IN 0..jsonb_array_length(value->'segments')-1 LOOP
      seg := value->'segments'->i;
      IF jsonb_typeof(seg) <> 'object' THEN RAISE EXCEPTION 'segment object required' USING ERRCODE='22023'; END IF;
      kind := public.rcv022_json_text(seg,'kind');
      IF kind='KEY' THEN PERFORM public.rcv022_require_object_shape(seg,ARRAY['kind','key']); PERFORM public.rcv022_json_text(seg,'key');
      ELSIF kind='INDEX' THEN PERFORM public.rcv022_require_object_shape(seg,ARRAY['kind','index']); IF public.rcv022_json_int(seg,'index') < 0 THEN RAISE EXCEPTION 'negative index' USING ERRCODE='22023'; END IF;
      ELSE RAISE EXCEPTION 'invalid path segment kind' USING ERRCODE='22023'; END IF;
    END LOOP;
  ELSIF kind='IMAGE_REGION' THEN
    PERFORM public.rcv022_require_object_shape(value,ARRAY['kind','coordinateSystemId','coordinateSystemVersion','imageWidth','imageHeight','x','y','width','height']);
    IF public.rcv022_json_text(value,'coordinateSystemId') <> 'raw-pixel-v1' OR public.rcv022_json_int(value,'coordinateSystemVersion') <> 1 THEN RAISE EXCEPTION 'invalid image coordinate system' USING ERRCODE='22023'; END IF;
    IF public.rcv022_json_int(value,'imageWidth')<1 OR public.rcv022_json_int(value,'imageHeight')<1 OR public.rcv022_json_int(value,'x')<0 OR public.rcv022_json_int(value,'y')<0 OR public.rcv022_json_int(value,'width')<1 OR public.rcv022_json_int(value,'height')<1 OR public.rcv022_json_int(value,'x')+public.rcv022_json_int(value,'width')>public.rcv022_json_int(value,'imageWidth') OR public.rcv022_json_int(value,'y')+public.rcv022_json_int(value,'height')>public.rcv022_json_int(value,'imageHeight') THEN RAISE EXCEPTION 'invalid image bounds' USING ERRCODE='22023'; END IF;
  ELSE RAISE EXCEPTION 'invalid locator kind' USING ERRCODE='22023'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_validate_content_binding(value JSONB, fragment_kind TEXT, representation_hash TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE kind TEXT;
BEGIN
  kind := public.rcv022_json_text(value,'kind');
  IF kind='TEXT' THEN
    PERFORM public.rcv022_require_object_shape(value,ARRAY['kind','utf8Text','contentHash']);
    PERFORM public.rcv022_require_text_keys(value,ARRAY['utf8Text']); PERFORM public.rcv022_json_hash(value,'contentHash');
    IF fragment_kind<>'TEXT' THEN RAISE EXCEPTION 'invalid text binding' USING ERRCODE='22023'; END IF;
  ELSIF kind='STRUCTURED' THEN
    PERFORM public.rcv022_require_object_shape(value,ARRAY['kind','canonicalVersion','canonical','canonicalHash']);
    PERFORM public.rcv022_json_int(value,'canonicalVersion'); PERFORM public.rcv022_require_text_keys(value,ARRAY['canonical']); PERFORM public.rcv022_json_hash(value,'canonicalHash');
    IF fragment_kind<>'STRUCTURED' OR public.rcv022_json_int(value,'canonicalVersion')<1 THEN RAISE EXCEPTION 'invalid structured binding' USING ERRCODE='22023'; END IF;
  ELSIF kind='IMAGE_REGION' THEN
    PERFORM public.rcv022_require_object_shape(value,ARRAY['kind','sourceRepresentationHash']);
    IF fragment_kind<>'IMAGE_REGION' OR public.rcv022_json_hash(value,'sourceRepresentationHash') IS DISTINCT FROM representation_hash THEN RAISE EXCEPTION 'invalid image binding' USING ERRCODE='22023'; END IF;
  ELSE RAISE EXCEPTION 'invalid content binding kind' USING ERRCODE='22023'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_validate_extraction(value JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE kind TEXT;
BEGIN
  kind := public.rcv022_json_text(value,'kind');
  IF kind='DIRECT' THEN PERFORM public.rcv022_require_object_shape(value,ARRAY['kind']);
  ELSIF kind='DERIVED' THEN
    PERFORM public.rcv022_require_object_shape(value,ARRAY['kind','extractorIdentity','extractorVersion','extractorHash']);
    PERFORM public.rcv022_require_text_keys(value,ARRAY['extractorIdentity','extractorVersion']); PERFORM public.rcv022_json_hash(value,'extractorHash');
  ELSE RAISE EXCEPTION 'invalid extraction authority kind' USING ERRCODE='22023'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_validate_assessment_result(value JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.rcv022_require_object_shape(value,ARRAY['relation','rationale']);
  PERFORM public.rcv022_require_text_keys(value,ARRAY['rationale']);
  IF public.rcv022_json_text(value,'relation') NOT IN ('SUPPORTS','REFUTES','INSUFFICIENT','UNRELATED') THEN RAISE EXCEPTION 'invalid assessment relation' USING ERRCODE='22023'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_validate_sampling(value JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE e JSONB; i INTEGER; last_name TEXT := NULL; n TEXT;
BEGIN
  PERFORM public.rcv022_require_object_shape(value,ARRAY['schema','canonicalVersion','entries']);
  IF public.rcv022_json_text(value,'schema') <> 'factbase-rcv022-sampling-parameters' OR public.rcv022_json_int(value,'canonicalVersion') <> 1 OR jsonb_typeof(value->'entries') <> 'array' THEN RAISE EXCEPTION 'invalid sampling parameters' USING ERRCODE='22023'; END IF;
  FOR i IN 0..jsonb_array_length(value->'entries')-1 LOOP
    e := value->'entries'->i; PERFORM public.rcv022_require_object_shape(e,ARRAY['name','value']); n := public.rcv022_json_text(e,'name');
    IF last_name IS NOT NULL AND n <= last_name THEN RAISE EXCEPTION 'sampling names not ordered/unique' USING ERRCODE='22023'; END IF;
    IF jsonb_typeof(e->'value') NOT IN ('string','number','boolean') THEN RAISE EXCEPTION 'invalid sampling scalar' USING ERRCODE='22023'; END IF; last_name := n;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_validate_method_provenance(value JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE t TEXT; allowed TEXT[]; required TEXT[];
BEGIN
  t := public.rcv022_json_text(value,'methodType');
  IF t='DETERMINISTIC' THEN
    required:=ARRAY['methodType','methodIdentity','methodVersion','methodHash','inputCanonicalHashes','structuredOutputHash','reviewStatus'];
    PERFORM public.rcv022_require_object_shape(value,required); PERFORM public.rcv022_require_text_keys(value,ARRAY['methodIdentity','methodVersion']); PERFORM public.rcv022_require_hash_keys(value,ARRAY['methodHash','structuredOutputHash']); IF public.rcv022_json_text(value,'reviewStatus') NOT IN ('NOT_REVIEWED','REVIEWED') THEN RAISE EXCEPTION 'invalid review status' USING ERRCODE='22023'; END IF;
  ELSIF t='MODEL_ASSISTED' THEN
    required:=ARRAY['methodType','methodIdentity','methodVersion','methodHash','providerIdentity','modelIdentity','modelVersion','processIdentity','processVersion','processHash','promptTemplateHash','systemInstructionHash','samplingParameters','samplingParametersHash','inputCanonicalHashes','rawOutputHash','structuredOutputHash','retryIdentity','reviewStatus','toolParticipation'];
    PERFORM public.rcv022_require_object_shape(value,required,ARRAY['toolContextHash']); PERFORM public.rcv022_require_text_keys(value,ARRAY['methodIdentity','methodVersion','providerIdentity','modelIdentity','modelVersion','processIdentity','processVersion','retryIdentity']); PERFORM public.rcv022_require_hash_keys(value,ARRAY['methodHash','processHash','promptTemplateHash','systemInstructionHash','samplingParametersHash','rawOutputHash','structuredOutputHash']);
    IF public.rcv022_json_text(value,'toolParticipation') NOT IN ('USED','NOT_USED') THEN RAISE EXCEPTION 'invalid toolParticipation' USING ERRCODE='22023'; END IF;
    IF public.rcv022_json_text(value,'toolParticipation')='USED' THEN IF NOT (value ? 'toolContextHash') THEN RAISE EXCEPTION 'USED requires toolContextHash' USING ERRCODE='22023'; END IF; PERFORM public.rcv022_json_hash(value,'toolContextHash'); ELSE IF value ? 'toolContextHash' THEN RAISE EXCEPTION 'NOT_USED forbids toolContextHash' USING ERRCODE='22023'; END IF; END IF;
    IF public.rcv022_json_text(value,'reviewStatus') NOT IN ('NOT_REVIEWED','REVIEWED') THEN RAISE EXCEPTION 'invalid review status' USING ERRCODE='22023'; END IF; PERFORM public.rcv022_validate_sampling(value->'samplingParameters');
  ELSIF t='HUMAN' THEN
    required:=ARRAY['methodType','methodIdentity','methodVersion','methodHash','reviewerIdentity','reviewProcessIdentity','reviewProcessVersion','reviewProcessHash','inputCanonicalHashes','structuredOutputHash','reviewStatus'];
    PERFORM public.rcv022_require_object_shape(value,required); PERFORM public.rcv022_require_text_keys(value,ARRAY['methodIdentity','methodVersion','reviewerIdentity','reviewProcessIdentity','reviewProcessVersion']); PERFORM public.rcv022_require_hash_keys(value,ARRAY['methodHash','reviewProcessHash','structuredOutputHash']); IF public.rcv022_json_text(value,'reviewStatus') NOT IN ('NOT_REVIEWED','REVIEWED') THEN RAISE EXCEPTION 'invalid review status' USING ERRCODE='22023'; END IF;
  ELSIF t='MIXED' THEN
    required:=ARRAY['methodType','methodIdentity','methodVersion','methodHash','providerIdentity','modelIdentity','modelVersion','processIdentity','processVersion','processHash','promptTemplateHash','systemInstructionHash','samplingParameters','samplingParametersHash','inputCanonicalHashes','rawOutputHash','structuredOutputHash','retryIdentity','reviewerIdentity','reviewProcessIdentity','reviewProcessVersion','reviewProcessHash','reviewStatus','acceptanceStatus','toolParticipation'];
    PERFORM public.rcv022_require_object_shape(value,required,ARRAY['toolContextHash']); PERFORM public.rcv022_require_text_keys(value,ARRAY['methodIdentity','methodVersion','providerIdentity','modelIdentity','modelVersion','processIdentity','processVersion','retryIdentity','reviewerIdentity','reviewProcessIdentity','reviewProcessVersion']); PERFORM public.rcv022_require_hash_keys(value,ARRAY['methodHash','processHash','promptTemplateHash','systemInstructionHash','samplingParametersHash','rawOutputHash','structuredOutputHash','reviewProcessHash']);
    IF public.rcv022_json_text(value,'toolParticipation') NOT IN ('USED','NOT_USED') THEN RAISE EXCEPTION 'invalid toolParticipation' USING ERRCODE='22023'; END IF;
    IF public.rcv022_json_text(value,'toolParticipation')='USED' THEN IF NOT (value ? 'toolContextHash') THEN RAISE EXCEPTION 'USED requires toolContextHash' USING ERRCODE='22023'; END IF; PERFORM public.rcv022_json_hash(value,'toolContextHash'); ELSE IF value ? 'toolContextHash' THEN RAISE EXCEPTION 'NOT_USED forbids toolContextHash' USING ERRCODE='22023'; END IF; END IF;
    IF public.rcv022_json_text(value,'reviewStatus') NOT IN ('NOT_REVIEWED','REVIEWED') OR public.rcv022_json_text(value,'acceptanceStatus') NOT IN ('PENDING','ACCEPTED','REJECTED') THEN RAISE EXCEPTION 'invalid mixed status' USING ERRCODE='22023'; END IF; PERFORM public.rcv022_validate_sampling(value->'samplingParameters');
  ELSE RAISE EXCEPTION 'invalid method type' USING ERRCODE='22023'; END IF;
  PERFORM public.rcv022_validate_hash_array(value->'inputCanonicalHashes','inputCanonicalHashes');
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_validate_ref_array(value JSONB, field_name TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE e JSONB; i INTEGER; seen JSONB := '{}'::JSONB; id TEXT;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'array' THEN RAISE EXCEPTION '% must be array', field_name USING ERRCODE='22023'; END IF;
  FOR i IN 0..jsonb_array_length(value)-1 LOOP
    e:=value->i; PERFORM public.rcv022_require_object_shape(e,ARRAY['id','canonicalVersion','canonicalHash']); id:=public.rcv022_json_text(e,'id');
    IF seen ? id THEN RAISE EXCEPTION 'duplicate member %', id USING ERRCODE='23514'; END IF; seen:=seen || jsonb_build_object(id,true);
    IF public.rcv022_json_int(e,'canonicalVersion')<>1 OR public.rcv022_json_text(e,'canonicalHash') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid member reference' USING ERRCODE='22023'; END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.rcv022_validate_authority_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc JSONB; required TEXT[];
BEGIN
  BEGIN doc := NEW.canonical::JSONB; EXCEPTION WHEN others THEN RAISE EXCEPTION 'malformed canonical JSON' USING ERRCODE='22023'; END;
  IF NEW.canonical_hash IS NULL OR NEW.canonical_hash IS DISTINCT FROM public.rcv016_sha256_text(NEW.canonical) THEN RAISE EXCEPTION 'canonical hash mismatch' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='rcv022_evidence_fragments' THEN
    required:=ARRAY['schema','canonicalVersion','fragmentId','captureId','captureCanonicalVersion','captureCanonicalHash','captureRepresentationHash','fragmentKind','locator','contentBinding','extractionAuthority'];
    PERFORM public.rcv022_require_object_shape(doc,required); IF public.rcv022_json_int(doc,'canonicalVersion')<>1 OR public.rcv022_json_text(doc,'schema') IS NULL THEN RAISE EXCEPTION 'invalid fragment canonical' USING ERRCODE='22023'; END IF;
    PERFORM public.rcv022_compare_int(doc,'canonicalVersion',NEW.canonical_version); PERFORM public.rcv022_compare_uuid(doc,'fragmentId',NEW.fragment_id); PERFORM public.rcv022_compare_uuid(doc,'captureId',NEW.capture_id); PERFORM public.rcv022_compare_text(doc,'captureCanonicalVersion',NEW.capture_canonical_version); PERFORM public.rcv022_compare_text(doc,'captureCanonicalHash',NEW.capture_canonical_hash); PERFORM public.rcv022_compare_text(doc,'captureRepresentationHash',NEW.capture_representation_hash); PERFORM public.rcv022_compare_text(doc,'fragmentKind',NEW.fragment_kind); PERFORM public.rcv022_compare_json(doc,'locator',NEW.locator); PERFORM public.rcv022_compare_json(doc,'contentBinding',NEW.content_binding); PERFORM public.rcv022_compare_json(doc,'extractionAuthority',NEW.extraction_authority);
    PERFORM public.rcv022_validate_locator(doc->'locator',NEW.fragment_kind); PERFORM public.rcv022_validate_content_binding(doc->'contentBinding',NEW.fragment_kind,NEW.capture_representation_hash); PERFORM public.rcv022_validate_extraction(doc->'extractionAuthority');
  ELSIF TG_TABLE_NAME='rcv022_claim_evidence_matches' THEN
    required:=ARRAY['schema','canonicalVersion','matchId','claimId','claimCanonicalVersion','claimCanonicalHash','claimVersionId','claimVersionCanonicalVersion','claimVersionCanonicalHash','evidenceFragmentId','evidenceFragmentCanonicalVersion','evidenceFragmentCanonicalHash','matcherIdentity','matcherVersion','matcherHash','matcherInputCanonicalHashes']; PERFORM public.rcv022_require_object_shape(doc,required);
    PERFORM public.rcv022_compare_int(doc,'canonicalVersion',NEW.canonical_version); PERFORM public.rcv022_compare_uuid(doc,'matchId',NEW.match_id); PERFORM public.rcv022_compare_uuid(doc,'claimId',NEW.claim_id); PERFORM public.rcv022_compare_int(doc,'claimCanonicalVersion',NEW.claim_canonical_version); PERFORM public.rcv022_compare_text(doc,'claimCanonicalHash',NEW.claim_canonical_hash); PERFORM public.rcv022_compare_uuid(doc,'claimVersionId',NEW.claim_version_id); PERFORM public.rcv022_compare_int(doc,'claimVersionCanonicalVersion',NEW.claim_version_canonical_version); PERFORM public.rcv022_compare_text(doc,'claimVersionCanonicalHash',NEW.claim_version_canonical_hash); PERFORM public.rcv022_compare_uuid(doc,'evidenceFragmentId',NEW.evidence_fragment_id); PERFORM public.rcv022_compare_int(doc,'evidenceFragmentCanonicalVersion',NEW.evidence_fragment_canonical_version); PERFORM public.rcv022_compare_text(doc,'evidenceFragmentCanonicalHash',NEW.evidence_fragment_canonical_hash); PERFORM public.rcv022_compare_text(doc,'matcherIdentity',NEW.matcher_identity); PERFORM public.rcv022_compare_text(doc,'matcherVersion',NEW.matcher_version); PERFORM public.rcv022_compare_text(doc,'matcherHash',NEW.matcher_hash); PERFORM public.rcv022_compare_json(doc,'matcherInputCanonicalHashes',NEW.matcher_input_canonical_hashes); PERFORM public.rcv022_validate_hash_array(NEW.matcher_input_canonical_hashes,'matcherInputCanonicalHashes');
  ELSIF TG_TABLE_NAME='rcv022_evidence_assessments' THEN
    required:=ARRAY['schema','canonicalVersion','assessmentId','claimEvidenceMatchId','claimEvidenceMatchCanonicalVersion','claimEvidenceMatchCanonicalHash','claimId','claimCanonicalVersion','claimCanonicalHash','claimVersionId','claimVersionCanonicalVersion','claimVersionCanonicalHash','evidenceFragmentId','evidenceFragmentCanonicalVersion','evidenceFragmentCanonicalHash','assessmentResult','methodProvenance','assessedAt']; PERFORM public.rcv022_require_object_shape(doc,required);
    PERFORM public.rcv022_compare_int(doc,'canonicalVersion',NEW.canonical_version); PERFORM public.rcv022_compare_uuid(doc,'assessmentId',NEW.assessment_id); PERFORM public.rcv022_compare_uuid(doc,'claimEvidenceMatchId',NEW.claim_evidence_match_id); PERFORM public.rcv022_compare_int(doc,'claimEvidenceMatchCanonicalVersion',NEW.claim_evidence_match_canonical_version); PERFORM public.rcv022_compare_text(doc,'claimEvidenceMatchCanonicalHash',NEW.claim_evidence_match_canonical_hash); PERFORM public.rcv022_compare_uuid(doc,'claimId',NEW.claim_id); PERFORM public.rcv022_compare_int(doc,'claimCanonicalVersion',NEW.claim_canonical_version); PERFORM public.rcv022_compare_text(doc,'claimCanonicalHash',NEW.claim_canonical_hash); PERFORM public.rcv022_compare_uuid(doc,'claimVersionId',NEW.claim_version_id); PERFORM public.rcv022_compare_int(doc,'claimVersionCanonicalVersion',NEW.claim_version_canonical_version); PERFORM public.rcv022_compare_text(doc,'claimVersionCanonicalHash',NEW.claim_version_canonical_hash); PERFORM public.rcv022_compare_uuid(doc,'evidenceFragmentId',NEW.evidence_fragment_id); PERFORM public.rcv022_compare_int(doc,'evidenceFragmentCanonicalVersion',NEW.evidence_fragment_canonical_version); PERFORM public.rcv022_compare_text(doc,'evidenceFragmentCanonicalHash',NEW.evidence_fragment_canonical_hash); PERFORM public.rcv022_compare_json(doc,'assessmentResult',NEW.assessment_result); PERFORM public.rcv022_compare_json(doc,'methodProvenance',NEW.method_provenance); PERFORM public.rcv022_compare_text(doc,'assessedAt',to_char(NEW.assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')); PERFORM public.rcv022_validate_assessment_result(NEW.assessment_result); PERFORM public.rcv022_validate_method_provenance(NEW.method_provenance); PERFORM public.rcv022_validate_timestamp(NEW.assessed_at,public.rcv022_json_text(doc,'assessedAt'),'assessedAt');
  ELSIF TG_TABLE_NAME='rcv022_semantic_analysis_envelopes' THEN
    required:=ARRAY['schema','canonicalVersion','envelopeId','claimId','claimCanonicalVersion','claimCanonicalHash','claimVersionId','claimVersionCanonicalVersion','claimVersionCanonicalHash','analysisCutoffAt','analysisAt','matchRefs','assessmentRefs','analysisMethodIdentity','analysisMethodVersion','analysisMethodHash']; PERFORM public.rcv022_require_object_shape(doc,required);
    PERFORM public.rcv022_compare_int(doc,'canonicalVersion',NEW.canonical_version); PERFORM public.rcv022_compare_uuid(doc,'envelopeId',NEW.envelope_id); PERFORM public.rcv022_compare_uuid(doc,'claimId',NEW.claim_id); PERFORM public.rcv022_compare_int(doc,'claimCanonicalVersion',NEW.claim_canonical_version); PERFORM public.rcv022_compare_text(doc,'claimCanonicalHash',NEW.claim_canonical_hash); PERFORM public.rcv022_compare_uuid(doc,'claimVersionId',NEW.claim_version_id); PERFORM public.rcv022_compare_int(doc,'claimVersionCanonicalVersion',NEW.claim_version_canonical_version); PERFORM public.rcv022_compare_text(doc,'claimVersionCanonicalHash',NEW.claim_version_canonical_hash); PERFORM public.rcv022_compare_text(doc,'analysisCutoffAt',to_char(NEW.analysis_cutoff_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')); PERFORM public.rcv022_compare_text(doc,'analysisAt',to_char(NEW.analysis_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')); PERFORM public.rcv022_compare_json(doc,'matchRefs',NEW.match_refs); PERFORM public.rcv022_compare_json(doc,'assessmentRefs',NEW.assessment_refs); PERFORM public.rcv022_compare_text(doc,'analysisMethodIdentity',NEW.analysis_method_identity); PERFORM public.rcv022_compare_text(doc,'analysisMethodVersion',NEW.analysis_method_version); PERFORM public.rcv022_compare_text(doc,'analysisMethodHash',NEW.analysis_method_hash); PERFORM public.rcv022_validate_ref_array(NEW.match_refs,'matchRefs'); PERFORM public.rcv022_validate_ref_array(NEW.assessment_refs,'assessmentRefs'); PERFORM public.rcv022_validate_timestamp(NEW.analysis_cutoff_at,public.rcv022_json_text(doc,'analysisCutoffAt'),'analysisCutoffAt'); PERFORM public.rcv022_validate_timestamp(NEW.analysis_at,public.rcv022_json_text(doc,'analysisAt'),'analysisAt');
  ELSE RAISE EXCEPTION 'unexpected RCV-022 authority table' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.rcv022_evidence_fragments (
  fragment_id UUID NOT NULL PRIMARY KEY, canonical_version INTEGER NOT NULL CHECK (canonical_version=1), canonical TEXT NOT NULL, canonical_hash TEXT NOT NULL CHECK (canonical_hash ~ '^[0-9a-f]{64}$'), capture_id UUID NOT NULL, capture_canonical_version TEXT NOT NULL CHECK (capture_canonical_version='RCV020-CANONICAL-V1'), capture_canonical_hash TEXT NOT NULL CHECK (capture_canonical_hash ~ '^[0-9a-f]{64}$'), capture_representation_hash TEXT NOT NULL CHECK (capture_representation_hash ~ '^[0-9a-f]{64}$'), fragment_kind TEXT NOT NULL CHECK (fragment_kind IN ('TEXT','STRUCTURED','IMAGE_REGION')), locator JSONB NOT NULL, content_binding JSONB NOT NULL, extraction_authority JSONB NOT NULL
);

CREATE TABLE public.rcv022_claim_evidence_matches (
  match_id UUID NOT NULL PRIMARY KEY, canonical_version INTEGER NOT NULL CHECK(canonical_version=1), canonical TEXT NOT NULL, canonical_hash TEXT NOT NULL CHECK(canonical_hash ~ '^[0-9a-f]{64}$'), claim_id UUID NOT NULL, claim_canonical_version INTEGER NOT NULL CHECK(claim_canonical_version=1), claim_canonical_hash TEXT NOT NULL CHECK(claim_canonical_hash ~ '^[0-9a-f]{64}$'), claim_version_id UUID NOT NULL, claim_version_canonical_version INTEGER NOT NULL CHECK(claim_version_canonical_version=1), claim_version_canonical_hash TEXT NOT NULL CHECK(claim_version_canonical_hash ~ '^[0-9a-f]{64}$'), evidence_fragment_id UUID NOT NULL, evidence_fragment_canonical_version INTEGER NOT NULL CHECK(evidence_fragment_canonical_version=1), evidence_fragment_canonical_hash TEXT NOT NULL CHECK(evidence_fragment_canonical_hash ~ '^[0-9a-f]{64}$'), matcher_identity TEXT NOT NULL, matcher_version TEXT NOT NULL, matcher_hash TEXT NOT NULL CHECK(matcher_hash ~ '^[0-9a-f]{64}$'), matcher_input_canonical_hashes JSONB NOT NULL
);

CREATE TABLE public.rcv022_evidence_assessments (
  assessment_id UUID NOT NULL PRIMARY KEY, canonical_version INTEGER NOT NULL CHECK(canonical_version=1), canonical TEXT NOT NULL, canonical_hash TEXT NOT NULL CHECK(canonical_hash ~ '^[0-9a-f]{64}$'), claim_evidence_match_id UUID NOT NULL, claim_evidence_match_canonical_version INTEGER NOT NULL CHECK(claim_evidence_match_canonical_version=1), claim_evidence_match_canonical_hash TEXT NOT NULL CHECK(claim_evidence_match_canonical_hash ~ '^[0-9a-f]{64}$'), claim_id UUID NOT NULL, claim_canonical_version INTEGER NOT NULL CHECK(claim_canonical_version=1), claim_canonical_hash TEXT NOT NULL CHECK(claim_canonical_hash ~ '^[0-9a-f]{64}$'), claim_version_id UUID NOT NULL, claim_version_canonical_version INTEGER NOT NULL CHECK(claim_version_canonical_version=1), claim_version_canonical_hash TEXT NOT NULL CHECK(claim_version_canonical_hash ~ '^[0-9a-f]{64}$'), evidence_fragment_id UUID NOT NULL, evidence_fragment_canonical_version INTEGER NOT NULL CHECK(evidence_fragment_canonical_version=1), evidence_fragment_canonical_hash TEXT NOT NULL CHECK(evidence_fragment_canonical_hash ~ '^[0-9a-f]{64}$'), assessment_result JSONB NOT NULL, method_provenance JSONB NOT NULL, relation TEXT GENERATED ALWAYS AS (assessment_result ->> 'relation') STORED, method_type TEXT GENERATED ALWAYS AS (method_provenance ->> 'methodType') STORED, assessed_at TIMESTAMPTZ(6) NOT NULL, CONSTRAINT chk_rcv022_assessment_relation CHECK (relation IN ('SUPPORTS','REFUTES','INSUFFICIENT','UNRELATED')), CONSTRAINT chk_rcv022_assessment_method_type CHECK (method_type IN ('DETERMINISTIC','MODEL_ASSISTED','HUMAN','MIXED'))
);

CREATE TABLE public.rcv022_semantic_analysis_envelopes (
  envelope_id UUID NOT NULL PRIMARY KEY, canonical_version INTEGER NOT NULL CHECK(canonical_version=1), canonical TEXT NOT NULL, canonical_hash TEXT NOT NULL CHECK(canonical_hash ~ '^[0-9a-f]{64}$'), claim_id UUID NOT NULL, claim_canonical_version INTEGER NOT NULL CHECK(claim_canonical_version=1), claim_canonical_hash TEXT NOT NULL CHECK(claim_canonical_hash ~ '^[0-9a-f]{64}$'), claim_version_id UUID NOT NULL, claim_version_canonical_version INTEGER NOT NULL CHECK(claim_version_canonical_version=1), claim_version_canonical_hash TEXT NOT NULL CHECK(claim_version_canonical_hash ~ '^[0-9a-f]{64}$'), analysis_cutoff_at TIMESTAMPTZ(6) NOT NULL, analysis_at TIMESTAMPTZ(6) NOT NULL, match_refs JSONB NOT NULL, assessment_refs JSONB NOT NULL, analysis_method_identity TEXT NOT NULL, analysis_method_version TEXT NOT NULL, analysis_method_hash TEXT NOT NULL CHECK(analysis_method_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.rcv022_envelope_match_refs (
  envelope_id UUID NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>=0), match_id UUID NOT NULL, match_canonical_version INTEGER NOT NULL CHECK(match_canonical_version=1), match_canonical_hash TEXT NOT NULL CHECK(match_canonical_hash ~ '^[0-9a-f]{64}$'), PRIMARY KEY(envelope_id,ordinal), UNIQUE(envelope_id,match_id)
);
CREATE TABLE public.rcv022_envelope_assessment_refs (
  envelope_id UUID NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>=0), assessment_id UUID NOT NULL, assessment_canonical_version INTEGER NOT NULL CHECK(assessment_canonical_version=1), assessment_canonical_hash TEXT NOT NULL CHECK(assessment_canonical_hash ~ '^[0-9a-f]{64}$'), PRIMARY KEY(envelope_id,ordinal), UNIQUE(envelope_id,assessment_id)
);

ALTER TABLE public.rcv022_evidence_fragments ADD CONSTRAINT fk_rcv022_fragment_capture FOREIGN KEY(capture_id) REFERENCES public.rcv020_captures(capture_id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE public.rcv022_claim_evidence_matches ADD CONSTRAINT fk_rcv022_match_claim FOREIGN KEY(claim_id) REFERENCES public.claim_identity_authorities(claim_id) ON DELETE NO ACTION ON UPDATE NO ACTION, ADD CONSTRAINT fk_rcv022_match_claim_version FOREIGN KEY(claim_version_id) REFERENCES public.claim_version_authorities(claim_version_id) ON DELETE NO ACTION ON UPDATE NO ACTION, ADD CONSTRAINT fk_rcv022_match_fragment FOREIGN KEY(evidence_fragment_id) REFERENCES public.rcv022_evidence_fragments(fragment_id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE public.rcv022_evidence_assessments ADD CONSTRAINT fk_rcv022_assessment_match FOREIGN KEY(claim_evidence_match_id) REFERENCES public.rcv022_claim_evidence_matches(match_id) ON DELETE NO ACTION ON UPDATE NO ACTION, ADD CONSTRAINT fk_rcv022_assessment_claim FOREIGN KEY(claim_id) REFERENCES public.claim_identity_authorities(claim_id) ON DELETE NO ACTION ON UPDATE NO ACTION, ADD CONSTRAINT fk_rcv022_assessment_claim_version FOREIGN KEY(claim_version_id) REFERENCES public.claim_version_authorities(claim_version_id) ON DELETE NO ACTION ON UPDATE NO ACTION, ADD CONSTRAINT fk_rcv022_assessment_fragment FOREIGN KEY(evidence_fragment_id) REFERENCES public.rcv022_evidence_fragments(fragment_id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE public.rcv022_semantic_analysis_envelopes ADD CONSTRAINT fk_rcv022_envelope_claim FOREIGN KEY(claim_id) REFERENCES public.claim_identity_authorities(claim_id) ON DELETE NO ACTION ON UPDATE NO ACTION, ADD CONSTRAINT fk_rcv022_envelope_claim_version FOREIGN KEY(claim_version_id) REFERENCES public.claim_version_authorities(claim_version_id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE public.rcv022_envelope_match_refs ADD CONSTRAINT fk_rcv022_match_ref_envelope FOREIGN KEY(envelope_id) REFERENCES public.rcv022_semantic_analysis_envelopes(envelope_id) ON DELETE NO ACTION ON UPDATE NO ACTION, ADD CONSTRAINT fk_rcv022_match_ref_match FOREIGN KEY(match_id) REFERENCES public.rcv022_claim_evidence_matches(match_id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE public.rcv022_envelope_assessment_refs ADD CONSTRAINT fk_rcv022_assessment_ref_envelope FOREIGN KEY(envelope_id) REFERENCES public.rcv022_semantic_analysis_envelopes(envelope_id) ON DELETE NO ACTION ON UPDATE NO ACTION, ADD CONSTRAINT fk_rcv022_assessment_ref_assessment FOREIGN KEY(assessment_id) REFERENCES public.rcv022_evidence_assessments(assessment_id) ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE OR REPLACE FUNCTION public.rcv022_validate_envelope_membership_commit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e RECORD; a JSONB; n INTEGER; i INTEGER; s RECORD; ass RECORD; mid UUID;
BEGIN
  SELECT * INTO e FROM public.rcv022_semantic_analysis_envelopes WHERE envelope_id=NEW.envelope_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing Envelope membership parent' USING ERRCODE='23503'; END IF;
  n:=jsonb_array_length(e.match_refs);
  IF (SELECT count(*) FROM public.rcv022_envelope_match_refs WHERE envelope_id=e.envelope_id)<>n THEN RAISE EXCEPTION 'match membership parity failure' USING ERRCODE='23514'; END IF;
  FOR i IN 0..n-1 LOOP
    a:=e.match_refs->i; SELECT * INTO s FROM public.rcv022_envelope_match_refs WHERE envelope_id=e.envelope_id AND ordinal=i;
    IF NOT FOUND OR s.match_id::TEXT IS DISTINCT FROM a->>'id' OR s.match_canonical_version IS DISTINCT FROM (a->>'canonicalVersion')::INTEGER OR s.match_canonical_hash IS DISTINCT FROM a->>'canonicalHash' THEN RAISE EXCEPTION 'match membership parity failure' USING ERRCODE='23514'; END IF;
  END LOOP;
  n:=jsonb_array_length(e.assessment_refs);
  IF (SELECT count(*) FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=e.envelope_id)<>n THEN RAISE EXCEPTION 'assessment membership parity failure' USING ERRCODE='23514'; END IF;
  FOR i IN 0..n-1 LOOP
    a:=e.assessment_refs->i; SELECT * INTO s FROM public.rcv022_envelope_assessment_refs WHERE envelope_id=e.envelope_id AND ordinal=i;
    IF NOT FOUND OR s.assessment_id::TEXT IS DISTINCT FROM a->>'id' OR s.assessment_canonical_version IS DISTINCT FROM (a->>'canonicalVersion')::INTEGER OR s.assessment_canonical_hash IS DISTINCT FROM a->>'canonicalHash' THEN RAISE EXCEPTION 'assessment membership parity failure' USING ERRCODE='23514'; END IF;
    SELECT claim_evidence_match_id INTO mid FROM public.rcv022_evidence_assessments WHERE assessment_id=s.assessment_id;
    IF NOT FOUND OR (SELECT count(*) FROM public.rcv022_envelope_match_refs WHERE envelope_id=e.envelope_id AND match_id=mid)<>1 THEN RAISE EXCEPTION 'assessment Match closure failure' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_rcv022_validate_envelope_membership_on_envelope AFTER INSERT ON public.rcv022_semantic_analysis_envelopes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rcv022_validate_envelope_membership_commit();
CREATE CONSTRAINT TRIGGER trg_rcv022_validate_envelope_membership_on_match_ref AFTER INSERT ON public.rcv022_envelope_match_refs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rcv022_validate_envelope_membership_commit();
CREATE CONSTRAINT TRIGGER trg_rcv022_validate_envelope_membership_on_assessment_ref AFTER INSERT ON public.rcv022_envelope_assessment_refs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rcv022_validate_envelope_membership_commit();

CREATE TRIGGER trg_rcv022_validate_fragment_insert_projection BEFORE INSERT ON public.rcv022_evidence_fragments FOR EACH ROW EXECUTE FUNCTION public.rcv022_validate_authority_projection();
CREATE TRIGGER trg_rcv022_validate_match_insert_projection BEFORE INSERT ON public.rcv022_claim_evidence_matches FOR EACH ROW EXECUTE FUNCTION public.rcv022_validate_authority_projection();
CREATE TRIGGER trg_rcv022_validate_assessment_insert_projection BEFORE INSERT ON public.rcv022_evidence_assessments FOR EACH ROW EXECUTE FUNCTION public.rcv022_validate_authority_projection();
CREATE TRIGGER trg_rcv022_validate_envelope_insert_projection BEFORE INSERT ON public.rcv022_semantic_analysis_envelopes FOR EACH ROW EXECUTE FUNCTION public.rcv022_validate_authority_projection();

CREATE TRIGGER trg_rcv022_immutable_evidence_fragments BEFORE UPDATE OR DELETE ON public.rcv022_evidence_fragments FOR EACH ROW EXECUTE FUNCTION public.rcv022_guard_immutable();
CREATE TRIGGER trg_rcv022_immutable_claim_evidence_matches BEFORE UPDATE OR DELETE ON public.rcv022_claim_evidence_matches FOR EACH ROW EXECUTE FUNCTION public.rcv022_guard_immutable();
CREATE TRIGGER trg_rcv022_immutable_evidence_assessments BEFORE UPDATE OR DELETE ON public.rcv022_evidence_assessments FOR EACH ROW EXECUTE FUNCTION public.rcv022_guard_immutable();
CREATE TRIGGER trg_rcv022_immutable_semantic_analysis_envelopes BEFORE UPDATE OR DELETE ON public.rcv022_semantic_analysis_envelopes FOR EACH ROW EXECUTE FUNCTION public.rcv022_guard_immutable();
CREATE TRIGGER trg_rcv022_immutable_envelope_match_refs BEFORE UPDATE OR DELETE ON public.rcv022_envelope_match_refs FOR EACH ROW EXECUTE FUNCTION public.rcv022_guard_immutable();
CREATE TRIGGER trg_rcv022_immutable_envelope_assessment_refs BEFORE UPDATE OR DELETE ON public.rcv022_envelope_assessment_refs FOR EACH ROW EXECUTE FUNCTION public.rcv022_guard_immutable();

COMMIT;
