# Scoring, Rubric, and Escalation Configuration

Status: Version 1 defaults are proposals for coach/instructor calibration, not empirical hiring predictors.

## Match score

Configuration: [`scoring.v1.json`](../../backend/config/scoring.v1.json).

The score is an indicative preparation assessment from 0 to 100. It is not a hiring recommendation, employability measure, or probability of selection.

| Component | Weight |
|---|---:|
| Required skill coverage | 0.50 |
| Preferred skill coverage | 0.15 |
| Responsibility evidence | 0.15 |
| Experience alignment | 0.10 |
| Evidence quality | 0.10 |

Weights sum to 1.0. Domain code computes a weighted arithmetic mean, clamps to 0-100, and rounds to an integer. The LLM may identify candidate evidence, but it does not calculate the score.

For skill evidence, `matched = 1`, `partial = 0.5`, and `no evidence found = 0`. A resume omission is not proof that the candidate lacks a skill. Experience alignment can only use explicit source evidence; unknown/unstated experience is not silently treated as zero experience. The exact normalization and treatment of unknown components must be tested with golden examples before release.

## Interview answer rubric

Configuration: [`rubric.v1.json`](../../backend/config/rubric.v1.json).

Five equal-weight dimensions use a 0-4 anchored scale:

- relevance
- completeness
- reasoning
- examples
- communication

The overall score is the weighted mean and is returned with its dimension breakdown. Feedback must coach the answer, not infer protected traits or hiring outcomes. Example answers are explicitly illustrative and must not be attributed to the candidate.

## Review escalation thresholds

Configuration: [`review-thresholds.v1.json`](../../backend/config/review-thresholds.v1.json).

Proposed defaults flag confidence below `0.70`, sample `5%` of eligible outputs, and always flag evidence failures, fabrication checks, possible protected-trait references, candidate review requests, and candidate disputes. Sampling applies only where it is lawful and useful; it must not be used to mask deterministic guardrail failures.

Outputs are released immediately only with the label "AI-generated, not yet reviewed." Escalation decisions and threshold/config versions are auditable.

## Change control and calibration

- Configuration files are immutable by version; changes create a new version.
- Every result records the score/rubric/threshold version used.
- Admin edits are schema validated and audited; secrets/provider credentials are never part of these files.
- The initial numbers are proposed defaults. Validate with instructor/coach review and a representative, consented evaluation set before using them in a demo that could influence candidate decisions.
