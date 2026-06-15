"""List groups and list archiving.

Revision ID: 20260615_0002
Revises: 20260611_0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260615_0002"
down_revision: str | None = "20260611_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "list_groups",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("sort_order", sa.BigInteger(), nullable=False),
        sa.Column("is_collapsed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_list_groups_user_sort", "list_groups", ["user_id", "sort_order"])
    op.add_column("task_lists", sa.Column("group_id", sa.Uuid(), nullable=True))
    op.add_column(
        "task_lists", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_task_lists_group_id",
        "task_lists",
        "list_groups",
        ["group_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_task_lists_group_id", "task_lists", type_="foreignkey")
    op.drop_column("task_lists", "archived_at")
    op.drop_column("task_lists", "group_id")
    op.drop_index("ix_list_groups_user_sort", table_name="list_groups")
    op.drop_table("list_groups")
