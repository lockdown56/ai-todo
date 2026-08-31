import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import RefreshToken


@pytest.mark.asyncio
async def test_smart_list_crud_filters_and_source_lifecycle(client):
    work = (await client.post("/api/v1/lists", json={"name": "工作", "color": "#336699"})).json()
    personal = (
        await client.post("/api/v1/lists", json={"name": "生活", "color": "#663399"})
    ).json()
    tag = (await client.post("/api/v1/tags", json={"name": "重点", "color": "#CC0000"})).json()
    matching = (
        await client.post(
            "/api/v1/tasks",
            json={
                "title": "匹配任务",
                "list_id": work["id"],
                "priority": 5,
                "tag_ids": [tag["id"]],
            },
        )
    ).json()
    await client.post(
        "/api/v1/tasks",
        json={
            "title": "优先级不匹配",
            "list_id": personal["id"],
            "priority": 1,
        },
    )

    created = await client.post(
        "/api/v1/smart-lists",
        json={
            "name": "重点汇总",
            "color": "#123456",
            "source_list_ids": [work["id"], personal["id"]],
            "filters": {
                "statuses": ["active"],
                "priorities": [5],
                "tag_ids": [tag["id"]],
                "date": None,
            },
        },
    )
    assert created.status_code == 201
    smart_list = created.json()
    assert smart_list["source_list_ids"] == [work["id"], personal["id"]]

    listed = await client.get("/api/v1/smart-lists")
    assert listed.json()[0]["task_count"] == 1
    tasks = await client.get(
        "/api/v1/tasks",
        params={
            "smart_list_id": smart_list["id"],
            "sort": "due_asc",
        },
    )
    assert [item["id"] for item in tasks.json()["items"]] == [matching["id"]]

    await client.post(f"/api/v1/lists/{work['id']}/archive")
    tasks = await client.get("/api/v1/tasks", params={"smart_list_id": smart_list["id"]})
    assert tasks.json()["items"] == []
    await client.post(f"/api/v1/lists/{work['id']}/unarchive")
    tasks = await client.get("/api/v1/tasks", params={"smart_list_id": smart_list["id"]})
    assert [item["id"] for item in tasks.json()["items"]] == [matching["id"]]

    deleted = await client.delete(f"/api/v1/smart-lists/{smart_list['id']}")
    assert deleted.status_code == 204
    assert (await client.get("/api/v1/smart-lists")).json() == []


@pytest.mark.asyncio
async def test_smart_list_validation_and_task_scope(client):
    task_list = (
        await client.post("/api/v1/lists", json={"name": "来源", "color": "#336699"})
    ).json()
    invalid = await client.post(
        "/api/v1/smart-lists",
        json={
            "name": "无来源",
            "source_list_ids": [],
            "filters": {"statuses": []},
        },
    )
    assert invalid.status_code == 422

    smart_list = (
        await client.post(
            "/api/v1/smart-lists",
            json={
                "name": "汇总",
                "source_list_ids": [task_list["id"]],
            },
        )
    ).json()
    ambiguous = await client.get(
        "/api/v1/tasks",
        params={
            "view": "all",
            "smart_list_id": smart_list["id"],
        },
    )
    assert ambiguous.status_code == 422
    assert ambiguous.json()["error"]["code"] == "INVALID_TASK_SCOPE"


@pytest.mark.asyncio
async def test_smart_list_tasks_can_be_paged_by_status(client):
    task_list = (
        await client.post("/api/v1/lists", json={"name": "状态来源", "color": "#336699"})
    ).json()
    active = (
        await client.post(
            "/api/v1/tasks",
            json={"title": "未完成任务", "list_id": task_list["id"]},
        )
    ).json()
    completed = (
        await client.post(
            "/api/v1/tasks",
            json={"title": "已完成任务", "list_id": task_list["id"]},
        )
    ).json()
    await client.post(f"/api/v1/tasks/{completed['id']}/complete")
    smart_list = (
        await client.post(
            "/api/v1/smart-lists",
            json={
                "name": "全部状态",
                "source_list_ids": [task_list["id"]],
                "filters": {"statuses": ["active", "completed"]},
            },
        )
    ).json()

    active_page = await client.get(
        "/api/v1/tasks",
        params={"smart_list_id": smart_list["id"], "status": 0},
    )
    completed_page = await client.get(
        "/api/v1/tasks",
        params={"smart_list_id": smart_list["id"], "status": 2},
    )
    combined_page = await client.get(
        "/api/v1/tasks",
        params={"smart_list_id": smart_list["id"]},
    )

    assert [item["id"] for item in active_page.json()["items"]] == [active["id"]]
    assert [item["id"] for item in completed_page.json()["items"]] == [completed["id"]]
    assert {item["id"] for item in combined_page.json()["items"]} == {
        active["id"],
        completed["id"],
    }

    active_only = (
        await client.post(
            "/api/v1/smart-lists",
            json={"name": "仅未完成", "source_list_ids": [task_list["id"]]},
        )
    ).json()
    unavailable = await client.get(
        "/api/v1/tasks",
        params={"smart_list_id": active_only["id"], "status": 2},
    )
    assert unavailable.json()["items"] == []


