# Orders App — Developer Guide

> The orders app is the heart of LkSystem: it ingests sales from **WooCommerce**
> (online) and the **POS / manual desk** (in-store), drives every order through a
> single canonical lifecycle, reserves and restores stock, pushes status back to
> WooCommerce, submits to the delivery provider, issues invoices, and fans out
> real-time updates to the order board.
>
> This guide is the map. Read the **Architecture** and **Lifecycle** sections
> first; use the **File reference** as a lookup; follow **How to safely change
> things** before you touch anything.

---

## 1. Architecture at a glance

The app follows a **thin-view / service-layer** design. Responsibilities are
split so each layer has one job:

```
HTTP request
   │
   ▼
views.py ............ DRF viewset: request/response wiring, permission gates,
   │                  edit-lock enforcement, pagination, serialization.
   │                  Holds (almost) no business logic.
   ├── selectors.py .. builds read querysets (joins, queue annotations, search,
   │                   RBAC row scoping). No writes, no permission errors.
   ├── permissions.py  authorization decisions (raise / which-codename). No queries.
   ├── validators.py . coerces loose query-string / body scalars to safe types.
   │
   ▼ (writes delegate to a service)
service layer ....... one service per concern; owns the business rules,
   │                  transactions, idempotency, audit, and side effects.
   ▼
models.py ........... persistence + invariants (status enum, soft-delete manager,
                      invoice numbering, derived fields). The source of truth.

cross-cutting:  signals.py → audit  ·  realtime.py → WebSocket fan-out
                handlers.py / tasks.py → async ingestion  ·  filters.py → list filters
```

**Golden rules**

1. **One write path per concern.** Lifecycle changes go through
   `OrderStatusService` / `OrderLifecycleService`; ingestion through
   `OrderIngestionService`; invoices through `InvoiceService`. Never mutate
   `order.status` (or stock) ad-hoc in a view.
2. **`Order.status` is the only lifecycle field.** The 8-state enum on the model
   is canonical; there are no parallel status booleans.
3. **The backend enforces all authorization.** The frontend hides things for UX;
   `permissions.py` + RBAC scoping in `selectors.py` are what actually protect
   data. Every action re-checks.
4. **WooCommerce config lives in the DB** (on `SalesChannel`), never hardcoded.
5. **Local is the source of truth for status.** A failed WooCommerce push records
   a sync error and leaves a retry — it never rolls back the local change.

---

## 2. The order lifecycle

`Order.Status` has **8 canonical states**:

| state          | meaning                                            |
| -------------- | -------------------------------------------------- |
| `new`          | imported / created, awaiting confirmation          |
| `confirmed`    | confirmed by an agent, ready to fulfil             |
| `not_answered` | customer unreachable (confirmation queue)          |
| `delayed`      | postponed to `delay_date`                          |
| `packaging`    | being packed                                       |
| `done`         | fulfilled / delivered — the only "successful sale" |
| `returned`     | returned after `done`                              |
| `canceled`     | terminated                                         |

**Open / non-terminal** = everything except `done`, `returned`, `canceled`.

`status_service.py` holds the **transition matrix** — the single authority on
which moves are legal. `OrderLifecycleService` wraps each transition with its
**side effects** (stock reservation/restoration, loyalty points, WooCommerce
push, delivery, audit). Transitions are **idempotent**: re-confirming a confirmed
order is a no-op, not an error.

### Create flow
1. **Online:** WooCommerce fires an event → `handlers.py` enqueues →
   `tasks.py` → `OrderIngestionService.ingest()` maps the WC payload to an
   `Order` + `OrderLine`s (status `new`), recomputes derived fields, may
   auto-assign an agent (`OrderAssignmentService`), logs, and broadcasts.
2. **In-store / manual:** `POST /orders/pos/` or `/orders/manual/` →
   `POSOrderCreateSerializer` / `ManualOrderCreateSerializer` validate →
   `OrderIngestionService` runs the **same** persistence pipeline. POS orders are
   created already `done` (cash sale); manual orders start `new`.
3. Both paths decrement stock through the shared inventory side-effect in
   `OrderLifecycleService` so POS and WooCommerce behave identically.

### Update flow
- **Edit fields:** acquire the **edit lock** (`get_object` → `_assert_lock_available`,
  409 if another user holds it) → `OrderManagementService.edit_order()` →
  re-derive fields, audit.
- **Lifecycle move:** `POST /orders/{id}/transition/` (and the convenience
  actions: confirm / not_answered / delay / cancel / package / send_to_pos /
  process_return …) → `OrderLifecycleService` → validates via `OrderStatusService`,
  applies side effects, audits, broadcasts.
