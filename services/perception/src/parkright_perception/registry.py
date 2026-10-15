"""Providers selectable with PARKRIGHT_PERCEPTION_PROVIDER. Detector arms register here.

A provider may run in-process (e.g. ONNX/TensorRT on the API host's GPU) or be an
adapter to a remote inference endpoint (e.g. on Nebius). Either way it implements
PerceptionProvider and the camera contract does not change.
"""

from collections.abc import Callable

from .provider import PerceptionProvider
from .providers.uncertain import UncertainProvider

_PROVIDERS: dict[str, Callable[[], PerceptionProvider]] = {
    "none": UncertainProvider,
}


def available_providers() -> list[str]:
    return sorted(_PROVIDERS)


def create_provider(name: str) -> PerceptionProvider:
    try:
        factory = _PROVIDERS[name]
    except KeyError:
        raise ValueError(f'unknown perception provider "{name}"; known: {", ".join(available_providers())}') from None
    return factory()
