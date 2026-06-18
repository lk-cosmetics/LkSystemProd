"""
LkSystem Orders App — Assignment Service
═══════════════════════════════════════════════════════════════════════════════
One place that owns *who* an order is assigned to.

  • auto_assign(order)        — fair, workload-balanced assignment for newly
                               imported WooCommerce/API orders. Picks the
                               eligible employee (auto-assignment pool) with the
                               fewest OPEN orders. Empty pool → left unassigned.
  • manual_assign(order, …)  — a manager (re)assigns an order to an employee.
  • unassign(order, …)       — clear the assignment.

"OPEN" orders are the non-terminal lifecycle states — everything except
``done`` / ``returned`` / ``canceled``. This system has no separate
"Pending / In Progress" statuses; the canonical lifecycle is the source of
truth, so workload is measured against it.

Every assignment writes an immutable ``OrderLog`` entry for audit.
All queries stay scoped by company for multi-tenant isolation.
"""

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, F, Max, Q
from django.utils import timezone

from .logging_service import OrderLoggingService
from .models import Order, OrderAutoAssignmentSetting, OrderLog

logger = logging.getLogger(__name__)

# Non-terminal lifecycle states = an employee's live workload.
OPEN_STATUSES = (
    Order.Status.NEW,
    Order.Status.CONFIRMED,
    Order.Status.NOT_ANSWERED,
    Order.Status.DELAYED,
    Order.Status.PACKAGING,
)

_ASSIGN_FIELDS = [
    'assigned_agent', 'assigned_by', 'assigned_at', 'assignment_type', 'updated_at',
]


class OrderAssignmentService:
    """Assignment rules + audit, in one place."""

    # ── pool / selection ────────────────────────────────────────────────────

    @staticmethod
    def eligible_employee_ids(company) -> list[int]:
        """User ids in this company's auto-assignment pool (enabled rows)."""
        return list(
            OrderAutoAssignmentSetting.objects
            .filter(company=company, enabled=True)
            .values_list('employee_id', flat=True)
        )

    @classmethod
    def pick_assignee(cls, company):
        """The eligible employee who should take the next order.

        Fairness: fewest OPEN assigned orders first; ties broken by whoever was
        assigned longest ago (never-assigned first) → round-robin-ish spread.
        Returns ``None`` when the pool is empty (→ caller leaves it unassigned).
        """
        ids = cls.eligible_employee_ids(company)
        if not ids:
            return None

        open_filter = Q(
            assigned_orders__company=company,
            assigned_orders__is_deleted=False,
            assigned_orders__status__in=OPEN_STATUSES,
        )
        User = get_user_model()
        return (
            User.objects
            .filter(id__in=ids, is_active=True)
            .annotate(
                open_orders=Count('assigned_orders', filter=open_filter, distinct=True),
                last_assigned=Max('assigned_orders__assigned_at'),
            )
            .order_by('open_orders', F('last_assigned').asc(nulls_first=True), 'id')
            .first()
        )

    @staticmethod
    def open_order_count(employee, company) -> int:
        """How many OPEN orders this employee currently holds in the company."""
        return Order.objects.filter(
            company=company,
            assigned_agent=employee,
            status__in=OPEN_STATUSES,
        ).count()

    # ── auto assignment (on import) ──────────────────────────────────────────

    @classmethod
    def auto_assign(cls, order, *, actor=None):
        """Assign a freshly-imported order to a pool employee (system action).

        No-ops if the order is already assigned or the pool is empty. The caller
        wraps this best-effort so a failure never blocks the import.
        """
        if order.assigned_agent_id:
            return None
        employee = cls.pick_assignee(order.company)
        if employee is None:
            return None

        order.assigned_agent = employee
        order.assigned_by = None  # system / auto — no human actor
        order.assigned_at = timezone.now()
        order.assignment_type = Order.AssignmentType.AUTO
        order.save(update_fields=_ASSIGN_FIELDS)

        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.ASSIGNED,
            user=actor,
            details={
                'assignment_type': Order.AssignmentType.AUTO,
                'employee_id': employee.id,
                'employee_name': _name(employee),
            },
        )
        logger.info(
            "Order %s auto-assigned to %s (open=%d)",
            order.order_number, _name(employee), cls.open_order_count(employee, order.company),
        )
        return employee

    # ── manual assignment / reassignment ─────────────────────────────────────

    @classmethod
    @transaction.atomic
    def manual_assign(cls, order, employee, *, actor):
        """A manager (re)assigns the order to ``employee``. Audited."""
        previous = order.assigned_agent
        order.assigned_agent = employee
        order.assigned_by = actor
        order.assigned_at = timezone.now()
        order.assignment_type = Order.AssignmentType.MANUAL
        order.save(update_fields=_ASSIGN_FIELDS)

        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.ASSIGNED,
            user=actor,
            details={
                'assignment_type': Order.AssignmentType.MANUAL,
                'employee_id': employee.id,
                'employee_name': _name(employee),
                'previous_employee_id': previous.id if previous else None,
                'previous_employee_name': _name(previous) if previous else None,
            },
        )
        return employee

    @classmethod
    @transaction.atomic
    def auto_assign_now(cls, order, *, actor=None):
        """(Re)assign to the fewest-open eligible employee — even if the order is
        already assigned. For deliberate bulk auto-distribution by a manager
        (``auto_assign`` is the import-time variant that skips already-assigned
        orders). Returns the employee, or None when the pool is empty.

        Used in a loop, each assignment commits before the next ``pick_assignee``
        runs, so the workload stays balanced across the batch.
        """
        employee = cls.pick_assignee(order.company)
        if employee is None:
            return None
        order.assigned_agent = employee
        order.assigned_by = actor
        order.assigned_at = timezone.now()
        order.assignment_type = Order.AssignmentType.AUTO
        order.save(update_fields=_ASSIGN_FIELDS)
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.ASSIGNED,
            user=actor,
            details={
                'assignment_type': Order.AssignmentType.AUTO,
                'employee_id': employee.id,
                'employee_name': _name(employee),
                'bulk': True,
            },
        )
        return employee

    @classmethod
    @transaction.atomic
    def unassign(cls, order, *, actor):
        """Clear the order's assignment. Audited."""
        previous = order.assigned_agent
        order.assigned_agent = None
        order.assigned_by = None
        order.assigned_at = None
        order.assignment_type = ''
        order.save(update_fields=_ASSIGN_FIELDS)

        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.UNASSIGNED,
            user=actor,
            details={
                'previous_employee_id': previous.id if previous else None,
                'previous_employee_name': _name(previous) if previous else None,
            },
        )


def _name(user) -> str:
    if not user:
        return ''
    return user.get_full_name() or getattr(user, 'matricule', '') or user.email
