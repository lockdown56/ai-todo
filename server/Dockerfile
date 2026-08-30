FROM python:3.12-slim

ARG PYPI_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ENV UV_DEFAULT_INDEX=${PYPI_INDEX_URL}

WORKDIR /app
RUN pip install --no-cache-dir --index-url "${PYPI_INDEX_URL}" uv
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev
COPY app app
COPY migrations migrations
COPY alembic.ini .

EXPOSE 8000
CMD ["sh", "-c", ".venv/bin/alembic upgrade head && exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000"]
