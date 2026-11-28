"""Conservative, local language gate for English-only post analysis."""

from functools import lru_cache
import re
import unicodedata

from langid.langid import LanguageIdentifier, model

LANGUAGE_NOTICE = (
    "This post appears to be in a language other than English. "
    "Our emotion and sentiment models support English only. "
    "Please rewrite it in English before publishing. Your draft has been kept."
)


@lru_cache(maxsize=1)
def identifier():
    # Embedded weights; no network calls or model download on submission.
    return LanguageIdentifier.from_modelstring(model, norm_probs=True)


def requires_english(text: str) -> bool:
    text = unicodedata.normalize("NFKC", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Cf")
    text = re.sub(r"https?://\S+|www\.\S+|@[\w.]+", " ", text)
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    # Clearly non-Latin writing is unsupported even when too short to classify.
    if sum("LATIN" not in unicodedata.name(c, "") for c in letters) > len(letters) / 2:
        return True
    # Avoid treating brief names, slang, and ambiguous fragments as a language.
    if len(letters) < 20:
        return False
    language, score = identifier().classify(text)
    if language == "en" or score < 0.95:
        return False
    # English can contain loanwords such as café. Require agreement after
    # removing accents before rejecting Latin-script text.
    folded = "".join(
        c for c in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(c)
    )
    if folded != text:
        folded_language, folded_score = identifier().classify(folded)
        return folded_language != "en" and folded_score >= 0.95
    return True
