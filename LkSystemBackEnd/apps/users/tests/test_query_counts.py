"""
Performance regression tests: the user-list endpoint must not issue a query
per row (N+1). We assert the query count stays constant as the number of
users grows.

Run with::

    python manage.py test apps.users.tests.test_query_counts
"""

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

User = get_user_model()

USERS_URL = '/api/v1/users/'


class UserListQueryCountTests(TestCase):
    def setUp(self):
        # A platform admin with no company selected lists every user (global).
        self.root = User.objects.create(
            matricule='ROOT', email='root@t.test',
            is_superuser=True, is_staff=True, is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.root)

    def _make_users(self, count, start):
        User.objects.bulk_create([
            User(matricule=f'U{start + i}', email=f'u{start + i}@t.test', is_active=True)
            for i in range(count)
        ])

    def _list_query_count(self):
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get(USERS_URL)
            self.assertEqual(res.status_code, 200)
        return len(ctx.captured_queries)

    def test_user_list_query_count_does_not_grow_per_user(self):
        self._make_users(3, 0)          # 3 + root = 4 users (one page)
        baseline = self._list_query_count()

        self._make_users(4, 100)        # +4 more = 8 users (still one page)
        grown = self._list_query_count()

        # Adding users must NOT add queries — that is the signature of an N+1.
        self.assertEqual(
            baseline, grown,
            f'N+1 regression on user list: {baseline} queries -> {grown} queries',
        )
