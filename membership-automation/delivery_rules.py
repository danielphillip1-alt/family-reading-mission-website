"""Pure decision logic for Authors On A Mission membership delivery.

This module intentionally does not charge cards, send email, or grant access itself.
The deployed service must supply validated Stripe event data, persistent database
transactions, private file storage, and authenticated download sessions.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

LANGUAGES = ("en", "de", "pt-PT")
ALLOWED_ACCESS_STATUSES = frozenset(("active", "trialing"))


def normalize_language(value: Optional[str]) -> str:
    """Prefer explicit user selection. Do not derive from IP address."""
    aliases = {
        "en": "en", "en-us": "en", "en-gb": "en",
        "de": "de", "de-de": "de",
        "pt": "pt-PT", "pt-pt": "pt-PT", "pt_pt": "pt-PT",
    }
    if value is None:
        return "en"
    key = value.strip().lower().replace("_", "-")
    return aliases.get(key, "en")


@dataclass(frozen=True)
class SubscriptionState:
    status: str
    current_period_end: Optional[datetime]
    cancel_at_period_end: bool = False


def has_book_entitlement(subscription: Optional[SubscriptionState],
                         now: Optional[datetime] = None) -> bool:
    """Never grant from checkout redirect alone; requires Stripe-backed state.

    Active/trialing subscriptions with a known current period end are allowed.
    Cancel-at-period-end remains entitled until end. Past-due access is withheld
    until a separately approved grace policy is implemented.
    """
    if subscription is None:
        return False
    if subscription.status not in ALLOWED_ACCESS_STATUSES:
        return False
    if subscription.current_period_end is None:
        return False
    instant = now or datetime.now(timezone.utc)
    if instant.tzinfo is None or subscription.current_period_end.tzinfo is None:
        raise ValueError("Timestamp must include timezone")
    return instant < subscription.current_period_end


def eligible_edition(language: str, edition_approved_at: Optional[datetime],
                     release_status: str) -> bool:
    """Fail closed when the user's requested translation is not approved."""
    return (language in LANGUAGES and
            release_status == "published" and
            edition_approved_at is not None)


def delivery_key(release_id: str, member_id: str, kind: str) -> str:
    if kind not in ("welcome", "release"):
        raise ValueError("Unknown delivery kind")
    if not release_id or not member_id:
        raise ValueError("Missing identifier")
    return f"{release_id}:{member_id}:{kind}"
