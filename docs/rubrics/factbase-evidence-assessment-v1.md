# FactBase Evidence Assessment Rubric, Version 1

Rubric ID: `factbase-evidence-assessment`
Rubric version: `1`

This document is the immutable semantic contract for assessments carrying this
rubric ID and version. Its meaning must never be changed retroactively. A future
semantic change requires a new rubric version.

The five dimensions are independent observations. They must not be aggregated,
averaged, weighted, ranked, or converted into a truth score or degree of proof.
Assessment method and initiator do not add a bonus, penalty, or weight. Evidence
relations and assessment-response relations are not numerical inputs.

`NULL` always means not assessed or not determinable from the documented
information. It never means zero. The rationale must make the
applicable reason clear. Values from 0 through 1 are calibrated anchors, not a
claim that mathematical distances between values are linear.

## sourceQuality

The documented source artifact's authenticity, transparency, methodological
care, verifiability, data integrity, and traceable origin. It does not include
relevance, directness, recency, independence, agreement with the claim, or the
assessment method.

- `0`: demonstrably manipulated, methodologically unusable, or not verifiable.
- `0.25`: severe documented quality defects and very limited verifiability.
- `0.5`: material strengths and material weaknesses coexist.
- `0.75`: mostly transparent and methodologically robust with limited defects.
- `1`: fully authenticated, transparent, methodologically robust, and verifiable.
- `NULL`: source quality was not assessed or cannot be determined.

## relevance

How much the evidence content matters to the exact subject, predicate, scope,
definitions, place, and time of this claim version. Direction is separate: a
contradicting item can be fully relevant.

- `0`: concerns a different proposition or incompatible scope.
- `0.25`: addresses only a peripheral aspect.
- `0.5`: addresses a material but incomplete part.
- `0.75`: addresses most of the proposition and scope.
- `1`: exactly addresses the full proposition and scope.
- `NULL`: relevance was not assessed or cannot be determined.

## directness

How immediately the evidence observes, measures, records, or logically addresses
this claim version, expressed as inferential distance. It does not measure source
quality, relevance, recency, independence, or agreement with the claim.

- `0`: only a remote analogy or proxy without a robust direct connection.
- `0.25`: requires several material and uncertain inference steps.
- `0.5`: contains direct material but still requires a significant inference.
- `0.75`: nearly direct, with one limited inference step.
- `1`: directly observes, measures, or records the exact proposition.
- `NULL`: directness was not assessed or cannot be determined.

## recency

The evidence's temporal fitness for this claim version relative to a persisted
reference type and instant. Newer is not automatically better. `current_state_at`
evaluates a state at the reference instant, `event_at` an event at its reference
instant, and `period_ending_at` a period relative to its end. Time-independent
claims receive no recency assessment. Retrieval time alone is not observation
or publication time.

- `0`: demonstrably incompatible with the temporal reference.
- `0.25`: strongly outdated or only weakly transferable.
- `0.5`: partly fitting, with a material temporal gap.
- `0.75`: well aligned, with a small and justified temporal gap.
- `1`: exactly aligned or sufficiently current for the documented rate of change.
- `NULL`: not assessed or indeterminable without a valid reference.

## independence

Independence from the explicitly persisted comparison set of other evidence
relations belonging to the same claim version, considering origin, data,
authorship, funding, control, and derivation chains. Different URLs, publishers,
wording, or conclusions do not by themselves prove independence.

- `0`: demonstrably the same origin chain or a pure republication.
- `0.25`: predominantly shares origin, data, or control.
- `0.5`: contains both shared and independent origin or work.
- `0.75`: predominantly independent with a limited shared dependency.
- `1`: demonstrably separate origin, data, and control chains from the full set.
- `NULL`: no independence assessment exists or provenance cannot be determined.

Method provenance identifiers for rules, models, workflows, prompts, imports, or
external records document what an assessment reports as its production context.
Version 1 does not create corresponding registry entities or foreign keys, so
those external identities are not database-verified and model metadata does not
guarantee bit-for-bit deterministic reproduction.
