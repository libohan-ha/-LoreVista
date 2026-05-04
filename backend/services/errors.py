"""Shared service-level exceptions."""


class MissingApiKeyError(RuntimeError):
    """Raised when an upstream API key (DeepSeek / Image2) is not configured.

    Mapped to HTTP 400 by the FastAPI app so the frontend can show a friendly
    "请先在前端设置中填入 API Key" message.
    """

    def __init__(self, provider: str):
        self.provider = provider
        super().__init__(
            f"{provider} API Key is missing. Please set it in the frontend settings or backend .env."
        )
