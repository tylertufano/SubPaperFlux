"""Instapaper publication helpers extracted from the legacy SubPaperFlux module."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from requests_oauthlib import OAuth1Session

from .subpaperflux_rss import sanitize_html_content

INSTAPAPER_ADD_URL = "https://www.instapaper.com/api/1.1/bookmarks/add"


def publish_to_instapaper(
    instapaper_config: Dict[str, Any],
    app_creds: Dict[str, Any],
    url: str,
    title: Optional[str],
    raw_html_content: Optional[str],
    categories_from_feed: Optional[list[str]],
    instapaper_ini_config: Any,
    site_config: Optional[Dict[str, Any]],
    *,
    resolve_final_url: bool = True,
) -> Optional[Dict[str, Any]]:
    try:
        consumer_key = app_creds.get("consumer_key")
        consumer_secret = app_creds.get("consumer_secret")
        oauth_token = instapaper_config.get("oauth_token")
        oauth_token_secret = instapaper_config.get("oauth_token_secret")

        if not all([consumer_key, consumer_secret, oauth_token, oauth_token_secret]):
            logging.error("Incomplete Instapaper credentials. Cannot publish.")
            return None

        oauth = OAuth1Session(
            consumer_key,
            client_secret=consumer_secret,
            resource_owner_key=oauth_token,
            resource_owner_secret=oauth_token_secret,
        )

        payload = {
            "url": url,
            "title": title,
        }

        sanitize_content_flag = instapaper_ini_config.getboolean(
            "sanitize_content", fallback=True
        )
        processed_content = raw_html_content

        if raw_html_content:
            if sanitize_content_flag:
                logging.debug("Content sanitization is explicitly ENABLED.")
                sanitizing_criteria: list[str] = []

                ini_custom_criteria = instapaper_ini_config.get(
                    "custom_sanitizing_criteria"
                )
                site_custom_criteria = (
                    site_config.get("sanitizing_criteria") if site_config else None
                )

                if ini_custom_criteria:
                    logging.info(
                        "Using custom sanitizing criteria from INI file. This overrides any site configuration."
                    )
                    if isinstance(ini_custom_criteria, str):
                        sanitizing_criteria = [
                            s.strip()
                            for s in ini_custom_criteria.split(",")
                            if s.strip()
                        ]
                    else:
                        sanitizing_criteria = list(ini_custom_criteria)
                elif site_custom_criteria:
                    logging.info(
                        "Using custom sanitizing criteria from site configuration."
                    )
                    sanitizing_criteria = [
                        s.strip() for s in site_custom_criteria if s.strip()
                    ]
                else:
                    logging.info(
                        "Using default sanitizing criteria: removing img tags."
                    )
                    sanitizing_criteria = ["img"]

                processed_content = sanitize_html_content(
                    raw_html_content, sanitizing_criteria
                )
            else:
                logging.debug(
                    "Content sanitization is explicitly DISABLED. Including raw HTML content."
                )

            payload["content"] = processed_content
            logging.debug(
                "Payload includes HTML content (truncated): %s...",
                (payload["content"] or "")[:100],
            )
        else:
            logging.debug(
                "Payload does not include HTML content. Instapaper will attempt to resolve the URL."
            )

        if not resolve_final_url:
            payload["resolve_final_url"] = "0"

        add_default_tag_flag = instapaper_ini_config.getboolean(
            "add_default_tag", fallback=True
        )
        add_categories_as_tags_flag = instapaper_ini_config.getboolean(
            "add_categories_as_tags", fallback=False
        )
        tags_string = instapaper_ini_config.get("tags", "")

        user_defined_tags = [tag.strip() for tag in tags_string.split(",") if tag.strip()]
        category_tags = []
        if add_categories_as_tags_flag and categories_from_feed:
            logging.debug("Adding categories as tags: %s", categories_from_feed)
            category_tags = list(set(categories_from_feed))
        default_tags = ["RSS"] if add_default_tag_flag else []

        final_tags = user_defined_tags + category_tags + default_tags
        if final_tags:
            tags_list = [{"name": tag} for tag in final_tags]
            payload["tags"] = json.dumps(tags_list)
            logging.debug("Formatted tags being sent: '%s'.", payload["tags"])
        else:
            logging.debug("No tags will be added to this bookmark.")

        folder_id = instapaper_ini_config.get("folder_id")
        if folder_id:
            payload["folder_id"] = folder_id

        logging.debug("Publishing URL: %s", url)
        logging.debug("Publishing Title: %s", title)

        if "resolve_final_url" in payload:
            logging.debug("'resolve_final_url' parameter is set to '0'.")
        else:
            logging.debug("'resolve_final_url' parameter is not explicitly set.")
        if folder_id:
            logging.debug("Folder ID being used: '%s'.", folder_id)

        logging.debug("Payload being sent to Instapaper: %s", payload)

        response = oauth.post(INSTAPAPER_ADD_URL, data=payload)
        response.raise_for_status()

        logging.debug("Raw response text from Instapaper: %s", response.text)
        content_location = response.headers.get("Content-Location")
        logging.debug("Content-Location header: %s", content_location)

        response_json = response.json()
        bookmark_id = None
        for item in response_json:
            if item.get("type") == "bookmark":
                bookmark_id = item.get("bookmark_id")
                break

        if bookmark_id:
            logging.info(
                "Successfully published '%s' to Instapaper. Bookmark ID: %s",
                title,
                bookmark_id,
            )
            logging.debug(
                "Instapaper API Response Status: %s",
                response.status_code,
            )
            return {
                "bookmark_id": bookmark_id,
                "content_location": content_location,
                "title": title,
            }

        logging.error(
            "Failed to retrieve bookmark_id from successful response for '%s'.",
            title,
        )
        return None

    except Exception as exc:  # noqa: BLE001
        logging.error("Error publishing to Instapaper: %s", exc)
        if "response" in locals():
            logging.debug("Instapaper API Response Text: %s", response.text)
        return None
