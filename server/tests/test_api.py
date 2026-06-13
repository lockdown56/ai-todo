from datetime import UTC, datetime, timedelta

import pytest


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
    client.headers["Authorization"] = f"Bearer {payload['access_token']}"
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "admin"

    client.headers["Authorization"] = "Bearer not-a-jwt"
    malformed = await client.get("/api/v1/auth/me")
    assert malformed.status_code == 401
    assert malformed.json()["error"]["code"] == "INVALID_TOKEN"
    client.headers["Authorization"] = authorization


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
