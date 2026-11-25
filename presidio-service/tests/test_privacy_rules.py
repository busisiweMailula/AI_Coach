import pytest

from app import anonymize_text, build_engines, is_valid_person_span, is_valid_sa_id_number


@pytest.fixture(scope="module")
def engines():
    return build_engines()


def test_masks_only_the_four_supported_pii_types(engines):
    analyzer, anonymizer = engines
    text = (
        "Sipho Dlamini | sipho.dlamini@example.com | +27 71 234 5678 | "
        "071 234 5678 | SA ID 8001015009087"
    )

    result = anonymize_text(text, analyzer, anonymizer)

    for placeholder in ["<PERSON>", "<EMAIL_ADDRESS>", "<PHONE_NUMBER>", "<ZA_ID_NUMBER>"]:
        assert placeholder in result
    assert "Sipho Dlamini" not in result
    assert "sipho.dlamini@example.com" not in result
    assert "+27 71 234 5678" not in result
    assert "071 234 5678" not in result
    assert "8001015009087" not in result


@pytest.mark.parametrize(
    "number",
    [
        "071 234 5678",
        "0712345678",
        "+27 71 234 5678",
        "+27712345678",
        "(071) 234-5678",
        "+27 (71) 234-5678",
    ],
)
def test_masks_south_african_mobile_formats(engines, number):
    analyzer, anonymizer = engines

    result = anonymize_text(f"Mobile: {number}", analyzer, anonymizer)

    assert "<PHONE_NUMBER>" in result
    assert number not in result


def test_preserves_non_pii_cv_content(engines):
    analyzer, anonymizer = engines
    text = (
        "TypeScript, Node.js, Python, Docker, Chroma, Embeddings, JSON outputs, "
        "REST APIs, webhooks, AWS, Google, Capitec, University of Cape Town, "
        "University of Johannesburg, University of Pretoria, Wits University, "
        "Stellenbosch University, Johannesburg, Pretoria, South Africa, "
        "English (fluent), Afrikaans (fluent), Zulu (fluent), 2021 - 2024, 75%, v1.2.3."
    )

    result = anonymize_text(text, analyzer, anonymizer)

    assert result == text


def test_rejects_thirteen_digit_values_that_are_not_valid_sa_ids(engines):
    analyzer, anonymizer = engines
    invalid = "9001010000000"

    result = anonymize_text(f"Reference: {invalid}", analyzer, anonymizer)

    assert invalid in result
    assert "<ZA_ID_NUMBER>" not in result
    assert is_valid_sa_id_number("8001015009087")
    assert not is_valid_sa_id_number(invalid)


def test_person_span_filter_rejects_low_confidence_single_lowercase_or_symbolic_values():
    assert is_valid_person_span("Jane Doe", 0.6)
    assert not is_valid_person_span("Jane Doe", 0.59)
    assert not is_valid_person_span("candidate", 0.9)
    assert not is_valid_person_span("Jane Doe2", 0.9)
    assert not is_valid_person_span("Jane-Doe", 0.9)

