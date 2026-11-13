from datetime import datetime, timedelta, timezone
import unittest
from delivery_rules import (
    SubscriptionState, normalize_language, has_book_entitlement,
    eligible_edition, delivery_key,
)

NOW = datetime(2026, 11, 13, tzinfo=timezone.utc)

class MembershipRulesTests(unittest.TestCase):
    def test_languages(self):
        self.assertEqual(normalize_language("pt"), "pt-PT")
        self.assertEqual(normalize_language("de-DE"), "de")
        self.assertEqual(normalize_language("EN_us"), "en")
        self.assertEqual(normalize_language(None), "en")

    def test_active(self):
        s = SubscriptionState("active", NOW + timedelta(days=2))
        self.assertTrue(has_book_entitlement(s, NOW))

    def test_cancelled_but_paid_through(self):
        s = SubscriptionState("active", NOW + timedelta(days=1), True)
        self.assertTrue(has_book_entitlement(s, NOW))
        self.assertFalse(has_book_entitlement(s, NOW + timedelta(days=2)))

    def test_unpaid_not_entitled(self):
        for status in ("past_due", "unpaid", "canceled", "incomplete"):
            s = SubscriptionState(status, NOW + timedelta(days=2))
            self.assertFalse(has_book_entitlement(s, NOW))
        self.assertFalse(has_book_entitlement(None, NOW))

    def test_missing_edition_blocks_send(self):
        self.assertFalse(eligible_edition("pt-PT", None, "published"))
        self.assertFalse(eligible_edition("de", NOW, "draft"))
        self.assertTrue(eligible_edition("de", NOW, "published"))

    def test_deduplication_key(self):
        self.assertEqual(delivery_key("r1", "m1", "release"), "r1:m1:release")
        with self.assertRaises(ValueError):
            delivery_key("r1", "m1", "bad")

if __name__ == "__main__":
    unittest.main()
