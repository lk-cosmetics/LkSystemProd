# Order Status Map (refactor design, planning only)

Status: **DRAFT for approval. No code or model changes have been made.**
Revision: incorporates owner decisions 1 to 13 (adds manual backward
transitions / rollback, and full WooCommerce status sync incl. cancel).

This document is the single reference for the WooCommerce Order Management
status refactor. It maps every existing status field and value onto the new,
cleaner status model, defines the derivation rules and state machines, and
records the resolved decisions.

Grounded in the current code:
`apps/orders/models.py`, `apps/orders/lifecycle_service.py`,
`apps/orders/service.py`, `apps/orders/stock_service.py`,
`apps/inventory/models.py`.

---

## 1. Problem statement

`Order` today carries 12 overlapping status-ish fields. The same concept is
spread across many of them (`CANCELLED` in 5 fields, `RETURNED` in 6,
`EXCHANGED` in 5, `DELAYED` in 2), and there are two derived summary fields
(`final_outcome` and `workflow_status`) that say nearly the same thing. The UI
must read several fields to render one badge. That is the reported "messy and
duplicated statuses" issue.

---

## 2. Design principle: two layers + strict separation

**Top layer (public).** A small set of clean fields. The React UI and the API
read and display only these. They are persisted-but-derived, written only by the
lifecycle service (the same pattern the code already uses for `workflow_status`
and `final_outcome`).

**Internal layer (mechanism).** The existing rich fields stay, but become an
implementation detail behind the lifecycle service. They keep the working stock
engine, delivery-provider integration, structured returns, and the 69 passing
tests intact. They are not exposed as competing top-level statuses.

**Strict separation (decision 11).** `order_status` is ONLY the business
lifecycle. It is a distinct database field, a distinct serializer field, and a
distinct UI badge. The following are never folded into `order_status`:
`sync_status`, `confirmation_status`, `priority_level`, `stock_status`,
`payment_status`, `woocommerce_status`. Each is its own field and its own badge.

---

## 3. New top-layer fields

