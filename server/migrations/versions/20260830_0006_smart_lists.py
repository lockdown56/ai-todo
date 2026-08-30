"""add smart lists

Revision ID: 20260830_0006
Revises: 20260713_0005
"""

import sqlalchemy as sa
from alembic import op

revision = "20260830_0006"
down_revision = "20260713_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "smart_lists",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column("sort_order", sa.BigInteger(), nullable=False),
        sa.Column("filters", sa.JSON(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_smart_lists_user_sort", "smart_lists", ["user_id", "sort_order"])
    op.create_table(
        "smart_list_sources",
        sa.Column(
            "smart_list_id",
            sa.Uuid(),
            sa.ForeignKey("smart_lists.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "list_id",
            sa.Uuid(),
            sa.ForeignKey("task_lists.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index(
        "ix_smart_list_sources_list", "smart_list_sources", ["list_id", "smart_list_id"]
    )
    op.create_index("ix_task_tags_tag_task", "task_tags", ["tag_id", "task_id"])


def downgrade() -> None:
    op.drop_index("ix_task_tags_tag_task", table_name="task_tags")
    op.drop_table("smart_list_sources")
    op.drop_index("ix_smart_lists_user_sort", table_name="smart_lists")
    op.drop_table("smart_lists")
