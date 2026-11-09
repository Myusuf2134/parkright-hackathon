"""Read-only official campus weather for Meridian's Your Day agent.

Never accepts or transmits student classes, identity, or precise location.
The queried location is a public fixed OSU campus point.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(tags=["Your Day"])
OSU_POINT = "40.0022,-83.0150"
BASE = "https://api.weather.gov"
USER_AGENT = "MeridianYourDay/0.1 (+https://github.com/Myusuf2134/parkright-hackathon)"


class CampusWeather(BaseModel):
    status: Literal["available", "unavailable"]
    kind: Literal["forecast"] = "forecast"
    location: str = "Ohio State University, Columbus, Ohio"
    source: str = "National Weather Service"
    checked_at: datetime
    expires_at: datetime | None = None
    forecast_at: datetime | None = None
    temperature_f: int | None = None
    summary: str | None = None
    source_url: str | None = None
    reason: str | None = None


def approved_nws_url(url: str) -> bool:
    parts = urlsplit(url)
    return (
        parts.scheme == "https"
        and parts.hostname == "api.weather.gov"
        and parts.port in (None, 443)
        and not parts.username
        and not parts.password
    )


async def fetch_campus_forecast(client: httpx.AsyncClient, checked_at: datetime) -> CampusWeather:
    """A real provider result or an explicit unavailable state; no synthesized weather."""
    opts = {"headers": {"User-Agent": USER_AGENT, "Accept": "application/geo+json"}, "timeout": 8.0}
    try:
        points = await client.get(f"{BASE}/points/{OSU_POINT}", **opts)
        points.raise_for_status()
        forecast_url = points.json()["properties"]["forecast"]
        if not isinstance(forecast_url, str) or not approved_nws_url(forecast_url):
            raise ValueError("NWS returned a non-NWS URL")
        forecast = await client.get(forecast_url, **opts)
        forecast.raise_for_status()
        periods = forecast.json()["properties"]["periods"]
        if not isinstance(periods, list) or not periods:
            raise ValueError("NWS forecast periods missing")

        def is_current(period: dict) -> bool:
            try:
                start = datetime.fromisoformat(period["startTime"])
                end = datetime.fromisoformat(period["endTime"])
                return start <= checked_at < end
            except (ValueError, KeyError, TypeError):
                return False

        period = next((p for p in periods if isinstance(p, dict) and is_current(p)), periods[0])
        start = datetime.fromisoformat(period["startTime"])
        temperature = period["temperature"]
        summary = period["shortForecast"]
        if (
            not isinstance(temperature, (int, float))
            or period.get("temperatureUnit") != "F"
            or not isinstance(summary, str)
            or not summary.strip()
        ):
            raise ValueError("Unsupported NWS forecast data")
        return CampusWeather(
            status="available", checked_at=checked_at,
            expires_at=checked_at + timedelta(minutes=10),
            forecast_at=start, temperature_f=round(temperature),
            summary=summary.strip()[:160], source_url=forecast_url,
        )
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
        return CampusWeather(
            status="unavailable", checked_at=checked_at,
            reason="Official campus forecast temporarily unavailable",
        )


@router.get("/your-day/campus-weather", response_model=CampusWeather)
async def campus_weather(request: Request) -> CampusWeather:
    now = datetime.now(timezone.utc)
    cached: CampusWeather | None = getattr(request.app.state, "your_day_weather", None)
    if cached and cached.expires_at and cached.expires_at > now:
        return cached

    lock: asyncio.Lock | None = getattr(request.app.state, "your_day_weather_lock", None)
    if lock is None:
        lock = asyncio.Lock()
        request.app.state.your_day_weather_lock = lock
    async with lock:
        now = datetime.now(timezone.utc)
        cached = getattr(request.app.state, "your_day_weather", None)
        if cached and cached.expires_at and cached.expires_at > now:
            return cached
        async with httpx.AsyncClient(follow_redirects=False) as client:
            result = await fetch_campus_forecast(client, now)
        # Even an outage is rate-limited: no requests per browser/client.
        if result.status == "unavailable":
            result.expires_at = now + timedelta(seconds=60)
        request.app.state.your_day_weather = result
        return result