- **Invoice:** `POST|PATCH|DELETE /orders/{id}/invoice/` → `InvoiceService`
  (number allocation, duplicate guard, snapshot, audit). DELETE clears the
  invoice only — it never touches the order.

### Cancel flow
`cancel_outcome` / `transition(→ canceled)` → `OrderLifecycleService.cancel()`:
validates the move, **restores any reserved stock**, reverses loyalty points if
they were granted, writes the audit log, pushes `cancelled` to WooCommerce
(best-effort), and broadcasts. `auto_cancel_service.py` does this automatically
for orders stuck in `not_answered` past the threshold.

---

## 3. File reference

### Request layer

| file | what it does · why it exists · main symbols · how to modify safely |
| --- | --- |
| **`views.py`** (`OrderViewSet`, `OrderSyncEventViewSet`) | The HTTP surface: a `ReadOnlyModelViewSet` plus ~40 `@action`s for lifecycle, assignment, invoices, sync, bulk ops. **Reads** delegate to `selectors`; **writes** delegate to services; **auth** to `permissions`; **param parsing** to `validators`. Holds the **edit-lock** enforcement (`_LOCK_ENFORCED_ACTIONS`, `get_object`, `_assert_lock_available`) and WooCommerce fetch actions (`preview`, `sync`). *Thin wrappers* like `_scope_queryset` / `_require_permission` / `_safe_bool` simply forward to the extracted modules — keep them so the many `self._x(...)` call sites stay stable. **To add an endpoint:** add an `@action`, gate it with `self._require_permission(...)`, build its queryset via `selectors`, and call a service for any write. Don't inline business logic. |
| **`urls.py`** | Router registration: `sync-events/` → `OrderSyncEventViewSet`, `''` → `OrderViewSet` (basename `orders`). Mounted under `/api/v1/orders/`. **Stable import path** — 40+ external modules import `apps.orders.views`. |
| **`serializers.py`** | All request/response shapes: `OrderListSerializer` (list rows), `OrderDetailSerializer` (full detail), the create serializers (`POSOrderCreateSerializer`, `ManualOrderCreateSerializer`), transition/edit/lock/return serializers, and `InvoiceListSerializer` / `InvoiceMutationSerializer`. **Write-payload field validation belongs here** (not in `validators.py`). Keep serializers focused; push cross-field business rules into the service. |
| **`filters.py`** | `OrderFilterSet` — declarative list filters (status, source, channel, dates, sync status …). Add new list filters here, not as ad-hoc `request.query_params` parsing in the view. |
| **`selectors.py`** ⭐ | **Read queries live here.** `base_list_queryset()` (the canonical `select_related` join set), `with_queue_annotations()` (queue ranking used by default ordering + serializers), `apply_search()` (the staff search box, incl. digit-to-digit phone matching), `return_lookup_candidates/_q()` (barcode/QR order lookup), and the RBAC row scoping `permission_scope_q()` / `scope_orders_to_user()`. Pure, side-effect-free. **Reuse these** anywhere you need a scoped order queryset (KPIs, exports) instead of re-joining by hand. |
| **`permissions.py`** ⭐ | **Authorization decisions.** `require_order_permission(user, codename, order=None)` raises `PermissionDenied` (superuser bypass; scoped to an order's company/brand/channel when given). `permission_for_edit(order)` maps lifecycle state → the codename needed to edit. No querysets here — filtering is `selectors`' job. |
| **`validators.py`** ⭐ | **Loose-input coercion** for query-string / body scalars: `safe_int`, `safe_positive_int` (pagination clamps), `safe_bool` (flags). Stateless. Not for write-payload validation — that's the serializers. |

### Service layer (business logic)

| file | what it does · main symbols |
| --- | --- |
| **`service.py`** | `OrderIngestionService` — **the single ingestion pipeline** for *both* WooCommerce and POS/manual orders (`ingest`, `bulk_sync`). Maps source payloads → `Order` + lines, dedupes, recomputes derived fields. `OrderIngestionError` for mapping failures. |
| **`status_service.py`** ⭐ | `OrderStatusService` — **the only write path for `Order.status`.** Owns the 8-state transition matrix and emits the `status_changed` audit. Everything lifecycle-related validates here. |
| **`lifecycle_service.py`** | `OrderLifecycleService` — wraps each transition with its **side effects**: confirm / cancel / delay / restore / not_answered / send_to_pos / package / submit_delivery / process_return / loyalty points / stock sync. `LifecycleError` for rule violations. This is what the viewset lifecycle actions call. |
| **`stock_service.py`** | `OrderStockAvailabilityService` (detail-screen availability) + `OrderStockReservationService` (reserve/release on the right transitions). Keeps stock math out of the lifecycle service body. |
| **`delivery_service.py`** | `DeliverySubmissionService` — submit to the external delivery provider + track status. Swallows provider errors into a recorded state; never corrupts the local order. |
| **`assignment_service.py`** | `OrderAssignmentService` — owns *who* an order is assigned to: workload-balanced `auto_assign` for imports + manual (re)assignment. `OPEN_STATUSES` defines the assignable set. |
| **`order_management_service.py`** | `OrderManagementService` — edit / soft-delete / restore mutation rules (the non-lifecycle writes). |
| **`invoice_service.py`** ⭐ | `InvoiceService` — invoices are orders carrying an `invoice_number`. Owns `registry_queryset`, `next_number_preview`, `issue_or_update` (per-company-per-year sequence, duplicate guard, billed-party snapshot, audit) and `delete` (clears invoice fields, leaves the order intact). `InvoiceError` carries the exact DRF payload+status back to the view. |
| **`woocommerce_sync_service.py`** | `WooCommerceSyncService` — pushes local status changes **to** WooCommerce. Local-is-truth: failures set `sync_status=sync_failed` + a retry, never roll back. |
| **`auto_cancel_service.py`** | `AutoCancelService` — auto-cancels orders stuck in `not_answered` past `ORDER_AUTO_CANCEL_DAYS`. Run by the management command / Celery beat. |
| **`kpi_service.py`** | `OrderKPIService` — dashboard aggregations off `Order.status` (only `done` counts as a sale). Pure reads; caller scopes by tenant. |
| **`priority_service.py`** | `PriorityService` — derives `high/medium/low` from order total + stock signals using per-company `SystemSetting` thresholds. Pure; the lifecycle service persists the result. |
| **`logging_service.py`** | `OrderLoggingService.log(...)` — the single entry point for `OrderLog` audit rows (JSON-safe serialization of details). |

### Cross-cutting / async

| file | what it does |
| --- | --- |
| **`signals.py`** | `pre_save`/`post_save` on `Order` capture before/after state for automatic audit logging. |
| **`realtime.py`** | Best-effort WebSocket fan-out: broadcasts a tiny envelope (`id`, `status`, `source`, deleted flag) — a "refetch now" signal, never order data. |
| **`consumers.py`** / **`routing.py`** | `OrdersConsumer` (company-scoped WS at `ws/orders/`) + its routing. JWT auth resolved upstream in `core.ws_auth`. |
| **`handlers.py`** | WooCommerce webhook registration (`order.created/updated/deleted/restored`) → enqueues ingestion; built for high burst throughput. |
| **`tasks.py`** | Celery tasks for sync + delivery submission — idempotent, retry-safe. |
| **`models.py`** | `Order`, `OrderLine`, `OrderLog`, `OrderSyncEvent`, the `Status`/`Source`/`PriorityLevel` enums, the soft-delete manager (`objects` vs `all_objects`), `next_invoice_number()`, and derived-field invariants. Every query is tenant-scoped. |
| **`admin.py`** | Django admin registration (read-mostly; line inline). |
| **`apps.py`** | `OrdersConfig.ready()` wires up the webhook handlers + signals on load. |

⭐ = touched/added by the refactor (see §5).

---

## 4. Final folder structure

```
apps/orders/
├── ORDERS_APP_GUIDE.md          ← this file
├── admin.py
├── apps.py
├── urls.py                      ← router: /api/v1/orders/
│
├── views.py                     ← OrderViewSet (thin) + OrderSyncEventViewSet
├── serializers.py               ← request/response shapes + payload validation
├── filters.py                   ← OrderFilterSet (list filters)
│
├── selectors.py        ⭐        ← read queries: joins, annotations, search, RBAC scoping
├── permissions.py      ⭐        ← authorization decisions (gates)
├── validators.py       ⭐        ← query-param / scalar coercion
│
├── service.py                   ← OrderIngestionService (WC + POS/manual ingestion)
├── status_service.py            ← OrderStatusService (canonical transition matrix)
├── lifecycle_service.py         ← OrderLifecycleService (transitions + side effects)
├── stock_service.py             ← availability + reservation
├── delivery_service.py          ← DeliverySubmissionService
├── assignment_service.py        ← OrderAssignmentService
├── order_management_service.py  ← edit / soft-delete / restore
├── invoice_service.py  ⭐        ← InvoiceService (registry, numbering, issue/delete)
├── woocommerce_sync_service.py  ← push status → WooCommerce
├── auto_cancel_service.py       ← stale not_answered auto-cancel
├── kpi_service.py               ← dashboard aggregations
├── priority_service.py          ← derived priority
├── logging_service.py           ← OrderLoggingService (audit)
│
├── signals.py · realtime.py · consumers.py · routing.py · handlers.py · tasks.py
├── models.py
├── management/                  ← commands (e.g. auto-cancel)
├── migrations/
└── tests/                       ← 16 modules, ~5k lines (see §6)
```

---

## 5. What the refactor changed (and what it deliberately didn't)

The orders app was already well-layered (a real service layer, a canonical status
service, focused serializers). The refactor was **additive and behavior-preserving**
— it filled the three missing "thin-view" responsibilities and pulled the largest
chunk of business logic out of the 2.8k-line viewset, **without changing a single
API path, payload, or status code.**

**Added modules**
- `selectors.py` — query construction (joins, `with_queue_annotations`,
  `apply_search`, return-lookup, and RBAC `scope_orders_to_user` /
  `permission_scope_q`) moved out of `OrderViewSet`.
- `permissions.py` — `require_order_permission` + `permission_for_edit` moved out.
- `validators.py` — `safe_int` / `safe_positive_int` / `safe_bool` moved out.
- `invoice_service.py` — `InvoiceService` now owns the ~150 lines of invoice
  registry/numbering/issue/delete/audit logic that lived inline in the viewset.

**Compatibility shims kept on purpose:** the viewset still exposes thin
`_scope_queryset`, `_require_permission`, `_apply_search`, `_safe_bool`, … methods
that forward to the new modules — but ONLY the ones with live `self._x(...)` call
sites. Orphaned forwarders left with no callers were removed (see the dead-code
sweep). Prefer calling the module functions directly in *new* code.

**Net effect:** `views.py` 2784 → 2376 lines (−408); all 118 orders tests still
pass; no migration, no URL change, no import-path change for the 40+ external
modules that import `apps.orders.*`.

**Deliberately NOT done** (explained, per "don't remove anything without saying so"):
- **No package split** of `views.py`/`models.py` into sub-packages. 40+ modules
  across `apps.bi`, `apps.clients`, `apps.company`, `apps.sales_channels`,
  `apps.notifications`, and `core.asgi` import these exact paths. Splitting them
  would be a large blast radius for cosmetic gain — rejected as over-engineering.
- **No generic `validators.py` for write payloads.** Field validation already
  lives correctly in the serializers; there was no real cross-cutting duplication
  to extract. `validators.py` is intentionally scoped to loose param coercion.

---

## 6. Tests

`apps/orders/tests/` (run with explicit module paths — package discovery is
flaky):

```bash
python manage.py test apps.orders.tests.test_order_api apps.orders.tests.test_invoice_numbers
```

Key suites: `test_order_api` (list/scope/search/CRUD), `test_invoice_numbers` &
`test_invoice_pricing` (invoicing), `test_lifecycle_service` &
`test_order_status_services` (the state machine), `test_edit_lock`,
`test_assignment`, `test_delivery_*`, and the stock suites
(`test_stock_reservation`, `test_pack_*`, `test_stock_oversell_fixes`,
`test_inventory_reconciliation`).

**When changing a query** → run `test_order_api` (+ `test_assignment`,
`test_pos_destinations`). **When changing invoices** → `test_invoice_numbers`.
**When changing a transition** → `test_lifecycle_service` +
`test_order_status_services`.

---

## 7. How to safely change things

- **New read/filter:** add a `selectors` function (or an `OrderFilterSet` field);
  call it from the action. Don't hand-roll `select_related`/`Q` in the view.
- **New lifecycle behavior:** edit the matrix in `status_service.py`, then the
  side effects in `lifecycle_service.py`. Never set `order.status` directly.
- **New permission:** add the codename to RBAC seed (`apps/rbac/constants.py`),
  gate the action with `self._require_permission(...)`. Codenames only — **never
  hardcode role names.**
- **Invoice rule change:** edit `InvoiceService`; the view stays thin. Raise
  `InvoiceError(payload, status)` for client-facing 4xx responses.
- **Keep import paths stable.** `apps.orders.views`, `.models`, `.service`,
  `.lifecycle_service`, `.status_service`, `.serializers` are imported widely.
- **After backend changes:** the Docker image bakes code — `docker cp` the files
  in for a quick test loop, or rebuild (`docker compose -f
  docker-compose.fullstack.yml up -d --build backend`) before declaring done.

---

## 8. Future improvements (non-blocking)

- Migrate *new* call sites off the viewset compatibility shims to the module
  functions directly, then eventually drop the shims.
- Consider an `OrderExportService` reusing `selectors` for CSV/Excel exports.
- Split `lifecycle_service.py` (1.8k lines) per transition group if it keeps
  growing — but only behind the same `OrderLifecycleService` facade.
- Add focused unit tests for `selectors.apply_search` phone matching and
  `InvoiceService.issue_or_update` duplicate handling (currently covered
  indirectly through the API tests).
```