@pytest.mark.asyncio
async def test_authentication_is_required_and_login_returns_current_user(client):
    authorization = client.headers.pop("Authorization")
    unauthorized = await client.get("/api/v1/lists")
    assert unauthorized.status_code == 401
    assert unauthorized.json()["error"]["code"] == "AUTH_REQUIRED"
    assert unauthorized.headers["www-authenticate"] == "Bearer"

    invalid = await client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "wrong"},
    )
    assert invalid.status_code == 401
    assert invalid.json()["error"]["code"] == "INVALID_CREDENTIALS"

    login = await client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "change-me"},
    )
    assert login.status_code == 200
    payload = login.json()
    assert payload["token_type"] == "bearer"
    assert payload["expires_in"] == 604800
    assert payload["refresh_token"].startswith("tdr_")
    assert payload["refresh_expires_at"]
    client.headers["Authorization"] = f"Bearer {payload['access_token']}"
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "admin"

    client.headers["Authorization"] = "Bearer not-a-jwt"
    malformed = await client.get("/api/v1/auth/me")
    assert malformed.status_code == 401
    assert malformed.json()["error"]["code"] == "INVALID_TOKEN"
    client.headers["Authorization"] = authorization


@pytest.mark.asyncio
async def test_refresh_token_rotation_and_logout(client):
    login = await client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "change-me"},
    )
    refresh_token = login.json()["refresh_token"]

    refreshed = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refreshed.status_code == 200
    refreshed_body = refreshed.json()
    assert refreshed_body["refresh_token"].startswith("tdr_")
    assert refreshed_body["refresh_token"] != refresh_token

    client.headers["Authorization"] = f"Bearer {refreshed_body['access_token']}"
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200

    reused = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert reused.status_code == 401
    assert reused.json()["error"]["code"] == "REFRESH_TOKEN_INVALID"

    logout = await client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": refreshed_body["refresh_token"]},
    )
    assert logout.status_code == 204

    after_logout = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refreshed_body["refresh_token"]},
    )
    assert after_logout.status_code == 401
    assert after_logout.json()["error"]["code"] == "REFRESH_TOKEN_INVALID"


@pytest.mark.asyncio
async def test_expired_refresh_token_is_rejected(client, session_factory):
    login = await client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "change-me"},
    )
    refresh_token = login.json()["refresh_token"]
    token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()

    async with session_factory() as session:
        stored = await session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        assert stored is not None
        stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()

    expired = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert expired.status_code == 401
    assert expired.json()["error"]["code"] == "REFRESH_TOKEN_EXPIRED"


async def get_inbox(client):
    response = await client.get("/api/v1/lists")
    assert response.status_code == 200
    inbox = next(item for item in response.json() if item["system_type"] == "inbox")
    return inbox


