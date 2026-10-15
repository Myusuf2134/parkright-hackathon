"""Identifiers that travel on the wire.

Deliberately narrow: letters, digits, ``.``, ``_``, ``-``, starting with a letter
or digit, at most 64 characters, never ``..``. Safe in URLs, file names, log
lines and dictionary keys.
"""

from typing import Annotated

from pydantic import AfterValidator, AwareDatetime, StringConstraints

IDENTIFIER_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"


def _no_dot_dot(value: str) -> str:
    if ".." in value:
        raise ValueError('must not contain ".."')
    return value


Identifier = Annotated[str, StringConstraints(pattern=IDENTIFIER_PATTERN), AfterValidator(_no_dot_dot)]

CameraId = Identifier
"""A camera's stable identity, e.g. ``cam-01``."""
SessionId = Identifier
"""One run of a camera stream. A new session_id means seq restarted."""
SpaceId = Identifier
"""A space's id, unique within its facility, e.g. ``A7``."""
LevelId = Identifier
"""A level's id, unique within its facility, e.g. ``L1``."""
FacilityId = Identifier
"""A facility's id, e.g. ``garage-01``."""

Timestamp = AwareDatetime
"""ISO-8601 with an explicit offset or ``Z``. Naive timestamps are rejected."""