| Field | Type | Values |
|-------|------|--------|
| `order_status` | choice | `new`, `awaiting_confirmation`, `confirmed`, `delayed`, `not_answered`, `canceled`, `preparing`, `done`, `returned`, `exchanged` |
| `confirmation_status` | choice | `pending`, `accepted`, `delayed`, `canceled`, `no_answer` |
| `delivery_method` | choice | `home_delivery`, `pos_pickup` |
| `payment_status` | choice | kept incl. partial: `unpaid`, `paid`, `partial`, `refunded` |
| `stock_status` | choice (derived) | `in_stock`, `partial_stock`, `out_of_stock` |
| `priority_level` | choice (derived) | `high`, `medium`, `low` |
| `woocommerce_status` | string | raw WooCommerce status (= today's `wc_status`) |
| `sync_status` | choice | `imported`, `pending_sync`, `syncing`, `synced`, `sync_failed` |
| `sync_error_message` | text | last push error |
| `last_sync_at` | datetime | last successful push (kin to today's `synced_at`) |

> Note (decision 1): there is intentionally NO `packaged`, `shipped`, or
> `delivered` main status. In this workflow, when packaging is finished the
> order is `done` and leaves our internal system. Delivery-provider tracking
> (JAX) remains internal only and does not create its own lifecycle state.

> Storage note (Phase B, additive): `woocommerce_status` is exposed as a
> serializer alias of the existing `wc_status` column — no duplicate column is
> added. `payment_status` already exists and is reused as-is. `last_sync_at` IS
> a new column: it records the last successful *push to* WooCommerce, distinct
> from `synced_at` (last *pull from* WooCommerce).

### 3.1 `order_status` definitions (decisions 1, 2, 9)

| Value | Meaning |
|-------|---------|
| `new` | Imported from WooCommerce/API and untouched (no confirmation activity). |
| `awaiting_confirmation` | First confirmation action happened, or assigned to a confirmation agent; contact in progress, unresolved. |
| `confirmed` | Customer accepted. |
| `delayed` | Customer asked to delay / call later. Stores `delay_until` and `delay_note`. |
| `not_answered` | Customer did not answer after 3 attempts. This is NOT canceled. |
| `canceled` | Customer canceled or admin canceled. |
| `preparing` | Packaging team started preparation. |
| `done` | Packaging finished and the order left our system. Triggers WooCommerce push to `completed`. |
| `returned` | Order came back as a return. |
| `exchanged` | Order was exchanged; a replacement order may be created. |

---

## 4. Field disposition (what happens to each existing field)

| Existing field | Disposition | Notes |
|----------------|-------------|-------|
| `status` (Status) | **Keep internal** | Still the reconciliation trigger (`COMPLETED` moves stock) and idempotency. Surfaces through `order_status`. |
| `wc_status` | **Alias** | Exposed as `woocommerce_status` via the serializer (raw passthrough). No new column in Phase B. |
| `source` | **Keep** | Drives `delivery_method` default, page scope (decision 10), and sync eligibility. |
| `outcome` (Outcome) | **Collapse** | Folds into `confirmation_status` (+ `order_status`). Keep column during transition. |
| `contact_status` (ContactStatus) | **Collapse** | Folds into `confirmation_status`. `not_answered_attempts` / `not_answered_at` stay. |
| `delivery_status` (DeliveryStatus) | **Keep internal** | JAX provider detail only. No longer surfaces as `shipped`/`delivered`; once packaging is done the order is `done`. |
| `payment_status` | **Keep (incl. partial)** | Public, as-is. |
| `return_exchange_status` | **Retire later** | Redundant with `return_type` + `order_status`. Remove after UI cutover. |
| `return_type` (ReturnType) | **Keep internal** | Drives stock-restoration matrix and return reporting. |
| `packaging_status` | **Keep internal** | Drives `order_status = done` when PACKAGED/UPDATED. |
| `final_outcome` (FinalOutcome) | **Retire later** | KPIs re-point to `order_status` (decision 7). Keep derived column during transition. |
| `workflow_status` (WorkflowStatus) | **Supersede** | Becomes the new `order_status`, re-segmented and renamed. |
| `in_store_pickup` (bool) | **Promote** | Source of `delivery_method`. |
| `OrderSyncEvent.SyncStatus` | **Unchanged** | Per-run sync history. The new per-order `sync_status` is separate. |

---

## 5. Value-by-value derivation

The lifecycle service is the only writer. All derivations are recomputed after
every transition, exactly like `_recompute_workflow_status` does today.

### 5.1 `order_status` (highest match wins)

`NO_ANSWER_MAX_ATTEMPTS` defaults to 3 (configurable in `SystemSetting`).
`_IN_FLIGHT_DELIVERY` today = {QUEUED, SUBMITTED, ACCEPTED, IN_TRANSIT}.

| Priority | Condition (existing fields) | `order_status` |
|----------|------------------------------|----------------|
| 1 | `return_exchange_status == EXCHANGED` or `return_type == EXCHANGED` or `final_outcome == EXCHANGED` | `exchanged` |
| 2 | `returned_at` set, or `delivery_status == RETURNED`, or `final_outcome == RETURNED` | `returned` |
| 3 | `status == CANCELLED` or `outcome == CANCELLED` | `canceled` |
| 4 | `packaging_status in {PACKAGED, UPDATED}`, or `pos_validated_at` set, or `delivery_status == DELIVERED`, or `final_outcome == SUCCESSFUL_SALE` | `done` |
| 5 | `outcome == CONFIRMED` and (`sent_to_pos_at` set, or `delivery_reference` set, or `delivery_status in _IN_FLIGHT_DELIVERY`) | `preparing` |
| 6 | `outcome == CONFIRMED` | `confirmed` |
| 7 | `outcome == DELAYED` or `contact_status == DELAYED` | `delayed` |
| 8 | `contact_status == NOT_ANSWERED` and `not_answered_attempts >= NO_ANSWER_MAX_ATTEMPTS` | `not_answered` |
| 9 | confirmation activity has begun but unresolved (see note) | `awaiting_confirmation` |
| 10 | otherwise (untouched) | `new` |

**Awaiting-confirmation signal (priority 9).** "Confirmation activity has begun"
means any of: assigned to a confirmation agent, `contact_status != NONE`,
`not_answered_attempts >= 1`, or `outcome_changed_at` set. There is no
"assigned agent" field today; closing that gap is a small Phase B addition
(a `confirmation_started_at` timestamp and/or `assigned_agent`), with the
listed fallback signals used until then. While `1 <= not_answered_attempts < 3`,
the order stays `awaiting_confirmation` (priority 8 does not yet match).

> Decision 1 applied: `done` is reached when packaging finishes
> (`packaging_status PACKAGED/UPDATED`) or a POS pickup is validated. There is no
> separate `packaged`/`shipped`/`delivered` lifecycle state.

### 5.2 `confirmation_status` (collapses `outcome` + `contact_status`)

A durable record of the confirmation team's result. It persists after the order
advances (for example it stays `accepted` once the order is `done`).

| Condition | `confirmation_status` |
|-----------|------------------------|
| `outcome == CANCELLED` | `canceled` |
| `outcome == CONFIRMED` | `accepted` |
| `outcome == DELAYED` or `contact_status == DELAYED` | `delayed` |
| `contact_status == NOT_ANSWERED` | `no_answer` |
| otherwise | `pending` |

Relationship to `order_status` (decision 11): separate fields, separate badges.
They correlate during the confirmation phase by design; this is a projection of
the same step, not a merge. They are never collapsed into one column.

### 5.3 `delivery_method`

| Condition | `delivery_method` |
|-----------|--------------------|
| `in_store_pickup` true, or `pos_sales_channel` set, or `source == POS` | `pos_pickup` |
| otherwise | `home_delivery` |

### 5.4 `payment_status`

Kept as-is, including `partial` (decision 8).

### 5.5 `stock_status` (derived per order)

Reuses `OrderStockAvailabilityService` against the fulfilling channel
(`pos_sales_channel` if routed, else `sales_channel`). Only customer lines count
(packaging-type lines excluded).

| Condition over customer lines | `stock_status` |
|-------------------------------|----------------|
| any line `available_quantity == 0` | `out_of_stock` |
| every line has stock but at least one line `available < required` | `partial_stock` |
| every line fully available | `in_stock` |

**`mapping_required` (derived boolean, separate from `stock_status`).** True when
any line is unlinked to a local product (`OrderLine.is_linked == False`). Such an
order cannot be stock-checked and is forced to `low` priority (5.6). Kept as its
own signal so `stock_status` stays a clean 3-value enum.

### 5.6 `priority_level` (decision 4, configurable via `SystemSetting`)

Default thresholds: `PRIORITY_HIGH_MIN_AMOUNT = 299` DT,
`PRIORITY_MEDIUM_MIN_AMOUNT = 100` DT.

| Condition | `priority_level` |
|-----------|-------------------|
| `total >= 299` and `stock_status == in_stock` | `high` |
| (`100 <= total < 299`) or `stock_status == partial_stock` | `medium` |
| `total < 100`, or `stock_status == out_of_stock`, or `mapping_required` | `low` |

Rules are applied top-down; the first match wins.

### 5.7 `woocommerce_status`

Direct passthrough of the raw WooCommerce status string. No transformation.

### 5.8 `sync_status` (new state machine, decision 1)

Only meaningful for `source == WOOCOMMERCE`. POS / manual orders stay `imported`.

| State | Meaning |
|-------|---------|
| `imported` | Created from a WooCommerce pull, nothing to push. |
| `pending_sync` | A local change (order became `done`) is queued to push. |
| `syncing` | Push in progress. |
| `synced` | Last push succeeded. Sets `last_sync_at`, clears `sync_error_message`. |
| `sync_failed` | Last push failed. Sets `sync_error_message`. Retry button available. |

Transitions: `imported -> pending_sync -> syncing -> {synced | sync_failed}`;
`sync_failed -> syncing` (retry); `synced -> pending_sync` (new local change).

### 5.9 Done to WooCommerce completed (decision 1)

When `order_status` becomes `done`:
1. Set `sync_status = pending_sync`, then `syncing`.
2. PUT WooCommerce `/wp-json/wc/v3/orders/{external_order_id}` with
   `status = "completed"` using the channel credentials
   (`wc_store_url` / `wc_consumer_key` / `wc_consumer_secret`).
3. On success: `sync_status = synced`, set `last_sync_at`, log to history.
4. On failure: keep `order_status = done`, set `sync_status = sync_failed`,
   store `sync_error_message`, log the error to history, and expose a
   "Retry WooCommerce Sync" action that repeats from step 1.

The existing `WooCommerceAPI` client (used by `product_sync_service`) does
product pulls only; an `update_order_status()` method is the Phase C addition.

### 5.10 POS-pickup delivery fee (decision 5, configurable via `SystemSetting`)

Defaults: `POS_PICKUP_DELIVERY_FEE = 7.000` DT,
`POS_PICKUP_FEE_WAIVE_BELOW = 299` DT.

| Order total | 7 DT fee |
|-------------|----------|
| `total > 299` | keep |
| `total == 299` | keep |
| `total < 299` | remove |

Equivalent rule: keep the fee when `total >= POS_PICKUP_FEE_WAIVE_BELOW`,
otherwise remove it. Applies to `delivery_method == pos_pickup`.

### 5.11 Canceled to WooCommerce, and the general WC-sync rule (decision 13)

Any local lifecycle change that has a WooCommerce equivalent must be pushed to
WooCommerce. The two mandatory ones are `done -> completed` (5.9) and
`canceled -> cancelled` (here). The local system is always the source of truth:
if the push fails we keep the local status and surface the failure.

**Canceled push.** When `order_status` becomes `canceled` (customer-canceled,
admin-canceled, no-stock cancellation, or manual cancellation):
1. `sync_status = pending_sync -> syncing`.
2. `PUT /wp-json/wc/v3/orders/{external_order_id}` body `{ "status": "cancelled" }`
   using the channel credentials.
3. On success: `woocommerce_status = cancelled`, `sync_status = synced`,
   `last_sync_at = now`, history log "Order canceled locally and synced to
   WooCommerce".
4. On failure: keep `order_status = canceled` (the local cancellation stands),
   `sync_status = sync_failed`, store `sync_error_message`, show "Retry
   WooCommerce Sync", history log with the failure reason.

**`not_answered` is NOT a cancel.** While `order_status == not_answered` the
system never pushes a WooCommerce cancellation. Only an explicit admin change to
`canceled` triggers the cancel push.

**Admin reopen.** When an admin reopens a `canceled` order, the order's new local
status is re-synced to WooCommerce through the same mapping, e.g.
`awaiting_confirmation -> on-hold` (or `processing`, per config),
`confirmed -> processing`, `done -> completed`.

**Configurable mapping (`SystemSetting.wc_status_map`).** All local -> WooCommerce
status mappings live in `SystemSetting`, so an admin can retune them without a
deploy. Default map:

| local `order_status` | WooCommerce status |
|----------------------|--------------------|
| `awaiting_confirmation` | `on-hold` |
| `confirmed` | `processing` |
| `preparing` | `processing` |
| `done` | `completed` |
| `canceled` | `cancelled` |
| `returned` | `refunded` |
| `exchanged` | `processing` |

`new`, `delayed`, and `not_answered` have no automatic push by default (empty
mapping) — they stay internal until they resolve to a mappable state.

---

## 6. State machines

### 6.1 `order_status` transitions (decision 2)

```
new                   -> awaiting_confirmation
awaiting_confirmation -> confirmed
awaiting_confirmation -> delayed
awaiting_confirmation -> not_answered
awaiting_confirmation -> canceled
delayed               -> awaiting_confirmation
not_answered          -> awaiting_confirmation
confirmed             -> preparing
preparing             -> done
preparing             -> canceled
done                  -> returned
done                  -> exchanged
canceled              -> new            (admin reopen only)
```

Normal path: `new -> awaiting_confirmation -> confirmed -> preparing -> done`.
`delayed` and `not_answered` are holding states inside the confirmation phase
and always return to `awaiting_confirmation` for the next attempt.
`not_answered` is explicitly NOT a cancellation.

### 6.2 `sync_status` transitions

```
imported     -> pending_sync
pending_sync -> syncing
syncing      -> synced | sync_failed
sync_failed  -> syncing            (retry)
synced       -> pending_sync       (new local change)
```

### 6.3 Manual backward transitions / rollback (decision 12)

Beyond the forward path, an admin or manager can move an order *back* to an
earlier valid step. This is a controlled, audited override — never a silent edit.

**Allowed backward moves.**

| From | To | When |
|------|----|------|
| `done` | `preparing` | packaging needs correction |
| `preparing` | `confirmed` | preparation started by mistake |
| `confirmed` | `awaiting_confirmation` | customer must be reconfirmed |
| `delayed` | `awaiting_confirmation` | time to call again |
| `not_answered` | `awaiting_confirmation` | retry calling |
| `canceled` | `awaiting_confirmation` or `confirmed` | admin reopen |
| `returned` | `done` | return created by mistake, admin confirms rollback |
| `exchanged` | `done` | exchange created by mistake, admin confirms rollback |

**Rules.**
- Permission-gated. Only `admin` / `manager` (via `rbac`) may move an order
  backward. Normal users only see the forward next-action(s) their role allows.
- Every manual change requires a `reason` / motif (non-empty).
- Every manual change is written to `OrderLog` with: old `order_status`, new
  `order_status`, the acting user, the reason, and the timestamp. Surfaced in the
  UI timeline. No silent status changes.
- Dangerous rollbacks (`returned -> done`, `exchanged -> done`, `done ->
  preparing`, `canceled -> *`) require a confirmation modal in the UI.
- Side-effects are recalculated safely (never left inconsistent):

| Rollback | Side-effects to correct |
|----------|--------------------------|
| `returned -> done` | re-apply the sale: re-deduct restored stock, re-grant loyalty points, re-include in successful-sales / revenue / KPIs, re-sync WooCommerce to `completed` |
| `exchanged -> done` | reverse the exchange: undo replacement movements, restore the original sale state, fix points / revenue / KPIs, re-sync `completed` |
| `done -> preparing` | unwind the `done` push: set WooCommerce back to `processing`, pull the order out of done-based KPIs until it is `done` again |
| `canceled -> confirmed` / `awaiting_confirmation` | re-open: re-sync WooCommerce to the mapped status (5.11), re-check stock, restore any reversed points / KPI effects |
| `preparing -> confirmed` | release any packaging-stage reservations; no customer-facing accounting change |
| `delayed` / `not_answered -> awaiting_confirmation` | clear `delay_until` / attempt holds; no stock or accounting change |

The recompute reuses the existing engines (`_sync_inventory_movements`,
`reverse_loyalty_points` / grant, WooCommerce push). The lifecycle service is the
only writer; it validates the move against this table and the actor's role before
applying, then logs old -> new.

---

## 7. Returns and exchanges: accounting and stock correction (decisions 3, 6)

When a `done` order becomes `returned` or `exchanged`, the system must correct
both stock and the books. Much of this already exists and is reused; the gaps
are KPI/accounting corrections and reason/timeline capture.

**Per-item condition (already implemented in `_apply_structured_return_conditions`).**
- good condition: `RETURN_IN` movement, item goes back to available stock.
- damaged / unusable / bad packaging: `DAMAGE` movement (waste), NOT returned to stock.
- missing: no stock movement, logged as a loss.
- exchanged line: `RETURN_IN` for the original + `SALE` for the replacement.

**Accounting and KPI correction (decision 3, 7 - to wire in Phase C).**
- A returned/exchanged order must be removed from successful-sales and
  revenue/profit totals. Because `returned`/`exchanged` outrank `done` in 5.1,
  KPIs computed from `order_status` (count only `done`) auto-exclude them; the
  dashboard queries must move off `final_outcome` to `order_status`.
- Loyalty points are reversed on return (already implemented:
  `reverse_loyalty_points`); confirm the same on exchange.
- Customer order stats (`number_of_returns`, blocking) already adjust on return.

**Workflow must support (decision 6).**
- return reason and exchange reason / motif,
- per-item condition check,
- stock return vs waste,
- accounting / KPI correction,
- full order history / timeline (via `OrderLog`; surfaced as a timeline in the UI).

**Modeling (decision 6).** Reuse the existing inline mechanism (`OrderLog`,
`return_type`, `OrderLine.return_condition`, packaging-type `OrderLine`). Add a
thin model only where a real gap exists (for example an explicit `exchange_reason`
field or a replacement-order link if `OrderLog` details prove insufficient).

---

## 8. UI scope and visible identifier (decision 10)

- The Order Management page lists ONLY WooCommerce orders: `source == woocommerce`.
- The main visible identifier in the UI is the WooCommerce order ID:
  `external_order_id`. The internal database ID still exists and is used for API
  routing, but it is not the headline ID shown to users.

---

## 9. Resolved decisions (owner sign-off recorded)

1. No `packaged`/`shipped`/`delivered` main statuses. Use `preparing` then `done`.
   `done` pushes WooCommerce to `completed`; on failure keep `done`, set
   `sync_failed`, show Retry, log the error.
2. `order_status` has exactly the 10 values in Section 3, with `delayed` and
   `not_answered` as real main statuses and the flows in Section 6.1.
3. Returns/exchanges correct stock (good to stock, bad to waste) and the books
   (remove from successful sales/revenue, adjust points and customer stats),
   all logged.
4. Priority via `SystemSetting`, defaults in Section 5.6 (299 / 100 thresholds).
5. POS-pickup fee rule in Section 5.10 (`>= 299` keep 7 DT, `< 299` remove),
   configurable.
6. Reuse the existing return/exchange mechanism; add thin models only for real
   gaps; the workflow requirements in Section 7 must be met.
7. KPIs move from `final_outcome` to `order_status`; returned/exchanged are
   excluded from successful sales/revenue. `final_outcome` retired later.
8. Keep `payment_status.partial`.
9. `new` = imported and untouched; `awaiting_confirmation` = first confirmation
   action happened or assigned to a confirmation agent.
10. Order Management page shows only `source == woocommerce`; the visible ID is
    `external_order_id`.
11. Strict separation: `order_status` is only the business lifecycle and is never
    mixed with sync / confirmation / priority / stock / payment / woocommerce
    statuses.
12. Admin / manager can move an order backward to any valid earlier step
    (Section 6.3): permission-gated, reason-required, fully logged (old, new,
    user, reason, timestamp), with a confirmation modal for dangerous rollbacks
    and safe recomputation of stock / WC sync / points / revenue / KPIs. No
    silent status changes.
13. Any local change with a WooCommerce equivalent is pushed to WooCommerce —
    mandatorily `done -> completed` and `canceled -> cancelled` (Section 5.11).
    `not_answered` is never auto-cancelled in WooCommerce. Admin reopen re-syncs
    the new status. All mappings live in `SystemSetting.wc_status_map`. On
    failure the local status stands, `sync_status = sync_failed`, Retry is shown,
    and the error is logged.

---

## 10. Refactor phases (after approval, each phase gated by your review)

- **B. Models + migration.** Add the new top-layer fields additively
  (`order_status`, `confirmation_status`, `delivery_method`, `stock_status`,
  `priority_level`, `sync_status`, `sync_error_message`, `last_sync_at`) — note
  `woocommerce_status` is a serializer alias of `wc_status` (no new column) and
  `payment_status` already exists. Add the gap fields `delay_until` / `delay_note`
  and the `awaiting_confirmation` signal (`confirmation_started_at` +
  `assigned_agent`). Add `SystemSetting` (priority thresholds, no-answer max
  attempts, POS fee + waive threshold, **and `wc_status_map`**). Add `OrderLog`
  actions for manual override / WC cancel-sync / sync-retry. Add indexes on
  `(company, order_status)`, `(company, sync_status)`, `(company, priority_level)`.
  Data migration backfills new fields from existing values per Sections 5 and 11.
  Additive only, no column drops, existing tests stay green.
- **C. Services.** Extend the lifecycle service with `_derive_order_status` and
  `_derive_confirmation_status`; add `OrderPriorityService`; extend
  `OrderStockAvailabilityService` to emit `stock_status` + `mapping_required`;
  add `WooCommerceSyncService.update_order_status()` handling `done -> completed`,
  `canceled -> cancelled`, and admin-reopen re-sync, all driven by
  `SystemSetting.wc_status_map` (retry + error logging; local status is the source
  of truth). Add `OrderLifecycleService.manual_transition(order, target, actor,
  reason)` enforcing the Section 6.3 table + actor role (rbac), requiring a reason,
  recomputing side-effects (stock, points, revenue / KPIs, WC sync), and logging
  old -> new. Add `SystemSettingService` (priority, fee, attempts, wc_status_map);
  align the no-answer flow to `not_answered` (not canceled) at 3 attempts; move KPI
  queries to `order_status` and exclude returned / exchanged.
- **D. Serializers + API.** One clean order serializer exposing only top-layer
  fields (with `woocommerce_status` aliasing `wc_status`), `external_order_id` as
  the visible ID, queryset scoped to `source == woocommerce`. Add a permission-
  gated `manual-transition` (move-back) action requiring a reason, a `retry-sync`
  action (covers both completed and cancelled pushes), and `SystemSetting`
  GET / PATCH endpoints. Reuse the 33 existing actions.
- **E. React (professional redesign).** Redesign the Order Management page with a
  clean, modern, easy-to-understand layout (the "Claude design" direction in
  Section 12): tabs by `order_status`, color-coded separate badges (Order /
  Confirmation / Sync / Priority / Stock / Payment), `external_order_id` as the
  headline ID, a single primary NextActionButton driven by `order_status`, a
  role-gated "Move back" control with a confirmation modal + required reason, a
  WooCommerce sync panel with Retry, an order timeline from `OrderLog`, and a
  settings page for thresholds / fee / WC status map.
- **F. UI/UX.** Tabs keyed on `order_status`, color-coded badges, one CTA, WC
  order ID as the headline identifier.
- **G. Cleanup migration.** After UI cutover, drop the retired fields
  (`return_exchange_status`, `final_outcome`, `workflow_status`, and the
  collapsed `outcome` / `contact_status` if fully replaced).
- **H. Testing.** Unit (each derivation, fee rule, priority, push success / fail
  / retry, no-answer at 3 attempts), integration (preparing -> done -> WC
  completed; return reverses stock + KPIs), regression (keep the 69 backend tests
  green), frontend build.

---

## 11. Backfill rules for the future data migration (when approved)

Compute the new fields once from current values, then let the lifecycle service
own them:

- `order_status` <- apply 5.1.
- `confirmation_status` <- apply 5.2.
- `delivery_method` <- apply 5.3.
- `woocommerce_status` <- copy `wc_status`.
- `last_sync_at` <- copy `synced_at`.
- `sync_status` <- `imported`.
- `stock_status`, `priority_level`, `mapping_required` <- computed lazily on
  first read or by a one-off backfill command (they depend on live inventory).

No destructive column drops happen in Phase B. Retired columns are removed only
in Phase G, after the UI reads exclusively from the new fields.

---

## 12. Order Management page redesign (UI/UX direction, Phase E/F)

The Order Management page is redesigned to be professional and easy to understand
— minimal cognitive load, clear at a glance.

- **One row, clear status.** Each order shows `external_order_id` (the WooCommerce
  ID) as the headline identifier, plus small color-coded badges, each its own
  concern (decision 11): Order status, Confirmation, Sync, Priority, Stock,
  Payment. Never one merged status.
- **Tabs by `order_status`.** new / awaiting_confirmation / confirmed / delayed /
  not_answered / preparing / done / returned / exchanged / canceled, with counts.
- **One primary action.** A single NextActionButton per row driven by
  `order_status` and the user's role (the forward step). Secondary actions in a
  menu.
- **Move back (role-gated).** Admin / manager see a "Move back" control offering
  the valid earlier steps from Section 6.3. Choosing one opens a confirmation
  modal that requires a reason; dangerous rollbacks are clearly flagged.
- **WooCommerce sync panel.** Shows `sync_status`, `last_sync_at`, and
  `sync_error_message`; a Retry button when `sync_failed`.
- **Timeline.** A chronological view from `OrderLog` (old -> new status, user,
  reason, time) so every manual change is visible.
- **Settings page.** Edit priority thresholds, no-answer attempts, POS pickup fee
  + waive threshold, and the WooCommerce status map.
- **Scope.** Lists only `source == woocommerce` orders (decision 10).

Design language ("Claude design"): clean cards and tables, generous spacing,
semantic colors for status (amber = needs attention, blue = in progress, green =
done, red = canceled / returned), accessible contrast, no clutter, and a clear
primary action on every screen.