@pytest.mark.asyncio
async def test_health_and_default_inbox(client):
    health = await client.get("/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "database": "ok"}

    inbox = await get_inbox(client)
    assert inbox["name"] == "收集箱"
    assert inbox["task_count"] == 0


@pytest.mark.asyncio
async def test_list_crud_and_system_list_protection(client):
    created = await client.post(
        "/api/v1/lists",
        json={"name": " 工作 ", "color": "#123abc"},
    )
    assert created.status_code == 201
    task_list = created.json()
    assert task_list["name"] == "工作"
    assert task_list["color"] == "#123ABC"

    updated = await client.patch(
        f"/api/v1/lists/{task_list['id']}",
        json={"name": "项目", "color": "#ABCDEF"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "项目"

    inbox = await get_inbox(client)
    protected = await client.delete(f"/api/v1/lists/{inbox['id']}")
    assert protected.status_code == 409
    assert protected.json()["error"]["code"] == "SYSTEM_LIST_PROTECTED"


@pytest.mark.asyncio
async def test_list_groups_crud_and_list_assignment(client):
    group = await client.post("/api/v1/list-groups", json={"name": " 个人 "})
    assert group.status_code == 201
    group_body = group.json()
    assert group_body["name"] == "个人"
    assert group_body["is_collapsed"] is False

    listed = await client.get("/api/v1/list-groups")
    assert [item["id"] for item in listed.json()] == [group_body["id"]]

    created = await client.post(
        "/api/v1/lists",
        json={"name": "阅读", "color": "#6C5CE7", "group_id": group_body["id"]},
    )
    assert created.status_code == 201
    assert created.json()["group_id"] == group_body["id"]

    collapsed = await client.patch(
        f"/api/v1/list-groups/{group_body['id']}",
        json={"name": "生活", "is_collapsed": True},
    )
    assert collapsed.status_code == 200
    assert collapsed.json()["name"] == "生活"
    assert collapsed.json()["is_collapsed"] is True

    missing_group = await client.post(
        "/api/v1/lists",
        json={"name": "无效分组", "group_id": "00000000-0000-4000-8000-0000000000ff"},
    )
    assert missing_group.status_code == 404
    assert missing_group.json()["error"]["code"] == "GROUP_NOT_FOUND"

    cleared = await client.patch(
        f"/api/v1/lists/{created.json()['id']}",
        json={"group_id": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["group_id"] is None

    regrouped = await client.patch(
        f"/api/v1/lists/{created.json()['id']}",
        json={"group_id": group_body["id"]},
    )
    assert regrouped.json()["group_id"] == group_body["id"]

    deleted = await client.delete(f"/api/v1/list-groups/{group_body['id']}")
    assert deleted.status_code == 204
    # The list survives group deletion and is ungrouped.
    active = await client.get("/api/v1/lists")
    survivor = next(item for item in active.json() if item["id"] == created.json()["id"])
    assert survivor["group_id"] is None
    assert (await client.get("/api/v1/list-groups")).json() == []


@pytest.mark.asyncio
async def test_list_archive_hides_from_active_and_excludes_tasks(client):
    task_list = (
        await client.post("/api/v1/lists", json={"name": "归档项目", "color": "#6C5CE7"})
    ).json()
    task = (
        await client.post(
            "/api/v1/tasks",
            json={"title": "归档任务", "list_id": task_list["id"]},
        )
    ).json()

    archived = await client.post(f"/api/v1/lists/{task_list['id']}/archive")
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None

    active = await client.get("/api/v1/lists")
    assert task_list["id"] not in {item["id"] for item in active.json()}

    archived_lists = await client.get("/api/v1/lists/archived")
    assert task_list["id"] in {item["id"] for item in archived_lists.json()}

    all_view = await client.get("/api/v1/tasks", params={"view": "all"})
    assert task["id"] not in {item["id"] for item in all_view.json()["items"]}

    direct = await client.get("/api/v1/tasks", params={"list_id": task_list["id"]})
    assert task["id"] in {item["id"] for item in direct.json()["items"]}

    inbox = await get_inbox(client)
    protected = await client.post(f"/api/v1/lists/{inbox['id']}/archive")
    assert protected.status_code == 409
    assert protected.json()["error"]["code"] == "SYSTEM_LIST_PROTECTED"

    unarchived = await client.post(f"/api/v1/lists/{task_list['id']}/unarchive")
    assert unarchived.status_code == 200
    assert unarchived.json()["archived_at"] is None
    restored_view = await client.get("/api/v1/tasks", params={"view": "all"})
    assert task["id"] in {item["id"] for item in restored_view.json()["items"]}


@pytest.mark.asyncio
async def test_list_tasks_support_status_filter(client):
    task_list = (
        await client.post("/api/v1/lists", json={"name": "工作", "color": "#6C5CE7"})
    ).json()
    active = (
        await client.post(
            "/api/v1/tasks",
            json={"title": "待办", "list_id": task_list["id"]},
        )
    ).json()
    done = (
        await client.post(
            "/api/v1/tasks",
            json={"title": "已完成项", "list_id": task_list["id"]},
        )
    ).json()
    await client.post(f"/api/v1/tasks/{done['id']}/complete")

    pending = await client.get("/api/v1/tasks", params={"list_id": task_list["id"]})
    assert [item["title"] for item in pending.json()["items"]] == ["待办"]
    assert active["id"] in {item["id"] for item in pending.json()["items"]}

    completed = await client.get(
        "/api/v1/tasks",
        params={"list_id": task_list["id"], "status": 2},
    )
    assert [item["title"] for item in completed.json()["items"]] == ["已完成项"]


@pytest.mark.asyncio
async def test_task_views_search_sort_and_state_transitions(client):
    inbox = await get_inbox(client)
    first = await client.post(
        "/api/v1/tasks",
        json={"title": "第一项", "priority": 1},
    )
    second = await client.post(
        "/api/v1/tasks",
        json={"title": "重要报告", "priority": 5},
    )
    assert first.status_code == second.status_code == 201

    inbox_view = await client.get("/api/v1/tasks", params={"view": "inbox"})
    assert [item["title"] for item in inbox_view.json()["items"]] == ["第一项", "重要报告"]

    searched = await client.get(
        "/api/v1/tasks",
        params={"view": "all", "query": "报告", "sort": "priority_desc"},
    )
    assert [item["title"] for item in searched.json()["items"]] == ["重要报告"]

    task_id = second.json()["id"]
    completed = await client.post(f"/api/v1/tasks/{task_id}/complete")
    assert completed.status_code == 200
    assert completed.json()["status"] == 2
    completed_again = await client.post(f"/api/v1/tasks/{task_id}/complete")
    assert completed_again.status_code == 200
    first_completed_at = datetime.fromisoformat(
        completed.json()["completed_at"].replace("Z", "+00:00")
    )
    second_completed_at = datetime.fromisoformat(
        completed_again.json()["completed_at"].replace("Z", "+00:00")
    )
    if second_completed_at.tzinfo is None:
        second_completed_at = second_completed_at.replace(tzinfo=UTC)
    assert second_completed_at == first_completed_at

    normal = await client.get("/api/v1/tasks", params={"view": "all"})
    assert task_id not in {item["id"] for item in normal.json()["items"]}
    completed_view = await client.get("/api/v1/tasks", params={"view": "completed"})
    assert task_id in {item["id"] for item in completed_view.json()["items"]}

    reopened = await client.post(f"/api/v1/tasks/{task_id}/reopen")
    assert reopened.json()["status"] == 0
    assert reopened.json()["completed_at"] is None

    lists = await client.get("/api/v1/lists")
    inbox_after = next(item for item in lists.json() if item["id"] == inbox["id"])
    assert inbox_after["task_count"] == 2


@pytest.mark.asyncio
async def test_daily_recurring_task_completes_only_current_occurrence(client):
    today = datetime.now(UTC).date()
    created = await client.post(
        "/api/v1/tasks",
        json={
            "title": "每日复盘",
            "due_at": datetime.now(UTC).isoformat(),
            "is_all_day": True,
            "recurrence_type": "daily",
            "recurrence_start_date": today.isoformat(),
        },
    )
    assert created.status_code == 201
    task_id = created.json()["id"]

    completed = await client.post(f"/api/v1/tasks/{task_id}/complete")
    assert completed.status_code == 200
    assert completed.json()["status"] == 0
    assert (await client.post(f"/api/v1/tasks/{task_id}/complete")).status_code == 200

    today_tasks = await client.get("/api/v1/tasks", params={"view": "today"})
    assert task_id not in {item["id"] for item in today_tasks.json()["items"]}

    history = await client.get("/api/v1/tasks", params={"view": "completed"})
    occurrences = [item for item in history.json()["items"] if item["source_task_id"] == task_id]
    assert len(occurrences) == 1
    assert occurrences[0]["occurrence_date"] == today.isoformat()
    assert occurrences[0]["is_recurring_occurrence"] is True


@pytest.mark.asyncio
async def test_task_can_be_created_empty_at_a_specific_sort_position(client):
    created = await client.post(
        "/api/v1/tasks",
        json={"title": "", "sort_order": 1536},
    )
    assert created.status_code == 201
    assert created.json()["title"] == ""
    assert created.json()["sort_order"] == 1536

    updated = await client.patch(
        f"/api/v1/tasks/{created.json()['id']}",
        json={"title": "补充标题"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "补充标题"


@pytest.mark.asyncio
async def test_task_date_validation_and_today_view(client):
    now = datetime.now(UTC)
    invalid = await client.post(
        "/api/v1/tasks",
        json={
            "title": "错误提醒",
            "due_at": now.isoformat(),
            "reminder_at": (now + timedelta(hours=1)).isoformat(),
        },
    )
    assert invalid.status_code == 422

    valid = await client.post(
        "/api/v1/tasks",
        json={
            "title": "今日任务",
            "due_at": (now + timedelta(minutes=5)).isoformat(),
            "reminder_at": now.isoformat(),
        },
    )
    assert valid.status_code == 201
    today = await client.get("/api/v1/tasks", params={"view": "today"})
    assert valid.json()["id"] in {item["id"] for item in today.json()["items"]}


@pytest.mark.asyncio
async def test_today_date_sections_include_overdue_tasks(client):
    now = datetime.now(UTC)
    overdue = await client.post(
        "/api/v1/tasks",
        json={"title": "已过期任务", "due_at": (now - timedelta(days=2)).isoformat()},
    )
    today = await client.post(
        "/api/v1/tasks",
        json={"title": "今天任务", "due_at": (now + timedelta(minutes=5)).isoformat()},
    )
    completed = await client.post(
        "/api/v1/tasks",
        json={"title": "已完成逾期任务", "due_at": (now - timedelta(days=3)).isoformat()},
    )
    await client.post(f"/api/v1/tasks/{completed.json()['id']}/complete")

    today_response = await client.get(
        "/api/v1/tasks", params={"view": "today", "date_section": "today"}
    )
    overdue_response = await client.get(
        "/api/v1/tasks", params={"view": "today", "date_section": "overdue"}
    )
    today_ids = {item["id"] for item in today_response.json()["items"]}
    overdue_ids = {item["id"] for item in overdue_response.json()["items"]}
    assert today.json()["id"] in today_ids
    assert overdue.json()["id"] not in today_ids
    assert overdue.json()["id"] in overdue_ids
    assert completed.json()["id"] not in overdue_ids

    invalid = await client.get("/api/v1/tasks", params={"view": "all", "date_section": "overdue"})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "INVALID_DATE_SECTION"


@pytest.mark.asyncio
async def test_task_soft_delete_restore_and_permanent_delete(client):
    created = await client.post("/api/v1/tasks", json={"title": "待删除"})
    task_id = created.json()["id"]

    deleted = await client.delete(f"/api/v1/tasks/{task_id}")
    assert deleted.status_code == 204
    trash = await client.get("/api/v1/tasks", params={"view": "trash"})
    assert task_id in {item["id"] for item in trash.json()["items"]}

    restored = await client.post(f"/api/v1/tasks/{task_id}/restore")
    assert restored.status_code == 200
    assert restored.json()["deleted_at"] is None

    await client.delete(f"/api/v1/tasks/{task_id}")
    permanent = await client.delete(f"/api/v1/tasks/{task_id}/permanent")
    assert permanent.status_code == 204
    missing = await client.get(f"/api/v1/tasks/{task_id}")
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_list_delete_restore_batch_rules(client):
    task_list = (
        await client.post("/api/v1/lists", json={"name": "批次", "color": "#6C5CE7"})
    ).json()
    old_deleted = (
        await client.post(
            "/api/v1/tasks",
            json={"title": "提前删除", "list_id": task_list["id"]},
        )
    ).json()
    batch_task = (
        await client.post(
            "/api/v1/tasks",
            json={"title": "随清单删除", "list_id": task_list["id"]},
        )
    ).json()
    await client.delete(f"/api/v1/tasks/{old_deleted['id']}")
    await client.delete(f"/api/v1/lists/{task_list['id']}")

    deleted_lists = await client.get("/api/v1/lists/trash")
    assert task_list["id"] in {item["id"] for item in deleted_lists.json()}

    restored = await client.post(f"/api/v1/lists/{task_list['id']}/restore")
    assert restored.status_code == 200
    active = await client.get("/api/v1/tasks", params={"list_id": task_list["id"]})
    assert {item["id"] for item in active.json()["items"]} == {batch_task["id"]}
    trash = await client.get("/api/v1/tasks", params={"view": "trash"})
    assert old_deleted["id"] in {item["id"] for item in trash.json()["items"]}


@pytest.mark.asyncio
async def test_restore_task_conflicts_when_parent_list_is_deleted(client):
    task_list = (
        await client.post("/api/v1/lists", json={"name": "已删清单", "color": "#6C5CE7"})
    ).json()
    task = (
        await client.post(
            "/api/v1/tasks",
            json={"title": "任务", "list_id": task_list["id"]},
        )
    ).json()
    await client.delete(f"/api/v1/lists/{task_list['id']}")
    restored = await client.post(f"/api/v1/tasks/{task['id']}/restore")
    assert restored.status_code == 409
    assert restored.json()["error"]["code"] == "LIST_DELETED"


@pytest.mark.asyncio
async def test_tags_and_checklist_crud_and_reorder(client):
    tag = await client.post(
        "/api/v1/tags",
        json={"name": " 技术 ", "color": "#4F8EF7"},
    )
    assert tag.status_code == 201
    duplicate = await client.post(
        "/api/v1/tags",
        json={"name": "技术", "color": "#4F8EF7"},
    )
    assert duplicate.status_code == 409

    task = await client.post(
        "/api/v1/tasks",
        json={"title": "带详情", "tag_ids": [tag.json()["id"]]},
    )
    task_id = task.json()["id"]
    first = await client.post(
        f"/api/v1/tasks/{task_id}/items",
        json={"title": "第一步"},
    )
    second = await client.post(
        f"/api/v1/tasks/{task_id}/items",
        json={"title": "第二步"},
    )
    assert first.status_code == second.status_code == 201

    checked = await client.patch(
        f"/api/v1/tasks/{task_id}/items/{first.json()['id']}",
        json={"is_completed": True},
    )
    assert checked.json()["completed_at"] is not None

    reordered = await client.post(
        f"/api/v1/tasks/{task_id}/items/reorder",
        json={"item_ids": [second.json()["id"], first.json()["id"]]},
    )
    assert [item["id"] for item in reordered.json()] == [
        second.json()["id"],
        first.json()["id"],
    ]

    await client.delete(f"/api/v1/tags/{tag.json()['id']}")
    detail = await client.get(f"/api/v1/tasks/{task_id}")
    assert detail.status_code == 200
    assert detail.json()["tags"] == []


@pytest.mark.asyncio
async def test_cursor_pagination(client):
    for index in range(3):
        await client.post("/api/v1/tasks", json={"title": f"任务 {index}"})

    first_page = await client.get(
        "/api/v1/tasks",
        params={"view": "all", "limit": 2, "sort": "manual"},
    )
    payload = first_page.json()
    assert len(payload["items"]) == 2
    assert payload["next_cursor"]

    second_page = await client.get(
        "/api/v1/tasks",
        params={
            "view": "all",
            "limit": 2,
            "sort": "manual",
            "cursor": payload["next_cursor"],
        },
    )
    assert len(second_page.json()["items"]) == 1


@pytest.mark.asyncio
async def test_api_key_crud_and_bearer_auth(client):
    created = await client.post("/api/v1/api-keys", json={"name": "CI 脚本"})
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "CI 脚本"
    assert body["api_key"].startswith("tdl_")
    assert body["key_prefix"].startswith("tdl_")
    raw_key = body["api_key"]
    key_id = body["id"]

    listed = await client.get("/api/v1/api-keys")
    assert listed.status_code == 200
    items = listed.json()
    assert len(items) == 1
    assert items[0]["id"] == key_id
    assert "api_key" not in items[0]
    assert items[0]["key_prefix"] == body["key_prefix"]

    jwt_auth = client.headers["Authorization"]
    client.headers["Authorization"] = f"Bearer {raw_key}"
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "admin"

    inbox = await client.get("/api/v1/lists")
    assert inbox.status_code == 200

    client.headers["Authorization"] = jwt_auth
    deleted = await client.delete(f"/api/v1/api-keys/{key_id}")
    assert deleted.status_code == 204

    client.headers["Authorization"] = f"Bearer {raw_key}"
    revoked = await client.get("/api/v1/auth/me")
    assert revoked.status_code == 401
    assert revoked.json()["error"]["code"] == "INVALID_API_KEY"
    client.headers["Authorization"] = jwt_auth


@pytest.mark.asyncio
async def test_api_key_routes_reject_api_key_credential(client):
    created = await client.post("/api/v1/api-keys", json={"name": "自管理测试"})
    raw_key = created.json()["api_key"]

    jwt_auth = client.headers["Authorization"]
    client.headers["Authorization"] = f"Bearer {raw_key}"
    rejected = await client.post("/api/v1/api-keys", json={"name": "不应创建"})
    assert rejected.status_code == 403
    assert rejected.json()["error"]["code"] == "API_KEY_NOT_ALLOWED"

    listed = await client.get("/api/v1/api-keys")
    assert listed.status_code == 403
    client.headers["Authorization"] = jwt_auth


@pytest.mark.asyncio
async def test_api_key_delete_missing_returns_404(client):
    missing = await client.delete("/api/v1/api-keys/00000000-0000-4000-8000-0000000000ff")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "API_KEY_NOT_FOUND"
