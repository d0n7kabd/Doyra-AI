from .features import FEATURE_NAMES, extract_features

__all__ = ["FEATURE_NAMES", "extract_features", "Predictor"]


def __getattr__(name: str):
    # Lazy import so `python -m doyra_ai.train` / `-m doyra_ai.infer`
    # don't re-import their own module as a side effect of package init.
    if name == "Predictor":
        from .infer import Predictor

        return Predictor
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
