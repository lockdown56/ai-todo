"""add recurring tasks and completion occurrences

Revision ID: 20260713_0005
Revises: 20260701_0004
"""

import sqlalchemy as sa
from alembic import op

revision = "20260713_0005"
down_revision = "20260701_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("recurrence_type", sa.String(20)))
    op.add_column("tasks", sa.Column("recurrence_start_date", sa.Date()))
    op.add_column("tasks", sa.Column("recurrence_end_date", sa.Date()))
    op.add_column("tasks", sa.Column("recurrence_weekday", sa.SmallInteger()))
    op.add_column("tasks", sa.Column("recurrence_monthday", sa.SmallInteger()))
    op.add_column("tasks", sa.Column("reminder_offset_minutes", sa.Integer()))
    op.create_table(
        "task_occurrences",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "task_id", sa.Uuid(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("occurrence_date", sa.Date(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.UniqueConstraint("task_id", "occurrence_date"),
    )
    op.create_index("ix_task_occurrences_task_id", "task_occurrences", ["task_id"])


def downgrade() -> None:
    op.drop_table("task_occurrences")
    for name in (
        "reminder_offset_minutes",
        "recurrence_monthday",
        "recurrence_weekday",
        "recurrence_end_date",
        "recurrence_start_date",
        "recurrence_type",
    ):
        op.drop_column("tasks", name)
