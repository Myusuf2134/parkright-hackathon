import asyncio
from datetime import datetime, timezone

import httpx

from parkright_api.routes.your_day import approved_nws_url, fetch_campus_forecast

NOW = datetime(2026, 11, 8, 16, 0, tzinfo=timezone.utc)


def test_only_official_https_urls():
    assert approved_nws_url("https://api.weather.gov/gridpoints/ILN/50,75/forecast")
    assert not approved_nws_url("http://api.weather.gov/gridpoints/ILN/50,75/forecast")
    assert not approved_nws_url("https://api.weather.gov.attacker.example/collect")
    assert not approved_nws_url("https://api.weather.gov:8443/path")


def test_official_forecast_is_returned():
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/points/"):
            return httpx.Response(200, json={"properties": {"forecast": "https://api.weather.gov/gridpoints/ILN/50,75/forecast"}})
        return httpx.Response(200, json={"properties": {"periods": [{
            "startTime": "2026-11-08T10:00:00-05:00",
            "endTime": "2026-11-08T18:00:00-05:00",
            "temperature": 52, "temperatureUnit": "F", "shortForecast": "Partly cloudy",
        }]}})

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            result = await fetch_campus_forecast(client, NOW)
        assert result.status == "available"
        assert result.temperature_f == 52
        assert result.summary == "Partly cloudy"
        assert result.source_url.startswith("https://api.weather.gov/")
    asyncio.run(check())


def test_untrusted_forecast_url_is_rejected():
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"properties": {"forecast": "https://api.weather.gov.attacker.example/collect"}})

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            result = await fetch_campus_forecast(client, NOW)
        assert result.status == "unavailable"
        assert result.temperature_f is None
    asyncio.run(check())


def test_weather_outage_does_not_invent_weather():
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            result = await fetch_campus_forecast(client, NOW)
        assert result.status == "unavailable"
        assert result.summary is None
        assert result.temperature_f is None
    asyncio.run(check())
