"""
Project-wide DRF paginator.

Identical to ``PageNumberPagination`` except it honours a ``page_size``
query parameter — the stock DRF default freezes the page size at the
``PAGE_SIZE`` setting and silently ignores the client's request. That
made our "fetch everything" service helpers think pagination was done
after a single 20-row page even when ``next`` still pointed somewhere.

Capping at ``max_page_size`` keeps a malicious or naive client from
asking for tens of thousands of rows in one query.
"""

from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 500
