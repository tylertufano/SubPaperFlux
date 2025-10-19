"""Miniflux integration helpers extracted from the legacy SubPaperFlux module."""

from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List

import requests


def update_miniflux_feed_with_cookies(
    miniflux_config_json: Dict[str, Any],
    cookies: Iterable[Dict[str, Any]],
    *,
    config_name: str,
    feed_ids_str: str,
) -> None:
    """Update the configured Miniflux feeds with serialized cookies."""

    if not miniflux_config_json:
        logging.debug("Miniflux config missing for %s. Skipping.", config_name)
        return

    cookies = list(cookies)
    if not cookies:
        logging.warning(
            "No cookies were provided for %s. Skipping Miniflux cookie update.",
            config_name,
        )
        return

    miniflux_url = miniflux_config_json.get("miniflux_url")
    api_key = miniflux_config_json.get("api_key")

    if not all([miniflux_url, api_key, feed_ids_str]):
        logging.warning(
            "Miniflux configuration (URL, API key or feed ID) is incomplete. Skipping cookie update.",
        )
        return

    for feed_id in feed_ids_str.split(","):
        try:
            numeric_feed_id = int(feed_id.strip())
        except ValueError:
            logging.warning(
                "Invalid feed_ids format in Miniflux configuration for %s. Skipping cookie update.",
                config_name,
            )
            continue

        logging.info("Updating Miniflux Feed %s", numeric_feed_id)
        api_endpoint = f"{miniflux_url.rstrip('/')}/v1/feeds/{numeric_feed_id}"
        headers = {
            "X-Auth-Token": api_key,
            "Content-Type": "application/json",
        }
        cookie_str = "; ".join([f"{c['name']}={c['value']}" for c in cookies if c.get("name")])

        logging.debug("Updating feed %s at URL: %s", numeric_feed_id, api_endpoint)
        logging.debug("Cookies being sent: %s", cookie_str)

        payload = {"cookie": cookie_str}

        try:
            response = requests.put(
                api_endpoint, headers=headers, json=payload, timeout=20
            )
            response.raise_for_status()
            logging.info(
                "Miniflux feed %s updated successfully with new cookies.",
                numeric_feed_id,
            )
            logging.debug(
                "Miniflux API Response Status: %s",
                response.status_code,
            )
            logging.debug("Miniflux API Response Body: %s", response.json())
        except requests.exceptions.RequestException as exc:
            logging.error("Error updating Miniflux feed %s: %s", numeric_feed_id, exc)
            if "response" in locals():
                logging.debug("Miniflux API Response Text: %s", response.text)

