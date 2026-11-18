"""Add agent runs workboard.

Revision ID: 20261119_0007
Revises: 20260830_0006
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261119_0007"
down_revision: str | None = "20260830_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("reporter_key_id", sa.Uuid(), nullable=True),
        sa.Column("source", sa.String(100), nullable=False),
        sa.Column("session_ref", sa.String(300), nullable=True),
        sa.Column("session_url", sa.String(1000), nullable=True),
        sa.Column("workspace_label", sa.String(300), nullable=True),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "status_changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('running', 'waiting_user', 'succeeded', 'failed', 'cancelled', "
            "'dismissed')",
            name="ck_agent_runs_status",
        ),
        sa.CheckConstraint("version > 0", name="ck_agent_runs_version"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["reporter_key_id"], ["api_keys.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_agent_runs_user_status_updated",
        "agent_runs",
        ["user_id", "status", "updated_at", "id"],
    )
    op.create_index(
        "ix_agent_runs_user_status_changed",
        "agent_runs",
        ["user_id", "status", "status_changed_at", "id"],
    )
    op.create_table(
        "agent_write_receipts",
        sa.Column("actor", sa.String(100), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"]),
        sa.PrimaryKeyConstraint("actor", "request_id"),
    )
    op.add_column("api_keys", sa.Column("scope", sa.String(20), nullable=True))
    op.execute("UPDATE api_keys SET scope = 'todo_full'")
    with op.batch_alter_table("api_keys") as batch:
        batch.alter_column("scope", existing_type=sa.String(20), nullable=False)
        batch.create_check_constraint(
            "ck_api_keys_scope", "scope IN ('todo_full', 'agent_reporter')"
        )


def downgrade() -> None:
    with op.batch_alter_table("api_keys") as batch:
        batch.drop_constraint("ck_api_keys_scope", type_="check")
        batch.drop_column("scope")
    op.drop_table("agent_write_receipts")
    op.drop_index("ix_agent_runs_user_status_changed", table_name="agent_runs")
    op.drop_index("ix_agent_runs_user_status_updated", table_name="agent_runs")
    op.drop_table("agent_runs")
