FROM ghcr.io/astral-sh/uv:0.13.7 AS uv
FROM python:3.12-slim
COPY --from=uv /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:${PATH}"

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev --no-editable \
    && useradd --system --create-home lbsim

USER lbsim
EXPOSE 8000
CMD ["uvicorn", "lbsim.api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
